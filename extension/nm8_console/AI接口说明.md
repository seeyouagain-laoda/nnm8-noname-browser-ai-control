# NM8 HTTP AI 网关接口说明（端口 8092）

> 给**其他 AI**（OpenClaw / WorkBuddy / 任意 HTTP 客户端）用。
> 无需了解无名杀内部 API，发 HTTP 请求即可全自动驱动游戏。

## 架构

```
你的 AI ──HTTP──> nm8_api.cjs (8092) ──CDP(WebSocket)──> 游戏 Chrome (9333) ──> window.NM8 ──> 引擎
```
- 不改动游戏任何源码，独立进程，可单独重启
- 依赖游戏 Chrome 调试端口 **9333**（9222 被 WorkBuddy 桌面端占用，不要抢）

## 启动

```bat
双击桌面「启动无名杀AI网关.bat」
```
验证：
```bash
curl http://127.0.0.1:8092/api/v1/health
# {"success":true,"data":{"cdp":true,"nm8":"object","version":"3.1.0","inGame":false,...}}
```
`cdp:true` 才可用；`cdp:false` 表示连不上游戏，先开游戏。

---

## 接口一览

### 查询类（GET）

| 路径 | 说明 |
|---|---|
| `GET /` 或 `/api/v1/help` | 接口文档 |
| `GET /api/v1/health` | 健康检查：`cdp` / `nm8` / `version` / `inGame` / `players` |
| `GET /api/v1/state` | 全场状态：`state` / `snapshot` / `players` / `event` / `paused` / `autoRun` / `mode` |
| `GET /api/v1/players` | 各座位摘要数组 |

### 对局类（POST）

| 路径 | 参数 | 说明 |
|---|---|---|
| `POST /api/v1/start` | `{n:5}` | **一键开局**：配置身份局 → 选将 → 开始 → 开自动驱动。返回 `{action:'started', autoRun:true, mode:'builtin', players:5}` |
| `POST /api/v1/stop` | — | 停止自动驱动 |
| `POST /api/v1/decide` | `{action:'ok'\|'cancel'\|...}` | 外部下发决策指令（hybrid 模式用） |
| `POST /api/v1/reload` | — | 重载游戏页面（改了扩展代码后用它） |

### 操控类（POST）

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/v1/give` | `{card:'sha', seat:0}` | 发牌给指定座位 |
| `/api/v1/giveAll` | `{card:'sha'}` | 全场发牌 |
| `/api/v1/equip` | `{seat:0}` | 神装 |
| `/api/v1/draw` | `{n:1, seat:'me'}` | 摸牌 |
| `/api/v1/peek` | `{seat:'me'}` | 查看手牌 |
| `/api/v1/hp` | `{seat:0, value:3}` | 设置体力 |
| `/api/v1/heal` | `{seat:0, n:1}` | 治疗 |
| `/api/v1/hurt` | `{seat:0, n:1}` | 伤害 |
| `/api/v1/kill` | `{seat:0}` | 秒杀 |
| `/api/v1/revive` | `{seat:0}` | 复活 |
| `/api/v1/panel` | `{on:true}` | 显示/隐藏监控浮层 |

### 逃生舱（POST）

| 路径 | 参数 | 说明 |
|---|---|---|
| `/api/v1/exec` | `{expression:"window.NM8.snapshot()"}` | **在游戏页内执行任意 JS**，返回序列化结果。任何接口没覆盖的能力都走这里 |
| `/api/v1/command` | `{code:"..."}` | 走官方命令行节点 |

---

## 典型调用流程

```bash
# 1. 检查
curl http://127.0.0.1:8092/api/v1/health

# 2. 一键开局（阻塞 10~90s，选将会自动点）
curl -X POST http://127.0.0.1:8092/api/v1/start -H "Content-Type: application/json" -d '{"n":5}'

# 3. 轮询状态
curl http://127.0.0.1:8092/api/v1/state

# 4. 查看实时日志（排障用）
curl -X POST http://127.0.0.1:8092/api/v1/exec \
  -H "Content-Type: application/json" \
  -d '{"expression":"window.NM8.log().slice(-30)"}'
```

---

## 注意事项

1. **curl 必须加 `--noproxy '*'`**：本机有 Clash 代理（7897），不加会被拦成假 502。
2. `/start` 是**异步长任务**，建议不要阻塞等待，发起后立即轮询 `/state`。
3. `NM8.state` 已过滤内部字段，**不要**试图通过 `/exec` 读 `window.NM8.state` 里的下划线字段（拿不到是设计如此）。
4. 引擎报错弹窗已被扩展拦截并写入 `NM8.log()`，不会卡死；排障时查日志里的 `kind:"alert"` 条目。
5. **已知限制**：诗笺版部分 OL/自定义技能（如 `olshengong`/`huituo`）缺少 AI，对局可能停在某个技能/响应事件上。详见 README「已知问题」。
