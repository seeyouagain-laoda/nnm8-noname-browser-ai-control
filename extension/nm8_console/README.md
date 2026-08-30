# 无名杀 NM8 AI 悬浮控制台 v3.1.0

> 目标版本：**无名杀 诗笺版 Windows 64 位 v1.75**（引擎内部版本 1.11.5）
> 扩展类型：**工具型扩展**（AI 控制台 + 对外控制接口），不含武将/卡牌内容

---

## 一、这是什么

一个把无名杀「交给 AI 操控」的扩展。它在游戏内挂一个 `window.NM8` 全局接口，提供三层能力：

| 层 | 作用 | 主要接口 |
|---|---|---|
| **监控层** | 读全场座位状态 | `NM8.snapshot()` `NM8.players()` `NM8.event()` |
| **接管/驱动层** | 智能接管决策、内置 AI 自动出牌 | `NM8.takeover()` `NM8.autoRun()` `NM8.step()` `NM8.decide()` `NM8.setMode()` |
| **操控层** | 官方作弊 / 引擎原生操控 / 官方面板 | `NM8.cheat.*` `NM8.god.*` `NM8.control.*` |

配合独立的 HTTP 网关（`nm8_api.cjs`，端口 8092），**其他 AI 无需懂无名杀内部 API，发 HTTP 请求就能全自动驱动游戏**。

---

## 二、安装步骤

1. 复制整个 `nm8_console` 文件夹到游戏安装目录的扩展目录：
   ```
   <游戏目录>\resources\app\extension\nm8_console\
   ```
   本机实际路径：
   ```
   D:\无名杀诗笺版Windows64位v1.75\无名杀-win32-x64\resources\app\extension\nm8_console\
   ```
2. 目录内应包含两个文件（缺一不可）：
   ```
   nm8_console/
   ├── extension.js    （主程序，约 1260 行）
   └── info.json       （扩展元信息：名称/作者/简介/版本）
   ```
3. 启动游戏 → 「扩展」→ 勾选 **nm8_console** → 按提示**重启游戏**。
4. 验证：进入任意对局后按 **F9**，右上角应出现半透明监控浮层；或按 F12 在控制台执行 `NM8.help()`。

### 可选：HTTP 网关（给其他 AI 用）

```bat
双击桌面「启动无名杀AI网关.bat」
```
或手动：
```bat
set NODE_PATH=C:\Users\user\.workbuddy\binaries\node\workspace\node_modules
node C:\Users\user\WorkBuddy\2026-08-24-15-01-51\nm8_api.cjs
```
网关起来后访问 `http://127.0.0.1:8092/api/v1/health`，返回 `"cdp":true` 即可用。

---

## 三、功能介绍

### 监控
- `NM8.snapshot()` 返回全场 JSON：座位号 / 武将 / 身份 / 体力 / 手牌数 / 装备 / 判定 / 技能 / 存活状态
- `NM8.players()` 返回各座位摘要数组
- 右上角浮层实时刷新（F9 开关，可拖拽折叠，停靠右侧不遮挡原生按钮）

### 接管与自动驱动
- `NM8.setMode('builtin')`：内置 AI 全自动，不暂停等外部
- `NM8.setMode('hybrid')`：关键决策暂停，等外部 AI 调 `NM8.decide()`
- `NM8.autoRun(true, 900)`：每 900ms 自动推进一步
- **智能 isMine**：只对「真正需要玩家决策」的事件宣告接管，引擎自行推进的事件（摸牌/伤害/阶段等）交回引擎内置 AI，避免误接管导致卡死

### 操控
- `NM8.cheat.*` — 官方 `lib.cheat`：发牌 / 神装 / 加技能 / 摸牌 / 看手牌 / 显身份
- `NM8.god.*` — 引擎原生：任意座位控血 / 伤害 / 秒杀 / 复活 / 改身份 / 判定胜负
- `NM8.control.*` — 官方面板 / 命令行（`ui.control` / `ui.commandnode`）

---

## 四、本次按官方规范做的修正（v3.1.0）

对照 v1.75 内置扩展（玩点论杀 / 3D精选 / 英雄杀 / 欢乐卡牌 / 杀海拾遗）的写法：

