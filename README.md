> ⚠️ **声明（AI 生成 · 仅供参考）**
>
> 本文档及其配套代码**由 AI 生成**；**仅适用于《无名杀》PC 版**；**仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）**，其他版本未经验证；内容**仅供参考**，使用风险自负。

# NNM8 · 无名杀(Noname) 浏览器控制与 AI 自动对局控制台

> 把《无名杀》（诗笺版 v1.75）「交给 AI 操控」的扩展 + 可选 HTTP 网关。
> 扩展内挂 `window.NM8` 全套接口；网关把 `NM8` 包成 HTTP JSON API，让**其他 AI（OpenClaw / WorkBuddy / 任意 HTTP 客户端）无需懂无名杀内部 API 即可全自动驱动游戏**。

> **🔎 NNM8 是什么？** NNM8 是本项目的**对外代号**（读作 N-N-M-8），全称 **无名杀(Noname) 的 NM8 浏览器控制与 AI 自动对局控制台**。
> 拆解：第一个 **N** = Noname（无名杀引擎英文名）；第二个 **N** = 无名（中文名「无名杀」的「无名」）；**M8** = 沿用原 NM8 控制台命名（M=Mode/控制台，8 为社区习惯数字后缀，无特殊含义，仅作区分）。
> 一句话：**用浏览器(Chrome DevTools/CDP) 控制《无名杀》，并接一个 AI 帮你自动打牌的扩展方案。** 代码里 `window.NM8` 与 `window.NNM8` 是同一个对象的两个名字，互相通用——搜「NNM8」或「NM8」都能找到本项目。

- **版本**：扩展 `v3.4.0` ｜ 网关 `nm8_api.cjs` v1.2 ｜ 游戏 `无名杀 诗笺版 Windows64 位 v1.75`（引擎内部 1.11.5）
- **类型**：工具型扩展（AI 控制台 + 对外控制接口），**不含武将/卡牌内容**
- **核心特性**：实时监控全场 / 智能接管决策 / 内置 AI 自动驱动 / 官方作弊·引擎原生操控封装 / 复用官方录像的实时行为日志 / 引擎容错（自动驱动不再因内容包 bug 卡死）

---

## 目录

