# 更新日志

## v3.4.0（本次：引擎容错 + 全局错误捕获）

**根因（关键发现）**：自动驱动 5 人局时偶发卡死在 `respond@0`。溯源引擎源码发现：
`library/element/content.js:9996` 的通用「响应」动画 `player.tryCardAnimate(event.card, event.card.name, "wood")`
在 `event.card` 未定义时（`event.card.name` 抛 `TypeError`）崩溃；该调用位于事件 `content` 步骤内，
而引擎事件循环 `gameEvent.js:232` 的 `this.content(this).catch(...)` **仅在 `lib.config.ignore_error` 为真时
吞掉异常并继续推进**，否则 `throw error` 向上冒泡冻结整局。本质是「内容包把（如某些将的 `onrespond` 路径）
未给足 `event.card`」的 bug，但引擎默认不容错。

### 修复（复用官方机制，不碰游戏 ROOT 源码）
- 扩展 `precontent` 阶段将 `lib.config.ignore_error = true`（官方容错开关），并把开关暴露为
  `NM8.setIgnoreError(on)`（默认开；调试时 `setIgnoreError(false)` 恢复引擎默认冻结行为便于定位）
- 新增 `installErrorCapture()`：全局 `error` / `unhandledrejection` 捕获，把被吞的引擎异常（及 trigger 层冒泡的异常）
  写入 `NM8.log2()`，并在 `S.errorCount` 计数。**容错续推的同时，用户仍可在 `/errors` 看到「刚才哪里出错」**，可见性不丢
- 新增 `NM8.recover()`：卡死时的最后兜底，依次 `event.finish() → game.resume() → game.loop()` 推进一步；
  看门狗保留为第二道防线

### 效果
- 自动驱动不再因内容包把/决斗响应 bug 永久卡死，「自动玩两把 5 人局」稳定可完成
- `NM8.state.errorCount` 实时反映累计被吞异常数；`/errors` 接口可拉取

### 验证
- 重载扩展后 `NM8.VERSION === "3.4.0"`，`NM8.setIgnoreError(true)` 返回 `{ok:true,ignore_error:true}`
- 触发决斗响应路径：异常被吞、`game.print("游戏出错：respond")` 出现、事件继续推进、对局不冻结

---

## v3.3.0（本次重大优化）

全面复用官方机制、精简代码、修复隐藏 bug，使扩展「纯导入即用、无需额外配置」。

### 复用官方机制（去重）
- **对局日志改为直接读取官方录像缓冲 `lib.video`**（引擎每动作 `game.addVideo` 同步 push，源码 `noname/game/index.js`）。
  移除原先 `game.addVideo` 包裹 + 独立 `fieldLog.buf` 缓冲（重复造轮子、双份存储）。
  新增 `NM8.log` 读取器：`len() / head(n) / tail(since,n)`，对 `player` 字段做座位归一化，零修改游戏状态。
- **初始化改走官方生命周期钩子 `precontent`**（早于 arena 的早期初始化），移除文件末尾的模块级 `buildAPI()` hack。
  `window.NM8` 在对局开始前甚至主菜单即就绪，更符合 ESM 扩展规范。

### Bug 修复
- 修复 `watchdog()` 中 `now` 变量 TDZ 误用（声明在使用之后）：原每 tick 抛 `ReferenceError` 被吞，
  **自动挽救从未真正生效**。现 `const now = Date.now()` 提到函数顶部，看门狗恢复工作。

### 清理
- 移除 `fieldLog`/`video()` 中的冗余缓冲与归一化逻辑，统一由 `NM8.log` 承担。
- 接口名更清晰：`NM8.log.*` 取代旧的 `NM8.fieldLog.*`；内部操作日志更名 `NM8.log2()` 避免与行为日志混淆。
- 保留全部既有能力：监控 / 接管 / 决策 / 官方 cheat·god·control 封装 / 悬浮面板 / F9。

