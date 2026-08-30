> ⚠️ **声明（AI 生成 · 仅供参考）**
>
> 本文档及其配套代码**由 AI 生成**；**仅适用于《无名杀》PC 版**；**仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）**，其他版本未经验证；内容**仅供参考**，使用风险自负。

# NNM8 · 无名杀(Noname) 浏览器控制与 AI 自动对局控制台

> **🔎 NNM8 是什么？** NNM8 是本项目的**对外代号**（读作 N-N-M-8），全称 **无名杀(Noname) 的 NM8 浏览器控制与 AI 自动对局控制台**。
> 拆解：第一个 **N** = Noname（无名杀引擎英文名）；第二个 **N** = 无名（中文名「无名杀」的「无名」）；**M8** = 沿用原 NM8 控制台命名（M=Mode/控制台，8 为社区习惯数字后缀，无特殊含义，仅作区分）。
> 一句话：**用浏览器(Chrome DevTools/CDP) 控制《无名杀》，并接一个 AI 帮你自动打牌的扩展方案。** 代码里 `window.NM8` 与 `window.NNM8` 是同一个对象的两个名字，互相通用——搜「NNM8」或「NM8」都能找到本项目。

- **版本**：扩展 `v3.4.0` ｜ 网关 `nm8_api.cjs` v1.2 ｜ 游戏 `无名杀 诗笺版 Windows64 位 v1.75`（引擎内部 1.11.5）
- **类型**：工具型扩展（AI 控制台 + 对外控制接口），**不含武将/卡牌内容**
- **核心特性**：实时监控全场 / 智能接管决策 / 内置 AI 自动驱动 / 官方作弊·引擎原生操控封装 / 复用官方录像的实时行为日志 / 引擎容错（自动驱动不再因内容包 bug 卡死）

---

> 🤖 **【开头 · 给人类用户与协作 AI 的重要提示】建议把本项目链接直接发给 AI 自主学习**
>
> 本仓库是**为「AI 自主操控《无名杀》」而设计**的。你可以把本仓库链接直接交给任意一个 AI（OpenClaw / WorkBuddy / ChatGPT / Claude 等），它会读完本说明 + 控制台接口契约后**自主完成相关任务**，无需你一步步教。
>
> **怎么交给 AI（复制下面这段即可）：**
>
> > 仓库：https://github.com/seeyouagain-laoda/nnm8-noname-browser-ai-control
> > 任务：请阅读该仓库的 README 与 `extension/nm8_console` 扩展代码，学会用 NM8 控制台通过浏览器控制《无名杀》（诗笺版 v1.75），然后：① 拉起带调试端口的游戏；② 接管决策；③ 自动开局并驱动对战；④ 实时读取场上状态；⑤ 必要时用操控接口改局面。所有能力都挂在 `window.NM8`（别名 `window.NNM8`），无需你懂无名杀内部 API。
>
> AI 拿到链接后会自己学这三件事：**① 无名杀在浏览器里怎么运行/怎么"玩"**（见第 1 节）；**② 控制台有哪些功能、怎么操作**（见第 2 节）；**③ 怎么接入控制台、操控武将打牌**（见第 3 节）。遇到异常时查第 4 节的踩坑记录即可排查。

---

## 目录