1. [功能特性](#1-功能特性)
2. [运行前置条件（重点）](#2-运行前置条件重点)
3. [安装](#3-安装)
4. [快速开始](#4-快速开始)
5. [架构与原理](#5-架构与原理)
6. [接口详细文档（功能 / 实现方式 / 为什么这样实现）](#6-接口详细文档)
7. [参考项目与网页链接](#7-参考项目与网页链接)
8. [已知限制与排查](#8-已知限制与排查)
9. [后续计划（含武将/技能/卡牌编写学习路线）](#9-后续计划)
10. [许可证](#10-许可证)

---

## 1. 功能特性

| 能力 | 接口 | 说明 |
|---|---|---|
| 全场监控 | `NM8.snapshot()` / `NM8.players()` / `NM8.event()` | 座位 / 武将 / 身份 / 体力 / 手牌 / 装备 / 判定 / 技能 / 存活，实时只读 |
| 智能接管 | `NM8.takeover()` / `NM8.setMode()` | 只对「真决策」事件接管，引擎自行推进的事件放行（避免误接管卡死） |
| 自动驱动 | `NM8.autoRun()` / `NM8.step()` / `NM8.decide()` | 内置 AI 全自动出牌；或 hybrid 模式暂停等外部 AI 决策 |
| 引擎操控 | `NM8.cheat.*` / `NM8.god.*` / `NM8.control.*` | 官方作弊 / 引擎原生任意座位操控 / 官方面板·命令行 |
| 实时日志 | `NM8.log.*` / `NM8.video()` | **复用官方录像缓冲 `lib.video`**，零副作用，供其他 AI 读取 |
| 容错 | `NM8.setIgnoreError()` / `NM8.recover()` | 引擎内容包 bug 不再冻结整局 |
| 浮层 | F9 / `NM8.showPanel()` | 毛玻璃悬浮面板，可拖拽、可折叠、实时刷新 |

---

## 2. 运行前置条件（重点）

### 2.1 游戏本体（必需）

- **无名杀 诗笺版 Windows 64 位 v1.75**（引擎内部版本 `1.11.5`）。
- 扩展只在网页/Electron 模式运行，依赖游戏注入的全局：`lib` / `game` / `ui` / `get` / `ai` / `_status`（由游戏 ESM 加载器提供，详见[参考链接](#7-参考项目与网页链接)）。
- 本扩展**不修改游戏任何源码**，纯 import 即用。

> 为什么强调版本：无名杀不同分支（诗笺 / 棘手 / 国战版）的事件模型与 `lib` 结构有差异。本扩展基于 v1.75 诗笺版实测；其它版本未验证，可能需微调。

### 2.2 浏览器 / 运行时接口（必需）

本扩展有**两种运行形态**，对浏览器接口的要求不同：

#### 形态 A：纯扩展（扩展自身，无需任何外部进程）

- 运行在**无名杀自带的 Chromium（Electron 内核）** 内。
- 用到的 Web 接口：`document` / `window` / DOM 操作 / `addEventListener` / `setInterval`。
- **对 Chrome 版本无额外要求**——只要游戏能跑，扩展就能跑（游戏已自带内核）。
- 不需要开调试端口、不需要 Node。

#### 形态 B：HTTP 网关（给其他 AI 远程驱动，可选）

要让「另一个 AI 程序」通过 HTTP 控制游戏，需要一条 **Chrome DevTools Protocol（CDP）** 通道：

| 接口 | 用途 | 要求 |
|---|---|---|
| `Runtime.evaluate` | 在游戏页内执行 `NM8.*` JS 并取返回值 | Chrome/Chromium ≥ 80（本机用游戏自带 Chromium 9333 端口即可） |
| `Page.reload` | 改了扩展代码后热重载游戏页 | 同上 |
| `Target.getTargets` / `Target.attachToTarget` | 网关定位游戏页 | 同上 |
| WebSocket（`ws` npm 包） | Node 网关与 Chrome 通信 | Node.js 运行时 |

- **游戏必须带远程调试端口启动**：本项目用 `start_game_chrome.py` 以 `--remote-debugging-port=9333` 拉起游戏 Chrome。
  > ⚠️ 端口约定：**9333** 给游戏调试；**9222** 已被 WorkBuddy 桌面端占用，**不要抢**。
- 任意现代 Chromium 内核（≥ 80）都支持上述 CDP 方法；无需特定 Chrome 版本。

### 2.3 Node.js 与依赖（仅形态 B 需要）

- **Node.js ≥ 16**（网关 `nm8_api.cjs` 用 CommonJS `require`；扩展的 `await` 在 ESM 内由游戏内核执行，与本地 Node 无关）。
- 依赖 **`ws`**（WebSocket 客户端）：
  ```bat
  npm install ws
  :: 或指向已装好的全局/隔离目录：
  set NODE_PATH=C:\path\to\node_modules
  node nm8_api.cjs
  ```

### 2.4 端口规划（形态 B）

| 端口 | 角色 | 说明 |
|---|---|---|
| 9333 | 游戏 Chrome 调试端口 | `start_game_chrome.py` 拉起，CDP 入口 |
| 8091 | 桥接服务 `noname_srv.cjs` | 给游戏页注入/读取辅助状态（如需） |
| 8092 | HTTP AI 网关 `nm8_api.cjs` | 对外 HTTP JSON API，监听 `127.0.0.1` |

> 全部监听本机回环 `127.0.0.1`，不对外暴露；网关无鉴权（仅供本机 AI 调用）。

### 2.5 操作系统

- 主测 **Windows 10/11**（64 位）。`start_game_chrome.py` 用 `subprocess.CREATE_NEW_PROCESS_GROUP` 避免被沙箱回收。
- 扩展本体跨平台（游戏在哪个平台跑，扩展就在哪跑）；网关的 `ws` 也跨平台。

---

## 3. 安装

### 方式一：官方「导入扩展」（推荐，零配置）

1. 下载本仓库的发布包 `nm8_console_vX.Y.Z.zip`（或用 `tools/build_package.py` 自行生成）。
2. 无名杀内：「扩展」→「获取扩展」→「导入扩展」→ 选该 zip。
3. 勾选 **nm8_console** → 重启游戏。
4. 验证：进对局后按 **F9** 出现悬浮面板；或 F12 控制台执行 `NM8.help()`。

### 方式二：复制文件夹（开发用）

```bat
:: 把仓库的 extension/nm8_console 复制到游戏扩展目录
xcopy /E /I extension\nm8_console "<游戏目录>\resources\app\extension\nm8_console\"
```
重启游戏即可。

### 方式三：HTTP 网关（给其他 AI）

```bat
set NODE_PATH=C:\Users\user\.workbuddy\binaries\node\workspace\node_modules
node server\nm8_api.cjs
:: 健康： curl http://127.0.0.1:8092/api/v1/health  → {"success":true,"data":{"cdp":true,...}}
```

---

## 4. 快速开始

### 4.1 纯扩展（无需任何服务）

进任意对局后，F12 控制台：

```js
NM8.help();                 // 看全部接口
NM8.quickStart();           // 一键接管 + 浮层 + 自动驱动（内置 AI 全自动）
NM8.snapshot();             // 看全场状态
NM8.god.give(0, 'sha');     // 给 0 号座位发一张「杀」
```

### 4.2 带 HTTP 网关（给其他 AI）

```bash
# 1) 开游戏（带 9333 调试端口）
python server/start_game_chrome.py

# 2) 开网关
node server/nm8_api.cjs

# 3) 一键开局 5 人身份局并自动驱动
curl -X POST http://127.0.0.1:8092/api/v1/start \
  -H "Content-Type: application/json" -d '{"n":5}'

# 4) 轮询状态
curl http://127.0.0.1:8092/api/v1/state
```

> 本机有 Clash 代理（7897）时，`curl` 必须加 `--noproxy '*'`，否则被拦成假 502。

---

## 5. 架构与原理

```
你的 AI ──HTTP──> nm8_api.cjs (8092)
                     │ CDP (WebSocket, Runtime.evaluate)
                     ▼
              游戏 Chrome (9333, --remote-debugging-port)
                     │ window.NM8
                     ▼
              无名杀引擎 (lib / game / ui / get / ai / _status)
```

**三层解耦**（这是本项目的核心架构纪律，见[工作记忆](../.workbuddy/memory)）：

1. **扩展 `extension/nm8_console`**：唯一真正观测/操控游戏的层，跑在游戏进程内。
2. **网关 `nm8_api.cjs`**：独立 Node 进程，只做「HTTP ↔ CDP ↔ window.NM8」翻译，可被单独重启。
3. **游戏本体**：绝不被修改；所有能力来自官方公开 API。

**为什么这样分层**：扩展若直接依赖外部服务，一旦服务挂了扩展就废；反过来网关崩了游戏照常玩。二者通过 `window.NM8` 这一稳定契约解耦，任一层可独立替换。

---

## 6. 接口详细文档

> 每个接口给出：**功能 → 实现方式 → 为什么这样实现（原因）**。照此即可复现。

### 6.1 `window.NM8` 扩展内接口

#### 监控层

**`NM8.snapshot()`**
- 功能：全场 JSON 快照（座位 / 武将 / 身份 / 体力 / 手牌 / 装备 / 判定 / 技能 / 态度矩阵）。
- 实现：`readPlayer(p)` 遍历 `game.players`，逐项调 `p.getCards('h'|'e'|'j')`、`p.hp/maxHp/isDead()`；`currentEvent()` 读 `_status.event`；态度用 `get.attitude(pa,pb)`。
- 原因：**纯只读、零副作用**。快照不触发任何 `update`/动画，可无脑轮询。

**`NM8.players()` / `NM8.event()`**
- 实现：分别是 `snapshot().players` 的数组版、`_status.event` 的精简版。
- 原因：给只需要「座位列表」或「当前事件」的调用方省流量。

#### 接管 / 驱动层

**`NM8.takeover(on)`**
- 功能：开/关「接管全部座位决策」。
- 实现：`installTakeover()` 把 `Player.prototype.isMine` 替换为自写版本——仅当 `needsPlayerDecision()` 为真（事件带 `filterCard/filterTarget/filterOk/chooseButton…` 且不在 `ENGINE_DRIVEN_EVENTS` 黑名单）才返回 `true`；否则 `false` 放行给引擎内置 AI。
- 原因：**这是自动驱动不卡死的关键**。早期对所有事件一律 `isMine=true`，连摸牌/伤害也接管，导致引擎在无确定按钮的事件上干等、内置 AI 无处点 → 主线程死循环。只接管真决策，引擎自行推进的事件交回官方 AI，互不干扰。

**`NM8.autoRun(on, interval=900)`**
- 功能：每 `interval` 毫秒自动推进一步。
- 实现：`setInterval` 内 `if(_status.paused) step(true)` + `watchdog()` + `renderPanel()`。
- 原因：间隔 900ms 是为留足引擎动画/结算时间（太快会抢在动画前点下一事件）。

**`NM8.step(forceBuiltin)`**
- 功能：走一步决策。hybrid 模式下若遇到关键决策（出杀/桃/无懈/决斗…）返回 `{pending:true, ask}`，暂停等外部 AI。
- 实现：`step()` → 命中关键事件则 `S.pendingPause=true` 返回；否则 `builtinDecide()`。
- 原因：hybrid 让「人类/外部 AI 接管关键节点、引擎跑流程」成为可能。

**`NM8.decide(cmd)`**
- 功能：外部 AI 下发 `ok/cancel/cards/targets/button`。
- 实现：`ui.clear()` + `ui.selectCard/selectTarget` + `ui.click.ok/cancel`；`button` 按 DOM 索引点击。
- 原因：hybrid 模式下外部 AI 的唯一下发入口，与 `step` 的 `pending` 闭环。

**`builtinDecide()`（内部，被 `step` 调用）**
- 实现：先 `game.check()` 一键确定；否则按事件名分路——`chooseButton` 用 `ai.basic.chooseButton`、`chooseToUse` 用 `ai.basic.chooseCard/chooseTarget`、`chooseToRespond/chooseToDiscard` 手动选第一张合法牌；`filterOk` 不过则取消 / 结束阶段 / redo（限 `MAX_REDO` 次）。
- 原因：**全程复用引擎原生 AI（`ai.basic.*`）与官方 `filterOk`**，不自己造选牌逻辑——早期手动塞牌引用会触发 `get.info(card).noai` 崩溃（`player.js:7482`）。求桃/弃牌没选到牌**必须取消**（= 放弃响应），否则引擎拿空结果永久卡 `respond`。

#### 操控层

**`NM8.cheat.give(card, seat)` / `giveAll` / `equip` / `draw` / `peek` / `identities`**
- 实现：全部包 `lib.cheat.gx/gg/ge/d/h/id`（官方作弊接口）。
- 原因：官方作弊通道最稳，发牌同步插手牌 DOM，实测进手牌。

**`NM8.god.setHp(seat, v)` / `heal(seat, n)`**
- 实现：**同步直改** `p.hp` 并 `p.update()`；`heal` 钳制到 `p.maxHp`。
- 原因：`recover` 等异步事件的 `.then` 在 CDP 序列化下返回 `null`（不稳定），同步直改返回值可靠、即时可见。

**`NM8.god.hurt(seat, n)` / `loseHp` / `kill`**
- 实现：`p.damage({num,nocard,nosource}).start()` / `p.loseHp(n).start()` / `p.die().start()`。
- 原因：**v3.2.0 关键发现**——无名杀事件模型里 `damage/recover/gain/die/loseHp` 等方法**只创建事件对象、不自动运行**，必须由 `.start()` 真正启动才结算（`gameEvent.js:196`）。直接调这些方法只是建了个不跑的事件，正是「扣血不结算 / 死不置位」的根因。

**`NM8.god.give(seat, card)`**
- 实现：`lib.cheat.gx(card, p)`（同步插手牌）。
- 原因：与 `cheat.give` 同源，稳定进手牌。

**`NM8.god.addSkill` / `revive` / `setIdentity`**
- 实现：引擎原生 `p.addSkill/revive/setIdentity`。
- 原因：这些是引擎同步方法，直接调即可，无需 `.start()`。

**`NM8.god.winner()`**
- 实现：自写胜负判定（主公存活且其余非内奸→主公胜；反贼全灭且无内奸→主公胜；否则 `null`）。
- 原因：引擎无单一「当前胜者」API，按身份局规则自行计算。

**`NM8.control.open()` / `command(code)`**
- 实现：`ui.control.show()` / 往 `ui.commandnode` 输入框灌 `code` 并触发执行。
- 原因：复用官方「控制面板 / 命令行」，等价于游戏内「其他→命令」。

#### 日志层

**`NM8.log.len() / head(n) / tail(since,n) / get(since)`**
- 功能：读取对局行为日志。
- 实现：**直接读官方录像缓冲 `lib.video`**（`game.addVideo` 每次动作同步 `push` 进该数组，源码 `game/index.js`）。`mapVideoEvent` 把 `player` 字段归一化为座位号。
- 原因：**v3.3.0 重大优化——复用官方机制，不重复造轮子**。早期自己包裹 `addVideo` 写第二份缓冲，既冗余又可能漏事件；现在与官方录像同源、零副作用、零维护。

**`NM8.video(n)`**
- 实现：`JSON.stringify(lib.video)` 原始官方录像。
- 原因：需要引擎原生字段（如 `content`）的场景直接拿原始数据。

**`NM8.log2()`**
- 实现：返回内部操作日志 `S.log`（NM8 自身动作：接管/autoRun/报错/看门狗…）。
- 原因：与「对局行为日志」区分——`log.*` 是场上发生了什么，`log2()` 是 NM8 自己干了什么，便于排障。

#### 容错层（v3.4.0 新增）

**`NM8.setIgnoreError(on)`**
- 功能：开/关引擎容错。
- 实现：设 `lib.config.ignore_error`。
- 原因：**直击自动驱动卡死根因**。溯源引擎发现 `gameEvent.js:232` 的 `this.content(this).catch(...)` 仅在 `ignore_error` 为真时吞掉 content 异常并继续推进，否则 `throw` 冻结整局；而 `content.js:9996` 的通用「响应」动画 `event.card.name` 在 `event.card` 未定义时（内容包把 bug）会抛错。`setIgnoreError(true)` 让这类 bug 不再卡死，`false` 则恢复引擎默认冻结（便于人工定位）。默认开。

**`NM8.recover()`**
- 功能：卡死时最后兜底。
- 实现：依次 `event.finish()` → `game.resume()` → `game.loop()`。
- 原因：看门狗多级挽救无效时的终极手段；配合 `setIgnoreError` 双保险。

#### 浮层 / 工具

**`NM8.showPanel(on)` / `togglePanel()`**：控制悬浮面板显隐（F9 等价）。
**`NM8.setForcePlay(on)`**：开/关「强制出牌」（默认关，避免无选牌强点确定被引擎驳回死循环）。
**`NM8.pickCharacter(n)` / `listCharacters()`**：DOM 点击武将卡 / 列出可选武将坐标。
**`NM8.quickStart()`**：`takeover(true)` + 显面板 + `autoRun(true)` 一键串起。
**`NM8.help()`**：返回接口字典。

### 6.2 HTTP 网关 `nm8_api.cjs` 接口

架构：`你的 AI ──HTTP──> 网关 ──CDP──> window.NM8`。全部返回 `{success, data|error}`。

| 方法 & 路径 | 参数 | 功能 | 实现要点 |
|---|---|---|---|
| `GET /api/v1/health` | — | 连接状态 | `cdpEval` 取 `NM8.VERSION`/`inGame` |
| `GET /api/v1/state` | — | 全场状态 | 调 `NM8.snapshot()/state/event()` |
| `GET /api/v1/players` | — | 座位数组 | `NM8.players()` |
| `POST /api/v1/start` | `{n:5, autoRun:true}` | 一键开局+自动驱动 | `cdpEval(autoStartExpr)`：设 `mode_config.identity` → 点「身份」→ 选将 → 开始 → `autoRun`；`free_choose=false` 用官方将池规避缺 AI 将 |
| `POST /api/v1/stop` | — | 停自动驱动 | `NM8.autoRun(false)` |
| `POST /api/v1/give` | `{card,seat}` | 发牌 | `NM8.cheat.give` |
| `POST /api/v1/heal` `/hurt` `/kill` `/revive` `/giveCard` | `{seat,…}` | 引擎操控 | `NM8.god.*`（`awaitPromise` 等异步结算） |
| `POST /api/v1/decide` | `{action,…}` | 外部决策 | `NM8.decide` |
| `POST /api/v1/exec` | `{expression}` | 游戏页内执行任意 JS | `cdpEval(expr, awaitPromise=true)`——**逃生舱**，任何未覆盖能力都走这 |
| `POST /api/v1/reload` | — | 重载游戏页 | CDP `Page.reload`（改扩展代码后用） |
| `GET /api/v1/fieldlog?since=N` | — | 实时行为日志增量 | `NM8.log.get(since)` + 落盘 `nm8_logs/*.jsonl` |

- **`selectTarget()` 容错**：并行探测所有 9333 页面，跳过卡死页（超时），优先选「已在对局」页；即使扩展未加载也回退连存活页（先验证浏览器操控）。
- **`/fieldlog` 落盘**：每局 `/start` 轮转 jsonl，后台每 800ms 增量 append；其他 AI 可直读该文件或走接口。

> 完整字段见 `extension/nm8_console/AI接口说明.md`。

---

## 7. 参考项目与网页链接

### 官方 / 权威源码（一切以源码为准）

- **无名杀本体（诗笺版基于此分支）**：<https://github.com/libnoname/noname>
- **诗笺版安卓仓库**：<https://github.com/nonameShijian/noname-shijian-android>
- **无名杀原版（libccy）**：<https://github.com/libccy/noname>

### 扩展开发文档（本扩展写法依据的权威资料）

- **无名杀开发文档（API + 扩展教程，社区最权威）**：<https://fuwuzhizi.github.io/other/noname/index.html>
  - 重点章节：扩展教程 / 全局变量 `lib`/`game`/`ui`/`get`/`ai`/`_status` / 事件 / `player`/`card`
- **扩展结构快速说明**：<https://fuwuzhizi.github.io/other/noname/extension.html>
  - 本扩展的 `precontent` / `content` / 对象式 `export default` 写法即遵循此文
- **新手向扩展编写教程（章节式，含武将/技能/卡牌）**：<https://github.com/Programming010-cpu/noname>

### 社区 / 工具

- **离线包拖入导入扩展（DragRead，把 zip 拖进游戏即导入）**：<https://github.com/nonameShijian/extinsion-DragRead>
- **无名杀吧（百度贴吧）**：<https://tieba.baidu.com/f?kw=%E6%97%A0%E5%90%8D%E6%9D%80>

> 本扩展复用官方机制清单：`lib.config.ignore_error`（容错）、`lib.video`（录像缓冲）、`lib.cheat.*`（作弊）、`game.addVideo`（录像写入）、`Player.prototype.isMine`（接管）、`ai.basic.*`（内置 AI）、`ui.control`/`ui.commandnode`（官方面板/命令行）。全部为公开 API，未 hook 任何私有字段。

---

## 8. 已知限制与排查

### 8.1 自动驱动可能停在某冷门技能
诗笺版 `free_choose` 随机将若抽到 **OL / 自定义技能** 武将（如 `olshengong`/`huituo`/`dcpingxi` 等），部分技能自身缺 AI、无 UI 选择器，引擎会停在事件上。规避：用 `NM8.pickCharacter(n)` 指定将，或临时关掉对应内容扩展。开启 `setIgnoreError(true)` 后，异常被吞、事件续推，但仍可能跳过该技能效果。

### 8.2 排障清单
- 网关 `cdp:false` → 先开游戏（带 9333）。
- `curl` 假 502 → 加 `--noproxy '*'`。
- 扩展不生效 → 确认扩展已勾选并重启；F12 输入 `NM8.help()` 验证。
- 引擎原始报错 → 查 `NM8.log2()` 的 `kind:"engineError"`（已在 `/errors` 聚合）。

---

## 9. 后续计划

- [x] v3.4.0 引擎容错 + 全局错误捕获（自动驱动不再卡死）
- [ ] 面板「健康灯」+ 异常聚合分组（见 `extension/nm8_console/改进建议.md`）
- [ ] 新手引导向导、实时对局时间线
- [ ] **武将 / 技能 / 卡牌编写学习**：后续将基于上述参考文档，扩展 `extension/nm8_console` 之外的独立「内容扩展」，按官方规范新增武将（character）、技能（skill）、卡牌（card）。模板见 `extension/nm8_console/扩展示例-技能与卡牌.md`。

---

## 10. 许可证

本扩展为个人/学习用途工具。无名杀游戏内容版权归原作者与诗笺所有；扩展本身遵循其仓库许可证（如有）。使用前请遵守无名杀相关开源协议与社区规范。