## v3.1.0（基线）

对齐无名杀 v1.75 官方扩展规范 + 修复全自动对局的崩溃/冻结问题。

### 规范对齐
- **默认导出改为对象式** `export default extensionPackage`（原为工厂函数），与官方内置扩展
  （玩点论杀 / 3D精选 / 英雄杀 / 欢乐卡牌 / 杀海拾遗）写法一致
- **从 `info.json` 读取元信息**填充 `extensionPackage.package`，修复扩展管理界面不显示
  作者/简介/版本的问题
- 补加载期 `buildAPI()` / `installTakeover()` 初始化，保证 `window.NM8` 在主菜单阶段即可用
  （对象式导出不会在加载期执行任何函数，否则 HTTP 网关开局前连不上）
- 补齐 `files: { character, card, skill, audio }` 声明

### 崩溃修复
- `forcePlay` 默认值 `true` → `false`（原值会导致未选牌强点确定、被引擎驳回形成死循环）
- `chooseToUse` 不再手动 `ui.selectCard()`：改用引擎同款 AI `ai.basic.chooseCard/chooseTarget`，
  修复 `get.info(card).noai` 崩溃（`player.js:7482`）
- 求桃 / 弃牌改手动选牌，且 **ai1/ai2 提供默认值**，修复 `basic.js:122` 的 `check is not a function`
- 引擎 AI 抛异常时**直接取消并返回**，不再继续走手动选牌路径
- `cancel + redo` 增加前置条件（`_aiexclude` 存在 且 次数 ≤ `MAX_REDO`），修复无限重选循环
- 求桃/弃牌**没选到牌必须取消**，修复引擎拿到空结果后永久卡在 `respond`

### 稳定性
- 新增 `installAlertShield()`：拦截引擎的 `alert`/`confirm`，改为写 `NM8.log()` 并尝试恢复。
  原行为会**阻塞渲染进程**，导致 CDP 连 `1+1` 都超时
- 新增**看门狗** `watchdog()`：步骤停滞 6s 起循环升级挽救
  （取消 → 确定 → 结束阶段 → 恢复引擎 → 再推进 → 强制结束事件）
- 看门狗停滞判定改用「事件对象 + 事件 step」复合签名（原用 `S.step`，写日志会自增导致永远卡在 1 级）
- `NM8.state` getter 过滤下划线内部字段与大对象图，修复 CDP 序列化
  `Object reference chain is too long`

### 接口
- `NM8.VERSION` → `3.1.0`
- 新增 `NM8.ENGINE_DRIVEN`（只读数组）：当前放行给引擎内置 AI 处理的事件名清单
- `NM8.state` 新增 `showPanel` 字段

---

## v3.2.0（本次：外挂结算修复）

**根因（关键发现）**：无名杀 v1.75 的事件模型中，`player.damage / recover / gain / die / loseHp`
等方法**只创建事件对象，不自动运行**。事件必须由 `event.start()`（`noname/library/element/gameEvent.js:196`）
真正启动才会结算。在 CD.../网关上下文直接调用这些方法，只是建了个不跑的事件——这正是外挂
`hp 不变 / 牌不进手 / 死不置位` 的根因。

### 外挂接口修复（全部实测通过）
- `god.give(seat, cardName)`：改用官方 `lib.cheat.gx(cardName, target)`（同步插手牌 DOM），
  **修复「发牌不进手牌」**（实测 4→6 张）
- `god.hurt(seat, n)` / `god.loseHp(seat, n)`：走 `p.damage({num,nocard,nosource}).start()`，
  **修复「扣血不结算」**（实测 3→2→1）
- `god.heal(seat, n)`：因 CDP 对 `recover` 异步事件的 `.then` 结果序列化不稳定（返回 null），
  改为**同步直改 `p.hp` 并 `p.update()`**（钳制到 `maxHp`），返回值可靠（实测 2→3→4）