1. [指导 AI 学会如何通过浏览器使用无名杀](#1-指导-ai-学会如何通过浏览器使用无名杀)
2. [控制台相关的功能与操作说明](#2-控制台相关的功能与操作说明)
3. [AI 如何接入控制台并操控武将进行对打](#3-ai-如何接入控制台并操控武将进行对打)
4. [实际操作踩坑记录（原因 / 表现 / 排查 / 解决）](#4-实际操作踩坑记录原因--表现--排查--解决)
5. [许可证](#5-许可证)

---

## 1. 指导 AI 学会如何通过浏览器使用无名杀

本节让 AI 先理解「无名杀在浏览器里是什么、怎么跑、怎么玩」，再谈怎么控制它。

### 1.1 无名杀本质：跑在浏览器内核里的游戏

《无名杀》是一套**网页游戏**，PC 版（诗笺版）用 **Electron + Chromium** 内核运行，本质就是「一个加载了游戏引擎的网页」。游戏引擎通过 ESM 注入一组全局对象：

```
lib / game / ui / get / ai / _status
```

- `lib`：常量、配置、工具函数、卡牌/武将/技能的数据表。
- `game`：核心 API（`game.players`、`game.addVideo`、`game.import`、事件循环 `game.loop`/`game.resume` 等）。
- `ui`：界面与玩家输入（`ui.click.ok/cancel`、`ui.selectCard`、`ui.control` 等）。
- `get`：查询/判定（`get.attitude` 态度矩阵、`get.info` 取卡牌信息等）。
- `ai`：引擎内置 AI（`ai.basic.*` 选牌/选目标/选按钮）。
- `_status`：对局运行时状态（当前事件 `_status.event`、是否暂停 `_status.paused` 等）。

> 这些全局**只在游戏网页的 JS 上下文里存在**，是引擎 ESM 模块变量。**CDP 的全局作用域里看不到 `_status`/`game`/`lib`**（详见第 4 节坑 4.5），必须通过 `window.NM8` 这类挂在 `window` 上的稳定契约去访问。

### 1.2 AI 必须知道的运行前置条件

| 项目 | 要求 | 说明 |
|---|---|---|
| 游戏本体 | 无名杀 诗笺版 Windows64 位 **v1.75**（引擎 1.11.5） | 其他分支（棘手/国战）事件模型不同，未验证 |
| 浏览器内核 | 游戏自带 Chromium（Electron） | 纯扩展形态无需额外浏览器 |
| 远程调试端口 | 游戏需以 `--remote-debugging-port=9333` 启动 | 仅 HTTP 网关形态（让外部 AI 控制）需要；**9222 被 WorkBuddy 占用，别抢** |
| Node.js | ≥ 16（仅网关需要） | 网关用 CommonJS；扩展内 `await` 由游戏内核执行，与本地 Node 无关 |
| 依赖 | `ws`（仅网关 WebSocket 通信） | `npm install ws`，或 `set NODE_PATH=...` 指向已装目录 |
| 端口 | 9333 游戏调试 / 8091 桥接 / 8092 HTTP 网关 | 全部监听 `127.0.0.1`，不对外暴露；网关无鉴权（仅本机 AI 调） |
| 系统 | 主测 Windows 10/11 64 位 | 扩展本体跨平台；网关 `ws` 也跨平台 |

> 为什么强调版本：无名杀不同分支的事件模型与 `lib` 结构有差异。本扩展基于 v1.75 诗笺版实测；其它版本可能需微调。

### 1.3 无名杀在浏览器里怎么"玩"：界面与决策模型

AI 要理解「一局游戏」在浏览器里的形态：

- **座位**：`game.players` 是一组 `Player` 对象（座位 0,1,2…），每人有武将、身份、体力、手牌（`h`）、装备（`e`）、判定区（`j`）、技能、状态。
- **回合 6 阶段**（引擎 `content.js`）：`phaseZhunbei（准备）→ phaseJudge（判定）→ phaseDraw（摸牌）→ phaseUse（出牌）→ phaseDiscard（弃牌）→ phaseJieshu（结束）`。
- **决策事件**：当轮到某座位需要做选择（出牌/响应/选目标/选按钮），引擎产生一个事件，停在 `ui` 上等玩家点。此时界面出现可点击的**卡牌 / 角色 / 按钮**。AI 的「接管」就是替玩家把这些点击做完。
- **技能触发**：武将技能通过 `trigger`（触发时机）+ `filter`（条件）+ `content`（效果）+ `ai`（AI 决策）四要素定义。引擎在对应时机自动调用。

### 1.4 用浏览器自动化操控游戏：CDP 通道

让「外部 AI 程序」控制游戏，需要一条 **Chrome DevTools Protocol（CDP）** 通道：

```
你的 AI ──HTTP──> nm8_api.cjs (8092)
                     │ CDP (WebSocket, Runtime.evaluate)
                     ▼
              游戏 Chrome (9333, --remote-debugging-port)
                     │ window.NM8
                     ▼
              无名杀引擎 (lib / game / ui / get / ai / _status)
```

- 用到的 CDP 方法：`Runtime.evaluate`（在游戏页执行 JS 取返回值）、`Page.reload`（热重载）、`Target.getTargets`/`attachToTarget`（定位游戏页）。Chrome ≥ 80 全支持。
- 游戏必须带调试端口启动：本项目用 `server/start_game_chrome.py` 以 `--remote-debugging-port=9333` 拉起（用 `DETACHED_PROCESS` 避免被沙箱回收）。

### 1.5 参考项目与网页链接（给 AI 学习用）

**官方 / 权威源码（一切以源码为准）**

- 无名杀本体（诗笺版基于此分支）：<https://github.com/libnoname/noname>
- 诗笺版安卓仓库：<https://github.com/nonameShijian/noname-shijian-android>
- 无名杀原版（libccy）：<https://github.com/libccy/noname>

**扩展开发文档（本扩展写法依据的权威资料）**

- 无名杀开发文档（API + 扩展教程，社区最权威）：<https://fuwuzhizi.github.io/other/noname/index.html>
- 扩展结构快速说明：<https://fuwuzhizi.github.io/other/noname/extension.html>
- 新手向扩展编写教程（章节式，含武将/技能/卡牌）：<https://github.com/Programming010-cpu/noname>

**社区 / 工具**

- 离线包拖入导入扩展（DragRead）：<https://github.com/nonameShijian/extinsion-DragRead>
- 无名杀吧：<https://tieba.baidu.com/f?kw=%E6%97%A0%E5%90%8D%E6%9D%80>

> 本扩展复用官方机制清单：`lib.config.ignore_error`（容错）、`lib.video`（录像缓冲）、`lib.cheat.*`（作弊）、`game.addVideo`（录像写入）、`Player.prototype.isMine`（接管）、`ai.basic.*`（内置 AI）、`ui.control`/`ui.commandnode`（官方面板/命令行）。全部为公开 API，未 hook 任何私有字段。

---

## 2. 控制台相关的功能与操作说明

### 2.1 控制台是什么

控制台 = 扩展 `extension/nm8_console`，它把"观测 + 操控 + 驱动"三类能力挂在 **`window.NM8`**（别名 `window.NNM8`）上。安装并进入对局后，按 **F9** 出现毛玻璃悬浮面板（可拖拽/折叠），或 F12 控制台执行 `NM8.help()` 看全部接口。

| 能力 | 接口 | 说明 |
|---|---|---|
| 全场监控 | `NM8.snapshot()` / `NM8.players()` / `NM8.event()` | 座位/武将/身份/体力/手牌/装备/判定/技能/存活，实时只读 |
| 智能接管 | `NM8.takeover()` / `NM8.setMode()` | 只对「真决策」事件接管，引擎自行推进的事件放行 |
| 自动驱动 | `NM8.autoRun()` / `NM8.step()` / `NM8.decide()` | 内置 AI 全自动出牌；或 hybrid 模式暂停等外部 AI 决策 |
| 引擎操控 | `NM8.cheat.*` / `NM8.god.*` / `NM8.control.*` | 官方作弊 / 引擎原生任意座位操控 / 官方面板·命令行 |
| 实时日志 | `NM8.log.*` / `NM8.video()` | 复用官方录像缓冲 `lib.video`，零副作用 |
| 容错 | `NM8.setIgnoreError()` / `NM8.recover()` | 内容包 bug 不再冻结整局 |
| 浮层 | F9 / `NM8.showPanel()` | 实时刷新悬浮面板 |

### 2.2 安装与启用

**方式一：官方「导入扩展」（推荐）**
1. 下载发布包 `nm8_console_vX.Y.Z.zip`（或用 `tools/build_package.py` 生成）。
2. 游戏内：「扩展」→「获取扩展」→「导入扩展」→ 选 zip。
3. 勾选 **nm8_console** → 重启游戏。验证：进对局按 F9 出面板，或 `NM8.help()`。

**方式二：复制文件夹（开发用）**
```bat
xcopy /E /I extension\nm8_console "<游戏目录>\resources\app\extension\nm8_console\"
```
重启游戏即可。

**方式三：HTTP 网关（给其他 AI）**
```bat
set NODE_PATH=C:\Users\user\.workbuddy\binaries\node\workspace\node_modules
node server\nm8_api.cjs
:: 健康： curl --noproxy '*' http://127.0.0.1:8092/api/v1/health
```

### 2.3 监控层（只读、零副作用，可无脑轮询）

**`NM8.snapshot()`**
- 功能：全场 JSON 快照（座位/武将/身份/体力/手牌/装备/判定/技能/态度矩阵）。
- 实现：`readPlayer(p)` 遍历 `game.players`，逐项调 `p.getCards('h'|'e'|'j')`、`p.hp/maxHp/isDead()`；`currentEvent()` 读 `_status.event`；态度用 `get.attitude(pa,pb)`。
- 原因：**纯只读、不触发任何 `update`/动画**，可安全高频轮询。

**`NM8.players()` / `NM8.event()`**
- 实现：分别是 `snapshot().players` 数组版、`_status.event` 精简版。原因：给只需座位列表/当前事件的调用方省流量。

### 2.4 接管 / 驱动层（自动对局不卡死的关键）

**`NM8.takeover(on)`**
- 功能：开/关「接管全部座位决策」。
- 实现：`installTakeover()` 把 `Player.prototype.isMine` 替换为自写版本——仅当 `needsPlayerDecision()` 为真（事件带 `filterCard/filterTarget/filterOk/chooseButton…` 且不在 `ENGINE_DRIVEN_EVENTS` 黑名单）才返回 `true`；否则 `false` 放行给引擎内置 AI。
- 原因：**这是自动驱动不卡死的关键**。早期对所有事件一律 `isMine=true`，连摸牌/伤害也接管，导致引擎在无确定按钮的事件上干等、内置 AI 无处点 → 主线程死循环。只接管真决策，引擎自行推进的事件交回官方 AI，互不干扰。

**`NM8.autoRun(on, interval=900)`**
- 功能：每 `interval` 毫秒自动推进一步。实现：`setInterval` 内 `if(_status.paused) step(true)` + `watchdog()` + `renderPanel()`。原因：900ms 留足引擎动画/结算时间（太快会抢在动画前点下一事件）。

**`NM8.step(forceBuiltin)`**
- 功能：走一步决策。hybrid 模式下遇关键决策（出杀/桃/无懈/决斗…）返回 `{pending:true, ask}`，暂停等外部 AI。实现：`step()` → 命中关键事件则 `S.pendingPause=true` 返回；否则 `builtinDecide()`。原因：hybrid 让「外部 AI 接管关键节点、引擎跑流程」成为可能。

**`NM8.decide(cmd)`**
- 功能：外部 AI 下发 `ok/cancel/cards/targets/button`。实现：`ui.clear()` + `ui.selectCard/selectTarget` + `ui.click.ok/cancel`；`button` 按 DOM 索引点击。原因：hybrid 模式外部 AI 的唯一下发入口，与 `step` 的 `pending` 闭环。

**`builtinDecide()`（内部）**
- 实现：先 `game.check()` 一键确定；否则按事件名分路——`chooseButton` 用 `ai.basic.chooseButton`、`chooseToUse` 用 `ai.basic.chooseCard/chooseTarget`、`chooseToRespond/chooseToDiscard` 手动选第一张合法牌；`filterOk` 不过则取消/结束阶段/redo（限 `MAX_REDO` 次）。
- 原因：**全程复用引擎原生 `ai.basic.*` 与官方 `filterOk`**，不自己造选牌逻辑——早期手动塞牌引用会触发 `get.info(card).noai` 崩溃（`player.js:7482`）。求桃/弃牌没选到牌**必须取消**（=放弃响应），否则引擎拿空结果永久卡 `respond`。

### 2.5 操控层（cheat / god / control）

**`NM8.cheat.*`（官方作弊通道，最稳）**
- `give(card, seat)` / `giveAll` / `equip` / `draw` / `peek` / `identities`
- 实现：全部包 `lib.cheat.gx/gg/ge/d/h/id`。原因：官方作弊通道同步插手牌 DOM，实测进手牌。

**`NM8.god.*`（引擎原生操控）**
- `setHp(seat,v)` / `heal(seat,n)`：同步直改 `p.hp` 并 `p.update()`；`heal` 钳制到 `p.maxHp`。原因：异步事件的 `.then` 在 CDP 序列化下返回 `null`（不稳定），同步直改返回值可靠。
- `hurt(seat,n)` / `loseHp` / `kill`：实现 `p.damage({num,nocard,nosource}).start()` / `p.loseHp(n).start()` / `p.die().start()`。原因：**v3.2.0 关键发现**——`damage/recover/gain/die/loseHp` 等方法**只创建事件、不自动运行**，必须由 `.start()` 真正启动才结算（`gameEvent.js:196`）。直接调只是建了个不跑的事件，正是「扣血不结算/死不置位」的根因。
- `give(seat,card)`：`lib.cheat.gx(card,p)`，稳定进手牌。
- `addSkill` / `revive` / `setIdentity`：引擎同步方法，直接调即可，无需 `.start()`。
- `winner()`：自写胜负判定（主公存活且其余非内奸→主公胜；反贼全灭且无内奸→主公胜；否则 `null`）。原因：引擎无单一「当前胜者」API。

**`NM8.control.*`（官方面板 / 命令行）**
- `open()` / `command(code)`：实现 `ui.control.show()` / 往 `ui.commandnode` 灌 `code` 触发执行。原因：复用官方「控制面板/命令行」，等价于游戏内「其他→命令」。

### 2.6 日志层

**`NM8.log.len() / head(n) / tail(since,n) / get(since)`**
- 实现：**直接读官方录像缓冲 `lib.video`**（`game.addVideo` 每次动作同步 `push`，源码 `game/index.js`）。`mapVideoEvent` 把 `player` 字段归一化为座位号。
- 原因：**v3.3.0 重大优化——复用官方机制**。早期自己包裹 `addVideo` 写第二份缓冲，冗余且可能漏事件；现在与官方录像同源、零副作用。

**`NM8.video(n)`**：`JSON.stringify(lib.video)` 原始官方录像。**`NM8.log2()`**：返回 NM8 自身操作日志 `S.log`（区分于「场上发生了什么」）。

### 2.7 容错层（v3.4.0 新增）

**`NM8.setIgnoreError(on)`**
- 功能：开/关引擎容错。实现：设 `lib.config.ignore_error`。
- 原因：**直击自动驱动卡死根因**。引擎 `gameEvent.js:232` 的 `this.content(this).catch(...)` 仅在 `ignore_error` 为真时吞掉 content 异常并继续推进，否则 `throw` 冻结整局；而 `content.js:9996` 通用「响应」动画 `event.card.name` 在 `event.card` 未定义时（内容包 bug）会抛错。`setIgnoreError(true)` 让这类 bug 不再卡死，`false` 恢复引擎默认冻结（便于人工定位）。默认开。

**`NM8.recover()`**
- 功能：卡死时最后兜底。实现：依次 `event.finish()` → `game.resume()` → `game.loop()`。原因：看门狗多级挽救无效时的终极手段；配合 `setIgnoreError` 双保险。

### 2.8 浮层 / 工具

- `NM8.showPanel(on)` / `togglePanel()`：控制悬浮面板（F9 等价）。
- `NM8.setForcePlay(on)`：开/关「强制出牌」（默认关，避免无选牌强点确定被引擎驳回死循环）。
- `NM8.pickCharacter(n)` / `listCharacters()`：DOM 点击武将卡 / 列可选武将坐标。
- `NM8.quickStart()`：`takeover(true)` + 显面板 + `autoRun(true)` 一键串起。
- `NM8.help()`：返回接口字典。

### 2.9 HTTP 网关 `nm8_api.cjs`（控制台对外出口）

架构：`你的 AI ──HTTP──> 网关 ──CDP──> window.NM8`。全部返回 `{success, data|error}`。

| 方法 & 路径 | 参数 | 功能 |
|---|---|---|
| `GET /api/v1/health` | — | 连接状态：`cdp`/`nm8`/`version`/`inGame` |
| `GET /api/v1/state` | — | 全场状态：`state`/`snapshot`/`players`/`event`/`paused`/`autoRun`/`mode` |
| `GET /api/v1/players` | — | 座位数组 |
| `POST /api/v1/start` | `{n:5, autoRun:true}` | 一键开局+自动驱动 |
| `POST /api/v1/stop` | — | 停自动驱动 |
| `POST /api/v1/give` | `{card,seat}` | 发牌 |
| `POST /api/v1/heal` `/hurt` `/kill` `/revive` `/giveCard` | `{seat,…}` | 引擎操控 |
| `POST /api/v1/decide` | `{action,…}` | 外部决策 |
| `POST /api/v1/exec` | `{expression}` | 游戏页内执行任意 JS（**逃生舱**） |
| `POST /api/v1/reload` | — | 重载游戏页 |
| `GET /api/v1/fieldlog?since=N` | — | 实时行为日志增量 |

- `selectTarget()` 容错：并行探测所有 9333 页面，跳过卡死页（超时），优先选「已在对局」页。
- `/fieldlog` 落盘：每局 `/start` 轮转 jsonl，后台每 800ms 增量 append；其他 AI 可直读文件或走接口。

---

## 3. AI 如何接入控制台并操控武将进行对打

### 3.1 三步接入

1. **开游戏**（带 9333 调试端口）：`python server/start_game_chrome.py`
2. **开网关**：`node server/nm8_api.cjs`（设好 `NODE_PATH`）
3. **调接口驱动**：通过 HTTP 调 `nm8_api.cjs`，网关经 CDP 调 `window.NM8`。

> 本机有 Clash 代理（7897）时，所有 `curl` 必须加 `--noproxy '*'`，否则被拦成假 502。

### 3.2 一键开局 + 自动驱动（builtin 模式）

```bash
# 检查网关连上游戏
curl --noproxy '*' http://127.0.0.1:8092/api/v1/health
# {"success":true,"data":{"cdp":true,"nm8":"object","version":"3.4.0","inGame":false}}

# 一键开局 5 人身份局并自动驱动（内置 AI 全自动出牌）
curl -X POST --noproxy '*' http://127.0.0.1:8092/api/v1/start \
  -H "Content-Type: application/json" -d '{"n":5}'

# 轮询状态（不要阻塞等 /start，它内部要点选将）
curl --noproxy '*' http://127.0.0.1:8092/api/v1/state
```

`/start` 内部：`set mode_config.identity` → 点「身份」→ 选将（关 `free_choose` 用官方将池规避缺 AI 将）→ 开始 → `autoRun(true)`。之后引擎内置 AI 全自动出牌，AI 只需轮询 `state` 看战况。

### 3.3 hybrid 模式：AI 接管关键决策

若想让**外部 AI 自己决定关键出牌**（而非内置 AI），用 hybrid：

1. `POST /api/v1/start` 后，调 `POST /api/v1/decide` 或在 `exec` 里设 `NM8.setMode('hybrid')`。
2. 引擎遇关键事件（出杀/桃/无懈/决斗…）会 `step()` 返回 `{pending:true, ask}`，暂停。
3. 外部 AI 读 `ask`（需要什么决策），算好后用 `POST /api/v1/decide` 下发 `ok/cancel/cards/targets/button`。
4. 循环直到对局结束。

> 这是「AI 操控武将对打」的标准形态：AI 不重写游戏逻辑，只通过决策接口下指令，引擎负责结算。

### 3.4 实战调用流程示例

```bash
# 1) 看全场（谁、什么将、几血、什么身份）
curl --noproxy '*' http://127.0.0.1:8092/api/v1/state

# 2) 给某座位发一张「杀」测试操控
curl -X POST --noproxy '*' http://127.0.0.1:8092/api/v1/give \
  -H "Content-Type: application/json" -d '{"card":"sha","seat":0}'

# 3) 暂停自动驱动，改为外部接管
curl -X POST --noproxy '*' http://127.0.0.1:8092/api/v1/stop

# 4) 任意未覆盖能力走逃生舱
curl -X POST --noproxy '*' http://127.0.0.1:8092/api/v1/exec \
  -H "Content-Type: application/json" \
  -d '{"expression":"window.NM8.snapshot().players.map(p=>({seat:p.seat,hp:p.hp,name:p.name}))"}'
```

### 3.5 给其他 AI 的契约要点

- **稳定入口只有 `window.NM8` / `window.NNM8`**：不要直接读 `_status`/`game`/`lib`（CDP 全局不可见，见 4.5）。
- **任何未覆盖能力用 `/api/v1/exec` 逃生舱**：在游戏页内执行任意 JS，返回序列化结果。
- **轮询而非阻塞**：`/start` 是异步长任务，发起后立即轮询 `/state`。
- **异常被拦截不卡死**：引擎报错弹窗已被扩展拦截写入 `NM8.log2()`，排障查 `kind:"engineError"` / `kind:"alert"`。
- **容错默认开**：内容包 bug 不再冻结；若需人工定位 bug，临时 `NM8.setIgnoreError(false)`。

---

## 4. 实际操作踩坑记录（原因 / 表现 / 排查 / 解决）

> 以下均为 v1.75 诗笺版实测踩过的坑，按「原因 → 表现 → 排查 → 解决」四段写清细节，供 AI 与人类排障复用。

### 4.1 自动对局卡死在 `respond@0`（引擎内容包 bug）

- **原因**：引擎 `library/element/content.js:9996` 的通用「响应」动画里写 `player.tryCardAnimate(event.card, event.card.name, "wood")`，当 `event.card` 未定义（`undefined`）时访问 `.name` 抛 `TypeError`。而引擎错误处理器 `gameEvent.js:232` 的 `this.content(this).catch(...)` **仅在 `lib.config.ignore_error` 为真时才吞异常并继续**，否则 `throw` 冻结整局——这是引擎官方的 escape hatch。
- **表现**：自动驱动跑到某个响应事件（如被打「杀」需出「闪」）时彻底停住，主菜单/面板不再刷新，`autoRun` 卡死，控制台无新日志。
- **排查**：在扩展里加 `window error` + `unhandledrejection` 捕获（`installErrorCapture`），把异常写入 `NM8.log2()` 的 `kind:"engineError"`；从日志定位到 `event.card.name` 报错与调用栈 `content.js:9996`。
- **解决**：`precontent()` 里设 `lib.config.ignore_error = true`（启用官方容错），并暴露 `NM8.setIgnoreError(on)` 可切换；卡死时 `NM8.recover()` 依次 `event.finish()`→`game.resume()`→`game.loop()` 兜底。实测 5 人局自动跑到第 9 轮无卡死。

### 4.2 9222 调试端口被 WorkBuddy 桌面端占用

- **原因**：WorkBuddy 桌面端自身占用 9222 做 CDP。若游戏也用 9222，两者冲突，游戏调试端口起不来或被抢。
- **表现**：`start_game_chrome.py` 拉起后 `http://127.0.0.1:9222/json/version` 返回的是 WorkBuddy 而非游戏；网关 `cdp:false`。
- **排查**：`curl --noproxy '*' http://127.0.0.1:9222/json/version` 看 `Browser` 字段不是游戏内核。
- **解决**：游戏固定用 **9333**（`--remote-debugging-port=9333`），网关也探 9333；**绝不碰 9222**。

### 4.3 本机 Clash 代理把 localhost 请求拦成假 502

- **原因**：本机 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7897`（Clash）。`curl` 默认走代理，localhost 请求被代理当成外网，返回假 502。
- **表现**：`curl http://127.0.0.1:8092/...` 返回 `502` 或空，但网关进程其实正常。
- **排查**：`curl` 加 `--noproxy '*'` 后立刻 200，确认是代理问题。
- **解决**：所有访问本机端口的 `curl` 加 `--noproxy '*'`；Node 网关/推送走 `env -u HTTP_PROXY -u HTTPS_PROXY`（见 4.10）；或临时 `set NO_PROXY=127.0.0.1,localhost`。

### 4.4 CDP 连得上但 `1+1` 超时 = 模态弹窗阻塞

- **原因**：渲染进程被**模态弹窗（alert/confirm）**阻塞时，`Runtime.evaluate` 会一直等弹窗关闭而超时——**不等于 JS 死循环**。引擎报错常走 `alert`。
- **表现**：CDP 连上、Target 也能 attach，但执行任意表达式都超时（哪怕 `1+1`）。
- **排查**：监听 `Page.javascriptDialogOpening` 事件，确认有未关弹窗。
- **解决**：扩展 `installAlertShield()` 覆写 `window.alert`（改为写日志、不弹窗），释放渲染进程；排障查 `NM8.log2()` 的 `kind:"alert"`。

### 4.5 `_status` / `game` 是 ESM 模块变量，CDP 全局不可见

- **原因**：无名杀用 ESM 加载引擎，`_status`/`game`/`lib` 是模块作用域变量，**没有挂到 `window`**。CDP 的 `Runtime.evaluate` 在全局作用域执行，直接引用会报 `not defined`。
- **表现**：`Runtime.evaluate("game.players.length")` 返回错误 `game is not defined`，但游戏网页内 F12 控制台能正常用 `game`。
- **排查**：在扩展里把 `game.players` 通过 `window.NM8` 暴露，CDP 改用 `window.NM8.players()` 即正常。
- **解决**：**所有跨 CDP 的访问都走 `window.NM8`/`window.NNM8` 契约**，绝不直读引擎模块变量。

### 4.6 对象式导出加载期不执行函数，`window.NM8` 主菜单不可见

- **原因**：v1.75 加载器（`noname/game/index.js:2686`）对**对象式 `export default`** 不在加载期执行任何函数。若 `window.NM8` 在文件顶层直接赋值，主菜单就能用；但若只在某个 `content()` 回调里赋值，则须等进入对局才出现——开局前网关连不上。
- **表现**：主菜单时 `NM8.help()` 报 `NM8 is not defined`，进对局后才正常。
- **排查**：在 `precontent()` 末尾显式 `buildAPI()` 初始化一次，确保 `window.NM8` 在主菜单即可用。
- **解决**：初始化逻辑放 `precontent()`（或顶层），不在 `content` 回调里延迟初始化；并加 `window.NNM8 = window.NM8` 别名。

### 4.7 技能缺 `ai` 字段 → 引擎永久停在事件

- **原因**：引擎事件 `event.isMine()` 返回真时走 `event.result="ai"`（内置 AI）；若技能对象**没有 `ai` 字段**，内置 AI 不知道怎么决策，引擎在事件上永久等待。
- **表现**：自动/接管对局走到某武将技能触发时卡住，无后续。
- **排查**：检查该技能定义是否缺 `ai`；`NM8.log2()` 看是否停在对应技能事件。
- **解决**：**写自定义技能务必补 `ai` 字段**（至少 `ai:{basic(){...}}` 给默认行为）；用 `free_choose=false` 指定官方将池规避缺 AI 的 OL/自定义将；已开 `setIgnoreError` 时异常被吞但仍可能跳过效果。

### 4.8 事件方法只创建不运行，必须 `.start()`

- **原因**：无名杀事件模型里 `damage/recover/gain/die/loseHp` 等方法**只创建事件对象、不自动运行**，须由 `.start()` 真正启动才结算（`gameEvent.js:196`）。直接调只是建了个不跑的事件。
- **表现**：调 `p.damage(...)` 后角色不掉血、不进濒死；调 `p.die()` 后角色不置位死亡。
- **排查**：对比引擎源码，确认这些方法返回事件对象而非立即结算。
- **解决**：操控类一律 `p.damage({...}).start()` / `p.die().start()` / `p.loseHp(n).start()`；同步直改体力（`p.hp=...;p.update()`）也需 `.update()` 刷新界面。

### 4.9 国战模式加载 ESM 崩溃

- **原因**：v1.75 网页版加载 `mode/guozhan/index.js`（ESM）时崩溃，国战模式在当前架构不可用。
- **表现**：选国战模式进不去，控制台报 ESM 加载错误。
- **排查**：控制台报错栈指向 `mode/guozhan/index.js`。
- **解决**：本项目**明确排除国战（guozhan）**，只支持身份局（identity）及其子模式（normal/zhong/purple/stratagem）。需国战另行调研兼容方案。

### 4.10 GitHub 推送：gh 未登录 / 令牌过期

- **原因**：本机 `gh` 未登录、`git` 无 user.name/email、无 `GH_TOKEN`；WorkBuddy 连接器存的 `ghu_` 是 GitHub App 短时效令牌，已过期（API 返回 401）。
- **表现**：`git push` 报无权限/无 remote；`gh auth status` 提示未登录。
- **排查**：`gh auth status`、`git config --global user.name`、`cmdkey /list` 查凭据管理器、`~/.git-credentials` 是否存在——均无可用写令牌。
- **解决**：用 **classic PAT**（`ghp_` 开头，作用域 `repo`）建仓推送：
  ```bash
  git config user.name "seeyouagain-laoda"
  git config user.email "96473119+seeyouagain-laoda@users.noreply.github.com"
  git remote add origin https://github.com/seeyouagain-laoda/<repo>.git
  env -u HTTP_PROXY -u HTTPS_PROXY GIT_HTTP_PROXY= GIT_HTTPS_PROXY= \
    git -c "url.https://${PAT}@github.com/.insteadOf=https://github.com/" push -u origin main
  ```
  > ⚠️ **安全**：令牌仅用于本次授权，不要写进 `.git/config` 或任何文档/记忆。本机有 Clash 时推送必须 `env -u HTTP_PROXY`（直连，否则 403）。

### 4.11 快速排障口诀

- 网关 `cdp:false` → 先开游戏（带 9333）。
- `curl` 假 502 → 加 `--noproxy '*'`。
- 扩展不生效 → 确认勾选并重启；F12 `NM8.help()` 验证。
- 引擎原始报错 → 查 `NM8.log2()` 的 `kind:"engineError"`（已在 `/errors` 聚合）。
- 自动驱动停在某冷门技能 → 用 `NM8.pickCharacter(n)` 指定将，或临时关对应内容扩展；开 `setIgnoreError(true)` 可续推。

---

## 5. 许可证

本扩展为个人/学习用途工具。无名杀游戏内容版权归原作者与诗笺所有；扩展本身遵循其仓库许可证（如有）。使用前请遵守无名杀相关开源协议与社区规范。