| # | 问题 | 修正 |
|---|---|---|
| 1 | 默认导出是**函数**（旧式写法），引擎需调用后才拿到扩展包 | 改为**对象式导出** `export default extensionPackage`，与官方 5 个内置扩展一致 |
| 2 | `package: {}` 为空，从不读 `info.json` | 顶层 `await lib.init.promises.json()` 读取并填充，扩展管理界面能正确显示作者/简介/版本 |
| 3 | 改对象式导出后 `window.NM8` 在主菜单不可用，网关开局前连不上 | 补加载期 `buildAPI()` / `installTakeover()` 初始化 |
| 4 | `forcePlay` 默认 `true`，未选牌强点确定 → 被引擎驳回形成死循环 | 默认改为 `false`，可运行时 `NM8.setForcePlay(true)` 开启 |
| 5 | 对所有事件一律 `isMine=true`，连摸牌/伤害也接管 | 引入 `ENGINE_DRIVEN_EVENTS` 黑名单 + 选择器判定，只接管真决策 |
| 6 | 出牌 `chooseToUse` 手动 `ui.selectCard()` 塞入引擎不认的牌引用 → `get.info(card).noai` 崩溃 | `chooseToUse` 走引擎同款 AI（`ai.basic.chooseCard/chooseTarget`）；求桃/弃牌手动选牌 |
| 7 | 引擎 AI 抛异常后继续走手动选牌逻辑 | 异常时**直接取消并返回**，绝不继续手动选牌 |
| 8 | `cancel + redo` 无限循环（`_aiexclude` 为空时重选必然选中同一项） | 要求「能排除」且「次数 ≤ MAX_REDO」才允许 redo，否则取消并尝试结束阶段 |
| 9 | 求桃/弃牌**没选到牌仍点确定** → 引擎拿到空结果永久卡在 `respond` | 没选到牌必须取消（= 放弃响应） |
| 10 | 引擎遇未捕获异常弹 `alert`，**阻塞渲染进程**，CDP 连 `1+1` 都超时 | 新增 `installAlertShield()` 拦截 `alert`/`confirm`，改为写日志并尝试恢复 |
| 11 | 自定义技能卡死整局无兜底 | 新增**看门狗**：步骤停滞 6s 起循环升级挽救（取消→确定→结束阶段→恢复→推进→强制结束事件） |
| 12 | 看门狗用 `S.step` 判停滞，自己写日志就让它自增 → 永远卡在 1 级 | 改用「事件对象 + 事件 step」复合签名判定 |
| 13 | `NM8.state` 暴露整个 `S`，含游戏事件对象 → CDP 序列化报 `Object reference chain is too long` | state getter 过滤下划线内部字段与大对象图 |

---

## 五、已知问题（重要）

### ⚠️ 无法稳定跑完「完整一局」
这是**内容包问题，不是扩展问题**。

诗笺版 v1.75 的 `free_choose` 随机选将会抽到大量 **OL / 自定义技能**武将，其中部分技能（`olshengong`、`huituo`、`dcpingxi`、`oljiezi`、`mbcuizhen` 等）**自身缺少可用 AI**：
- 这类事件**没有任何 UI 选择器**（无 `filterCard` / `filterTarget` / `chooseButton`）
- 点确定/取消/结束回合都无效，引擎会永久停在事件上
- 看门狗能不断触发，但无法把它们救出来

**已验证的能力**：扩展可连续自动驱动 **300+ 步**不崩溃、不冻结（v3.1.0 之前是第 5~6 步就崩回菜单 / 主线程死锁）。

**规避建议**：
- 选将时避开 OL / 自定义技能武将（用 `NM8.pickCharacter(n)` 指定，或在扩展管理里临时关掉对应内容扩展）
- 或接受「跑若干回合后卡在某个冷门技能」的现状，用 `NM8.god.*` / `NM8.cheat.*` 手动推进

### 其他
- `alert`/`confirm` 被全局拦截并写入 `NM8.log()`。若你需要看到引擎原始报错弹窗，可在 F12 执行 `NM8.setAlertShield(false)`（如已提供）或直接看控制台 `[NM8] alert suppressed:` 输出。
- 浮层默认停靠右上角，F9 开关；若与原生按钮重叠，可直接拖走。
- HTTP 网关依赖游戏 Chrome 的调试端口 **9333**（9222 被 WorkBuddy 桌面端占用，不要抢）。

---

## 六、文件清单

```
无名杀NM8控制台扩展_v3.1.0/
├── nm8_console/              ← 复制这个文件夹到游戏的 extension 目录
│   ├── extension.js
│   └── info.json
├── README.md                 ← 本文件
├── CHANGELOG.md              ← 更新日志
├── AI接口说明.md              ← HTTP 网关接口文档（给其他 AI 用）
└── 扩展示例-技能与卡牌.md      ← 按官方规范新增武将/技能/卡牌的模板
```