- `god.kill(seat)`：走 `p.die().start()`，**正确置 `dead` 并更新 `game.dead` / `game.players` / 胜负判定**
  （实测 `dead:true`）
- `god.revive(seat)`：沿用引擎同步实现（实测 `0→1` 复活）
- `snapshot()` / `readPlayer()`：新增 `seat` 字段（= 座位 index 别名），**便于外部 AI 用 seat 索引**

### 网关（nm8_api.cjs）
- `/api/v1/heal` `/hurt` `/kill` `/revive` `/giveCard` 改为 `awaitPromise`（等待异步事件结算后再返回）
- 新增 `/api/v1/loseHp` 路由
- `/api/v1/start` 关闭 `free_choose`（用官方精选将池，规避 OL 将缺 AI 卡死）

### 验证
- 5 人身份局自动驱动：第 2→3 轮稳定推进，0 报错
- 外挂全量实测：give/giveCard/heal/hurt/kill/revive/setIdentity/winner 全部生效且返回值正确

---

## v3.2.1（本次：实时对局行为日志，供其他 AI 读取）

**目标**：把场上行为做成一份实时日志，让其他 AI（OpenClaw / WorkBuddy / 任意 HTTP 客户端 / 直读文件）
可以读取，用于复盘、训练、监控。

### 实时日志（纯观测，零影响对局）
- 新增 `NM8.fieldLog` 命名空间：`get(since)` 返回 `seq>since` 的事件数组、`len()`、`clear()`
- 实现方式：包裹引擎 `game.addVideo(type,player,content)`（`noname/game/index.js:4642`）。
  原样调用 + 多写一份到自己缓冲，**不碰血量/手牌/流程**。源码已证 `addVideo` 仅向 `lib.video` 数组
  push，本包裹在其外层只做 `fieldLogPush`（数组 push），故对局无任何副作用
- `player` 字段归一化为**座位号字符串**（`dataset.position` / `position` / `name` 兜底），
  不再泄漏裸 DOM 元素；事件结构 `{seq, t, type, player, content}`（type 同官方录像：
  markSkill/unmarkSkill/update/init/directgain/phase/play/draw/damage/die…）

### 网关落盘 + 对外接口（nm8_api.cjs）
- 新增 `GET /api/v1/fieldlog?since=N`：返回 `{file: 落盘jsonl路径, lastSeq, entries}`，供其他 AI 增量读取
- 每局 `/api/v1/start` 自动轮转日志文件 `nm8_logs/nm8_live_log_<时间戳>.jsonl`（追加写，每行一条合法 JSON）
- 后台每 800ms 增量拉取 `window.NM8.fieldLog.get(lastSeq)` 落盘；其他 AI 可**直接 tail 该 jsonl 文件**
- `autoStartExpr` 新开局时调 `NM8.fieldLog.clear()`，保证每局日志独立聚焦

### 验证
- 5 人局单步推进：落盘 180 行全合法 JSON；`/fieldlog` 返回 127 条增量；座位号正确（P=0~4）
- 对局无影响：日志仅 append 观察事件，未触发任何 `damage/gain/die/update` 状态变更

---

## v3.0.0
- AI 悬浮透明控制台（毛玻璃、可拖拽折叠、停靠右侧）
- 三层能力：`snapshot` 监控 / `takeover` 接管 / `cheat`·`god`·`control` 操控
- `window.NM8` 对外接口 + F9 快捷开关
- 官方集成：启用 `lib.config.cheat`，游戏控制栏注入「NM8」按钮

---

## 配套：HTTP AI 网关 `nm8_api.cjs`（v1.1，端口 8092）
- `/api/v1/start` 改为**只开 `autoRun`**，不再调用 `quickStart()`（避免全座位接管触发自定义技能卡死）
- 保留 `/api/v1/state` `/exec` `/decide` `/reload` `/health` 等路由
- 目标页选择：跳过卡死页、优先选「已在对局」页
