import { lib, game, ui, get, ai, _status } from "noname";

/**
 * nm8_console —— AI 悬浮透明控制台（v3.4.0）
 *
 * 设计原则（本版重大优化）：
 *   - 复用官方机制，不重复造轮子：对局日志直接读取官方录像缓冲 lib.video
 *     （引擎每次动作 game.addVideo 同步 push，见 noname/game/index.js），
 *     扩展只做「读取 + 座位归一化」，不再自维护第二份缓冲。
 *   - 初始化走官方生命周期钩子 precontent（早于 arena），移除文件末尾的模块级 hack。
 *   - 纯扩展导入即用：window.NM8 全部能力在浏览器内工作，无需任何 Node 服务 / 网关。
 *     （外部 AI 经 window.NM8 读取；如需落盘可另起可选的 HTTP 网桥，非必需。）
 *
 * 三层能力，全部挂在 window.NM8：
 *   监控层  snapshot()        全场座位（武将/身份/体力/手牌/装备/判定/技能/状态）
 *   接管层  takeover(true)    覆盖 Player.prototype.isMine，让全部座位走"暂停等输入"
 *   控制层  step()/decide()   内置 AI 代打 + 外部指令；并封装官方作弊/控制接口
 *          NM8.cheat.*  官方 lib.cheat 作弊（发牌/神装/加技能/摸牌/看手牌/显身份）
 *          NM8.god.*    引擎原生操控（任意座位 控血/伤害/发牌/秒杀/复活/改身份）
 *          NM8.control.* 官方控制面板/命令行（ui.commandnode / ui.control）
 *          NM8.log.*    官方录像缓冲 lib.video 的读取器（实时、归一化、供其他 AI 消费）
 * UI：右上角悬浮、半透明毛玻璃面板，可拖拽、可折叠，实时刷新全场状态；F9 切换。
 */

// ---------------------------------------------------------------- 状态

const S = {
	takeover: false,
	mode: "hybrid", // hybrid | builtin | external
	autoRun: false,
	pendingPause: false,
	lastAsk: null,
	log: [],
	step: 0,
	origIsMine: null,
	installed: false,
	forcePlay: false, // 默认关闭强制出牌：开启时 builtinDecide 未选牌强点 ok 会被引擎驳回形成死循环
	_render: null,
	_showPanel: false,
	_redoEv: null,
	_redoCount: 0,
	_wdEv: null,
	_wdSig: "",
	_wdAt: 0,
	_wdLevel: 0,
	_wdLastAct: 0,
	failStat: { noPlayer: 0, noFilterCard: 0, noUsable: 0, notEnough: 0, noTarget: 0, filterOkFail: 0, ok: 0 },
	ignoreError: false,
	errorCount: 0,
};

const IDENTITY_CN = { zhu: "主公", zhong: "忠臣", fan: "反贼", nei: "内奸", unknown: "未知" };
const ID_COLOR = { zhu: "#ffd866", zhong: "#7ec699", fan: "#f08c8c", nei: "#8ab4f8" };

// 混合模式下命中则暂停等外部 AI 决策
const KEY_EVENTS = [
	"chooseToUse", "chooseTarget", "chooseCard", "chooseButton",
	"chooseBool", "chooseControl", "chooseToDiscard", "chooseToRespond", "phaseUse",
];
const KEY_SKILL_HINT = ["die", "tao", "jiu", "wuxie", "nanman", "wuzhong", "jiedao", "shunshou", "guohe", "huogong", "tiesuo", "lebu", "bingliang", "shan", "sha"];

function pushLog(kind, text) {
	S.log.push({ step: ++S.step, kind, text, at: Date.now() });
	if (S.log.length > 200) S.log.shift();
}

// ---------------------------------------------------------------- 监控层

function readCard(card) {
	if (!card) return null;
	try {
		return {
			id: card.cardid,
			name: card.name,
			cn: get.translation(card.name),
			suit: card.suit,
			number: card.number,
			type: card.type,
		};
	} catch (e) {
		return { name: card.name || "?", error: String(e) };
	}
}

function readPlayer(p) {
	if (!p) return null;
	try {
		const skills = []
			.concat(p.getSkills ? p.getSkills() : p.skills || [])
			.filter((s) => s && lib.skill[s]);
		const idx = game.players ? game.players.indexOf(p) : -1;
		return {
			index: idx,
			seat: idx, // 座位别名，便于外部 AI 用 seat 索引
			name: p.name,
			cn: get.translation(p.name),
			identity: p.identity,
			identityCn: IDENTITY_CN[p.identity] || p.identity,
			hp: p.hp,
			maxHp: p.maxHp,
			sex: p.sex || (get.sex ? get.sex(p.name) : null),
			group: p.group || (lib.character ? lib.character[p.name]?.group : null),
			skills: skills.map((s) => ({ id: s, cn: get.translation(s) })),
			isDead: p.isDead ? p.isDead() : false,
			isTurnedOver: p.isTurnedOver ? p.isTurnedOver() : false,
			isLinked: p.isLinked ? p.isLinked() : false,
			handcards: (p.getCards ? p.getCards("h") : []).map(readCard),
			equips: (p.getCards ? p.getCards("e") : []).map(readCard),
			judges: (p.getCards ? p.getCards("j") : []).map(readCard),
			handCount: p.countCards ? p.countCards("h") : 0,
			equipCount: p.countCards ? p.countCards("e") : 0,
			judgeCount: p.countCards ? p.countCards("j") : 0,
		};
	} catch (e) {
		return { name: p.name || "?", error: String(e) };
	}
}

function currentEvent() {
	const ev = _status.event;
	if (!ev) return null;
	try {
		return {
			name: ev.name,
			step: ev.step,
			player: ev.player ? ev.player.name : null,
			playerCn: ev.player ? get.translation(ev.player.name) : null,
			playerIndex: ev.player && game.players ? game.players.indexOf(ev.player) : -1,
			target: ev.target ? ev.target.name : null,
			skill: ev.skill || null,
			skillCn: ev.skill ? get.translation(ev.skill) : null,
			isMine: ev.isMine ? ev.isMine() : null,
			paused: !!_status.paused,
			auto: !!_status.auto,
		};
	} catch (e) {
		return { error: String(e) };
	}
}

function snapshot() {
	const players = (game.players || []).map(readPlayer);
	const ev = currentEvent();
	return {
		ok: true,
		ts: Date.now(),
		step: S.step,
		takeover: S.takeover,
		mode: S.mode,
		autoRun: S.autoRun,
		pendingPause: S.pendingPause,
		phase: _status.currentPhase ? _status.currentPhase.name : null,
		roundNumber: game.roundNumber,
		phaseNumber: game.phaseNumber,
		over: !!_status.over,
		event: ev,
		players,
		aliveCount: (game.players || []).length,
		deadCount: (game.dead || []).length,
		attitude: players.map((a) =>
			players.map((b) => {
				try {
					const pa = game.players[a.index];
					const pb = game.players[b.index];
					if (!pa || !pb || pa === pb) return null;
					return Math.round((get.attitude(pa, pb) || 0) * 100) / 100;
				} catch (e) {
					return null;
				}
			}),
		),
	};
}

// ---------------------------------------------------------------- 接管层

// 引擎自行推进的事件黑名单（双保险：即便它们带了 filter 也绝不接管）
const ENGINE_DRIVEN_EVENTS = new Set([
	"gain", "draw", "lose", "damage", "recover", "changeHp",
	"equip", "addJudge", "judge", "turnOver", "turnover",
	"phaseZhunbei", "phaseJudge", "phaseDraw", "phaseUse", "phaseDiscard", "phaseJieshu",
	"phaseBegin", "phaseBeginStart", "phaseEnd",
	"trigger", "arrangeTrigger", "dying", "die", "gameOver", "gameDraw",
	"useCard", "useSkill", "respond", "useResult",
]);

/**
 * 判断当前事件是否真的需要玩家决策。只有需要决策的事件才应宣告"是我"（isMine=true）让引擎暂停；
 * 引擎自行推进的事件必须放行——否则引擎在没有确定/取消按钮的事件上等待输入，
 * 内置 AI 无处点击，最终主线程死循环冻结。
 */
function needsPlayerDecision() {
	const ev = _status.event;
	if (!ev) return false;
	if (ENGINE_DRIVEN_EVENTS.has(ev.name || "")) return false;
	return !!(
		ev.filterCard || ev.filterTarget || ev.filterOk || ev.filterButton ||
		ev.chooseButton || ev.chooseBool || ev.chooseControl ||
		ev.selectTarget || ev.targetRequired || ev.forced
	);
}

function installTakeover() {
	if (S.installed) return true;
	try {
		const anyPlayer = game.players?.[0] || game.playerMap?.[0];
		if (!anyPlayer) return false;
		const proto = Object.getPrototypeOf(anyPlayer);
		if (!proto || typeof proto.isMine !== "function") return false;

		S.origIsMine = proto.isMine;
		proto.isMine = function () {
			try {
				if (this.isMad && this.isMad()) return false;
				if (game.notMe) return false;
				if (this.isDead && this.isDead()) return false;
				// 只接管真决策；引擎自行推进的事件一律放行，交回引擎内置 AI
				if (!needsPlayerDecision()) return false;
				return true;
			} catch (e) {
				// 任何异常都保守放行：让引擎内置 AI 处理，避免 NM8 接管错误导致卡死
				pushLog("warn", "isMine 异常放行: " + (e && e.message ? e.message : e));
				return false;
			}
		};

		S.installed = true;
		pushLog("takeover", "已安装 isMine 接管补丁");
		return true;
	} catch (e) {
		pushLog("error", "安装接管补丁失败: " + e);
		return false;
	}
}

function setTakeover(on) {
	const r = installTakeover();
	if (!r) return { ok: false, reason: "未进入对局或找不到 Player 原型" };
	S.takeover = !!on;
	_status.auto = false;
	pushLog("takeover", "接管=" + (on ? "开" : "关"));
	return { ok: true, takeover: S.takeover, auto: _status.auto };
}

// ---------------------------------------------------------------- 控制层

function isKeyDecision(ev) {
	if (!ev) return false;
	if (KEY_EVENTS.includes(ev.name)) return true;
	if (ev.skill && KEY_SKILL_HINT.some((k) => String(ev.skill).includes(k))) return true;
	return false;
}

const MAX_REDO = 2;
function bumpRedo(ev) {
	if (S._redoEv !== ev) { S._redoEv = ev; S._redoCount = 0; }
	S._redoCount = (S._redoCount || 0) + 1;
	return S._redoCount;
}
function resetRedo() { S._redoEv = null; S._redoCount = 0; }

function forcePlay(ev) {
	if (!S.forcePlay) return false;
	const F = S.failStat;
	const player = ev.player;
	if (!player) { F.noPlayer++; return false; }
	if (typeof ev.filterCard !== "function") { F.noFilterCard++; return false; }

	let pool = [];
	try { pool = player.getCards(ev.position || "h") || []; } catch (e) { F.noUsable++; return false; }
	const usable = pool.filter((c) => { try { return !!ev.filterCard(c, player, ev); } catch (e) { return false; } });
	if (!usable.length) { F.noUsable++; return false; }

	let need = 1;
	if (Array.isArray(ev.selectCard)) need = ev.selectCard[0] != null ? ev.selectCard[0] : ev.selectCard[1] != null ? ev.selectCard[1] : 1;
	else if (typeof ev.selectCard === "number") need = ev.selectCard;
	if (usable.length < need) { F.notEnough++; return false; }

	const prio = (c) => {
		const n = c && c.name;
		if (n === "sha") return 0;
		try { if (get.type(c) === "equip") return 1; } catch (e) {}
		if (n === "juedou" || n === "nanman" || n === "wanjian" || n === "guohe" || n === "shunshou") return 2;
		return 3;
	};
	const sorted = usable.slice().sort((a, b) => prio(a) - prio(b));

	let targets = [];
	let tn = 1;
	if (typeof ev.filterTarget === "function") {
		if (Array.isArray(ev.selectTarget)) tn = ev.selectTarget[0] != null ? ev.selectTarget[0] : ev.selectTarget[1] != null ? ev.selectTarget[1] : 1;
		else if (typeof ev.selectTarget === "number") tn = ev.selectTarget;
		if (tn > 0) {
			try {
				const all = game.filterPlayer ? game.filterPlayer((cur) => { try { return !!ev.filterTarget(cur, player, ev); } catch (e) { return false; } }) : [];
				const att = (t) => { try { return typeof get.attitude === "function" ? get.attitude(player, t) : 0; } catch (e) { return 0; } };
				all.sort((a, b) => att(a) - att(b));
				targets = all.slice(0, tn);
			} catch (e) { targets = []; }
		}
	}

	const trySubmit = (cards, tgts) => {
		try {
			ui.selected.cards = cards;
			ui.selected.targets = tgts || [];
			if (!ev.filterOk || ev.filterOk()) {
				ui.click.ok();
				F.ok++;
				pushLog("force", `强制出牌 [${cards.map((c) => (c && c.name) || "?").join(",")}] → [${(tgts || []).map((t) => (t && t.name) || "").join(",")}]`);
				return true;
			}
		} catch (e) {
			pushLog("error", "trySubmit 异常: " + (e && e.message ? e.message : e));
		}
		return false;
	};

	const picked = sorted.slice(0, need);
	if (tn > 0 && targets.length && trySubmit(picked, targets)) return true;
	if (trySubmit(picked, [])) return true;
	if (tn > 0 && targets.length) { for (const c of usable) { if (trySubmit([c], targets)) return true; } }
	for (const c of usable) { if (trySubmit([c], [])) return true; }

	if (tn > 0 && !targets.length) F.noTarget++; else F.filterOkFail++;
	return false;
}

function tryEndPhase() {
	try {
		const els = Array.from(document.querySelectorAll(".control, .button, .menubutton"));
		const btn = els.find((el) => (el.innerText || "").replace(/\s/g, "").indexOf("结束回合") >= 0);
		if (btn && btn.offsetParent !== null) { btn.click(); pushLog("phase", "点击结束回合"); return true; }
	} catch (e) {}
	return false;
}

/**
 * 看门狗：检测"步骤停滞"并逐级强制挽救，直到当前事件被推进。
 * 自定义技能 / 响应事件形态极多，NM8 无法逐一适配；一旦卡住整局不再推进。
 * 级别循环：1 取消 → 2 确定 → 3 结束阶段 → 4 恢复引擎 → 5 强制结束当前事件。
 * 注意：停滞判定基于「引擎真实进展」（事件对象或 step 是否变化），绝不用 S.step（写日志会自增导致误判）。
 */
function watchdog() {
	const now = Date.now();
	try {
		const ev = _status.event;
		const sig = ev ? `${ev.name || "?"}@${ev.step ?? 0}` : "none";
		if (ev !== S._wdEv || sig !== S._wdSig) { S._wdEv = ev; S._wdSig = sig; S._wdAt = now; S._wdLevel = 0; return; }
		const idle = now - (S._wdAt || now);
		if (idle < 6000) return;                       // 6s 内不算停滞
		if (now - (S._wdLastAct || 0) < 3000) return;   // 距上次强制动作 3s 内不重复
		S._wdLastAct = now;
		const level = (S._wdLevel = (S._wdLevel || 0) + 1);
		const actions = [
			() => { try { ui.click.cancel(); } catch (e) {} },
			() => { try { ui.click.ok(); } catch (e) {} },
			() => { tryEndPhase(); },
			() => { try { if (typeof game.resume === "function") game.resume(); } catch (e) {} },
			() => { try { if (_status.paused) step(true); } catch (e) {} },
			() => {
				try {
					const e = _status.event;
					if (!e) return;
					if (typeof e.finish === "function") { e.result = e.result || { bool: false }; e.finish(); }
					else if (typeof e.goto === "function") e.goto(0);
					else if (typeof e.cancel === "function" && e.setContent) e.cancel();
				} catch (e) {}
			},
		];
		const act = actions[(level - 1) % actions.length];
		pushLog("watchdog", `步骤 ${sig} 停滞 ${(idle / 1000).toFixed(0)}s，执行第 ${((level - 1) % actions.length) + 1}/${actions.length} 级挽救`);
		act();
	} catch (e) {}
}

function builtinDecide() {
	const ev = _status.event;
	if (!ev) return { ok: false, reason: "无当前事件" };
	try {
		const forced = ev.forced;
		const name = ev.name || "";

		try {
			if (typeof game.check === "function" && game.check()) {
				ui.click.ok();
				return { ok: true, action: "ok(checked)" };
			}
		} catch (checkErr) {
			pushLog("warn", `game.check 异常(${name}): ${checkErr.message || checkErr}`);
		}

		if (name === "chooseButton" || name === "chooseControl" || name === "chooseBool" || ev.chooseButton) {
			try {
				const btnCheck = typeof ev.ai1 === "function" ? ev.ai1 : () => 1;
				const okBtn = ai.basic.chooseButton(btnCheck);
				if ((okBtn || forced) && (!ev.filterOk || ev.filterOk())) { ui.click.ok(); return { ok: true, action: "ok(button)" }; }
			} catch (e) { pushLog("error", `chooseButton 异常: ${e.stack || e}`); }
			ui.click.cancel();
			return { ok: true, action: "cancel(button)" };
		}

		// 出牌 / 打出 / 弃牌：分路处理，避免手动选牌触发 useCard 崩溃（player.js:7482）
		if (name === "chooseToUse" || name === "chooseToRespond" || name === "chooseToDiscard") {
			try {
				if (name === "chooseToUse") {
					const ai1 = typeof ev.ai1 === "function" ? ev.ai1 : (card) => {
						const info = get.info(card);
						if (info && info.ai && info.ai.order) return typeof info.ai.order === "function" ? info.ai.order() : info.ai.order;
						return 1;
					};
					const ai2 = typeof ev.ai2 === "function" ? ev.ai2 : () => 1;
					if (typeof game.check === "function" && game.check()) { ui.click.ok(); return { ok: true, action: "ok(engine)" }; }
					if (ai.basic.chooseCard(ai1) || forced) {
						if ((ai.basic.chooseTarget(ai2) || forced) && (!ev.filterOk || ev.filterOk())) {
							ui.click.ok();
							ev._aiexcludeclear = true;
							return { ok: true, action: "ok(ai)" };
						}
					}
				} else {
					// 求桃 / 弃牌：手动选第一张合法牌（这类事件 ai1/ai2 往往 undefined，不能走 basic.chooseCard）
					let picked = null;
					if (typeof ev.filterCard === "function") {
						const hand = (ev.player && ev.player.getCards) ? ev.player.getCards("h", true) : [];
						picked = hand.find((c) => { try { return !!get.info(c) && ev.filterCard(c, ev.player, ev); } catch (e) { return false; } }) || null;
						if (picked) {
							try { ui.clear(); ui.selectCard(picked); } catch (e) {}
							if (typeof ev.filterTarget === "function") {
								const players = (game && game.players) || [];
								const tgt = players.find((p) => { try { return ev.filterTarget(picked, ev.player, p); } catch (e) { return false; } });
								if (tgt) { try { ui.selectTarget(tgt); } catch (e) {} }
							}
						}
					}
					if (picked && (!ev.filterOk || ev.filterOk())) { ui.click.ok(); return { ok: true, action: "ok(manual)" }; }
				}
				// cancel+redo 极易死循环：必须同时满足「能排除技能」且「重选次数未超限」
				if (ev.skill && !ev.norestore && ev._aiexclude) {
					const redoN = bumpRedo(ev);
					if (redoN <= MAX_REDO) {
						ui.click.cancel();
						ev._aiexclude.add(ev.skill);
						const info = get.info(ev.skill);
						if (info && info.sourceSkill) ev._aiexclude.add(info.sourceSkill);
						ev.redo();
						return { ok: true, action: "redo" };
					}
					pushLog("warn", `${name} redo 超限(${redoN})，停止重选`);
				}
				ui.click.cancel();
				resetRedo();
				if (tryEndPhase()) return { ok: true, action: "endPhase" };
				return { ok: true, action: "cancel" };
			} catch (e) {
				pushLog("error", `${name} AI处理异常，取消该决策: ${e.message || e}`);
				try { ui.click.cancel(); } catch (_) {}
				return { ok: true, action: "cancel(aiError)" };
			}
		}

		// 其余选牌事件：挑第一张合法牌（单张选中；多选会让引擎 result 异常）
		let cardOk = true;
		if (typeof ev.filterCard === "function") {
			try {
				const hand = (ev.player && ev.player.getCards) ? ev.player.getCards("h", true) : [];
				const pick = hand.find((c) => { try { return !!get.info(c) && ev.filterCard(c, ev.player, ev); } catch (e) { return false; } });
				if (pick) { try { ui.clear(); ui.selectCard(pick); } catch (e) {} }
				else cardOk = false;
			} catch (e) { cardOk = false; }
		}
		let targetOk = true;
		if (typeof ev.filterTarget === "function") {
			try {
				const players = (game && game.players) || [];
				// 目标合法性依赖当前选中的牌：优先引擎已选中，其次手牌第一张合法牌，最后退化为 null
				const sel =
					(ui.selected && ui.selected.cards && ui.selected.cards[0]) ||
					(ev.player && ev.player.getCards
						? ev.player.getCards("h", true).find((c) => { try { return ev.filterCard && !!get.info(c) && ev.filterCard(c, ev.player, ev); } catch (e) { return false; } })
						: null) ||
					ev.card || null;
				const pick = players.find((p) => { try { if (ev.filterTarget(sel, ev.player, p)) return true; } catch (e) {} return false; });
				if (pick) { try { ui.selectTarget(pick); } catch (e) {} }
				else targetOk = false;
			} catch (e) { targetOk = false; }
		}

		if ((cardOk && targetOk) || forced) {
			try {
				if (!ev.filterOk || ev.filterOk()) { ui.click.ok(); ev._aiexcludeclear = true; resetRedo(); return { ok: true, action: "ok(ai)" }; }
			} catch (e) { pushLog("error", `filterOk 异常(${name}): ${e.stack || e}`); }
			if (forcePlay(ev)) { resetRedo(); return { ok: true, action: "ok(force)" }; }
			const redoN = bumpRedo(ev);
			if (!ev.norestore && redoN <= MAX_REDO) {
				try {
					ui.click.cancel();
					if (ev.skill) { ev._aiexclude?.add(ev.skill); const info = get.info(ev.skill); if (info && info.sourceSkill) ev._aiexclude?.add(info.sourceSkill); }
					else { get.card(true).aiexclude(); game.uncheck(); }
					ev.redo();
					return { ok: true, action: "cancel+redo" };
				} catch (e) { pushLog("error", `cancel+redo 异常(${name}): ${e.stack || e}`); }
			} else if (redoN > MAX_REDO) { pushLog("warn", `${name} redo 超限(${redoN})，停止重选`); }
		}
		if (forcePlay(ev)) { resetRedo(); return { ok: true, action: "ok(force)" }; }
		if (tryEndPhase()) { resetRedo(); return { ok: true, action: "endPhase" }; }
		ui.click.cancel();
		return { ok: true, action: "cancel" };
	} catch (e) {
		pushLog("error", "builtinDecide 外层异常: " + (e && e.stack ? e.stack : e));
		return { ok: false, reason: String(e && e.message ? e.message : e) };
	}
}

function step(forceBuiltin) {
	const ev = _status.event;
	if (!ev) return { ok: false, reason: "无当前事件" };
	if (!_status.paused) return { ok: false, reason: "当前未暂停（无待决策）", paused: false };

	if (S.mode === "hybrid" && !forceBuiltin && isKeyDecision(ev)) {
		S.pendingPause = true;
		S.lastAsk = snapshot();
		pushLog("ask", `关键决策待外部: ${ev.name} / ${ev.player ? ev.player.name : "?"}`);
		return { ok: true, pending: true, ask: S.lastAsk };
	}

	const r = builtinDecide();
	S.pendingPause = false;
	pushLog("builtin", `${ev.name} => ${r.action || r.reason}`);
	return r;
}

function decide(cmd) {
	const ev = _status.event;
	if (!ev) return { ok: false, reason: "无当前事件" };
	try {
		const mode = (cmd && cmd.action) || "ok";

		if (mode === "cards" && Array.isArray(cmd.ids)) {
			ui.clear();
			const hs = ev.player ? ev.player.getCards("h", true) : [];
			let hit = 0;
			hs.forEach((c) => { if (cmd.ids.includes(c.cardid)) { ui.selectCard(c); hit++; } });
			pushLog("external", `选中 ${hit} 张牌`);
		} else if (mode === "targets" && Array.isArray(cmd.names)) {
			ui.clear();
			let hit = 0;
			(game.players || []).forEach((p) => { if (cmd.names.includes(p.name)) { ui.selectTarget(p); hit++; } });
			pushLog("external", `选中 ${hit} 个目标`);
		} else if (mode === "button" && typeof cmd.index === "number") {
			const btns = document.querySelectorAll(".button:not(.character):not(.card)");
			if (btns[cmd.index]) { btns[cmd.index].click(); pushLog("external", `点击按钮#${cmd.index}`); S.pendingPause = false; return { ok: true, action: "button" }; }
			return { ok: false, reason: "按钮不存在" };
		}

		if (mode === "cancel") ui.click.cancel();
		else ui.click.ok();
		S.pendingPause = false;
		pushLog("external", `${ev.name} => ${mode}`);
		return { ok: true, action: mode };
	} catch (e) {
		pushLog("error", "decide 异常: " + (e && e.stack ? e.stack : e));
		return { ok: false, reason: String(e) };
	}
}

// ---------------------------------------------------------------- 浮层（悬浮透明控制台）

let panel = null;
let panelDrag = null;

function buildPanel() {
	if (panel) return panel;

	panel = document.createElement("div");
	panel.id = "nm8_console";

	const style = panel.style;
	style.position = "fixed";
	style.right = "12px";
	style.top = "92px";
	style.zIndex = "999999";
	style.width = "260px";
	style.maxHeight = "78vh";
	style.display = "flex";
	style.flexDirection = "column";
	style.background = "rgba(12,14,20,0.97)";
	style.backdropFilter = "blur(3px)";
	style.webkitBackdropFilter = "blur(3px)";
	style.color = "#e8eaf0";
	style.font = "11px/1.42 'Microsoft YaHei',sans-serif";
	style.border = "1px solid rgba(255,255,255,0.18)";
	style.borderRadius = "6px";
	style.boxShadow = "0 2px 8px rgba(0,0,0,.25)";
	style.overflow = "hidden";
	style.userSelect = "none";
	style.pointerEvents = "auto";

	const bar = document.createElement("div");
	bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 9px;cursor:move;background:rgba(255,255,255,.05);border-bottom:1px solid rgba(255,255,255,.08)";
	const title = document.createElement("span");
	title.textContent = "控制台";
	title.style.cssText = "font-weight:700;letter-spacing:.3px;text-shadow:0 1px 1px rgba(0,0,0,.4)";
	const ctl = document.createElement("span");
	ctl.style.cssText = "display:flex;gap:4px;font-size:11px;opacity:.85";
	const mkBtn = (txt, fn, color) => {
		const b = document.createElement("span");
		b.textContent = txt;
		b.style.cssText = `padding:1px 7px;border-radius:6px;cursor:pointer;background:${color || "rgba(255,255,255,.12)"}`;
		b.onclick = (e) => { e.stopPropagation(); fn(); };
		return b;
	};
	ctl.appendChild(mkBtn("接管", () => { setTakeover(!S.takeover); renderPanel(); pushLog("ui", "接管→" + S.takeover); }, "rgba(126,198,153,.28)"));
	ctl.appendChild(mkBtn("自动", () => { autoRun(!S.autoRun); renderPanel(); }, "rgba(138,180,248,.28)"));
	ctl.appendChild(mkBtn("刷新", () => renderPanel(), "rgba(255,255,255,.12)"));
	ctl.appendChild(mkBtn("隐藏", () => { S._showPanel = false; if (panel) panel.style.display = "none"; showLauncher(true); }, "rgba(255,255,255,.12)"));
	bar.appendChild(title);
	bar.appendChild(ctl);

	bar.onmousedown = (e) => {
		if (e.target !== bar && e.target !== title) return;
		const rect = panel.getBoundingClientRect();
		panelDrag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
		const move = (ev) => {
			if (!panelDrag) return;
			let x = Math.max(0, Math.min(window.innerWidth - 40, ev.clientX - panelDrag.dx));
			let y = Math.max(0, Math.min(window.innerHeight - 20, ev.clientY - panelDrag.dy));
			panel.style.left = x + "px";
			panel.style.top = y + "px";
			panel.style.right = "auto";
		};
		const up = () => { panelDrag = null; document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
	};

	const body = document.createElement("div");
	body.id = "nm8_body";
	body.style.cssText = "padding:8px 10px;overflow:auto;flex:1 1 auto;min-height:0";

	const ctrl = document.createElement("div");
	ctrl.id = "nm8_ctrl";
	ctrl.style.cssText = "padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:11px";

	panel.appendChild(bar);
	panel.appendChild(ctrl);
	panel.appendChild(body);
	(document.body || document.documentElement).appendChild(panel);

	// 抵御游戏全局 CSS 把面板内 div 设成 absolute 导致布局塌陷（但绝不碰 .card 内部层，否则卡面被打散）
	if (!document.getElementById("nm8_style_guard")) {
		const guard = document.createElement("style");
		guard.id = "nm8_style_guard";
		guard.textContent = "#nm8_console{position:fixed!important}#nm8_console div:not(.card):not(.card *){position:relative!important}";
		(document.head || document.documentElement).appendChild(guard);
	}

	buildLauncher();
	if (!S._ctrlBuilt) { buildControls(ctrl); S._ctrlBuilt = true; }
	return panel;
}

// ---------------------------------------------------------------- 控制区（快速操作 + 定向给牌）

function fillTargetOptions(sel) {
	if (!sel) return;
	sel.innerHTML = "";
	(game.players || []).forEach((p, i) => {
		const o = document.createElement("option");
		o.value = String(i);
		o.textContent = i + " " + get.translation(p.name) + (p.identity ? (" [" + (IDENTITY_CN[p.identity] || "") + "]") : "");
		sel.appendChild(o);
	});
}

function buildControls(root) {
	root.innerHTML = "";

	const tRow = document.createElement("div");
	tRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px";
	const tLabel = document.createElement("span");
	tLabel.textContent = "目标:";
	tLabel.style.opacity = ".7";
	const sel = document.createElement("select");
	sel.id = "nm8_target";
	sel.style.cssText = "flex:1;background:rgba(0,0,0,.35);color:#e8eaf0;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:2px 4px;font:11px 'Microsoft YaHei'";
	fillTargetOptions(sel);
	S._targetSel = sel;
	tRow.appendChild(tLabel);
	tRow.appendChild(sel);
	root.appendChild(tRow);

	const q = document.createElement("div");
	q.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px";
	const qBtns = [
		["加血", () => window.NM8.god.heal(sel.value, 1)],
		["扣血", () => window.NM8.god.hurt(sel.value, 1)],
		["发杀", () => window.NM8.cheat.give("sha", sel.value)],
		["发闪", () => window.NM8.cheat.give("shan", sel.value)],
		["发桃", () => window.NM8.cheat.give("tao", sel.value)],
		["发酒", () => window.NM8.cheat.give("jiu", sel.value)],
		["神装", () => window.NM8.cheat.equip(sel.value)],
		["看牌", () => window.NM8.cheat.peek(sel.value)],
		["显身份", () => window.NM8.cheat.identities()],
		["复活", () => window.NM8.god.revive(sel.value)],
		["秒杀", () => window.NM8.god.kill(sel.value)],
	];
	qBtns.forEach(([t, fn]) => {
		const b = document.createElement("span");
		b.textContent = t;
		b.style.cssText = "padding:2px 7px;border-radius:5px;cursor:pointer;background:rgba(255,255,255,.12)";
		b.onmouseenter = () => (b.style.background = "rgba(255,255,255,.22)");
		b.onmouseleave = () => (b.style.background = "rgba(255,255,255,.12)");
		b.onclick = () => { try { const r = fn(); pushLog("ctrl", t + " => " + JSON.stringify(r)); } catch (e) { pushLog("error", t + ": " + e); } renderPanel(); };
		q.appendChild(b);
	});
	root.appendChild(q);

	const sRow = document.createElement("div");
	sRow.style.cssText = "display:flex;gap:6px;margin-bottom:4px";
	const inp = document.createElement("input");
	inp.id = "nm8_cardsearch";
	inp.placeholder = "搜牌名，如 诸葛连弩 / 杀 / 闪 / 桃 / 无懈";
	inp.style.cssText = "flex:1;background:rgba(0,0,0,.35);color:#e8eaf0;border:1px solid rgba(255,255,255,.15);border-radius:4px;padding:3px 6px;font:11px 'Microsoft YaHei'";
	sRow.appendChild(inp);
	root.appendChild(sRow);

	const tgtLabel = document.createElement("div");
	tgtLabel.id = "nm8_tgtlabel";
	tgtLabel.style.cssText = "font-size:10px;opacity:.72;margin-bottom:2px";
	if (sel) tgtLabel.textContent = "点牌图即发给：" + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "（未选）");
	root.appendChild(tgtLabel);

	const res = document.createElement("div");
	res.id = "nm8_cardres";
	res.style.cssText = "max-height:220px;overflow:auto;display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;padding-top:5px;border-top:1px solid rgba(255,255,255,.08)";
	root.appendChild(res);

	function renderCardThumb(name) {
		const wrap = document.createElement("div");
		wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;width:72px;flex:0 0 auto;cursor:pointer";
		const face = document.createElement("div");
		face.style.cssText = "position:relative;width:68px;height:96px;border-radius:5px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.45);transition:transform .08s,box-shadow .08s;background:rgba(0,0,0,.2)";
		try {
			const card = game.createCard(name, 1, 1);
			const dom = ui.create.card(card);
			if (dom.init) try { dom.init(card); } catch (e) {}
			if (dom.update) try { dom.update(card); } catch (e) {}
			dom.style.cssText = "width:100%;height:100%;pointer-events:none";
			face.appendChild(dom);
		} catch (e) {
			face.textContent = get.translation(name);
			face.style.cssText += ";display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);font-size:10px;text-align:center";
		}
		const label = document.createElement("div");
		label.textContent = get.translation(name);
		label.style.cssText = "margin-top:3px;font-size:10px;color:#e8eaf0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%";
		const tgtText = () => (S._targetSel && S._targetSel.options[S._targetSel.selectedIndex]) ? S._targetSel.options[S._targetSel.selectedIndex].text : "目标";
		wrap.title = "点击发给：" + tgtText();
		wrap.onmouseenter = () => { face.style.transform = "translateY(-3px)"; face.style.boxShadow = "0 5px 12px rgba(0,0,0,.55)"; };
		wrap.onmouseleave = () => { face.style.transform = "none"; face.style.boxShadow = "0 1px 4px rgba(0,0,0,.45)"; };
		wrap.onclick = () => {
			try {
				const seat = S._targetSel ? S._targetSel.value : "0";
				const r = window.NM8.cheat.give(name, seat);
				pushLog("give", get.translation(name) + " -> 座位" + seat + " => " + JSON.stringify(r));
			} catch (e) { pushLog("error", "give: " + e); }
			renderPanel();
		};
		wrap.appendChild(face);
		wrap.appendChild(label);
		return wrap;
	}

	const doSearch = () => {
		const q = (inp.value || "").trim().toLowerCase();
		res.innerHTML = "";
		if (sel) tgtLabel.textContent = "点牌图即发给：" + (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "（未选）");
		if (!q) return;
		const matches = [];
		const seen = new Set();
		for (const key in lib.card) {
			if (seen.has(key)) continue;
			seen.add(key);
			const def = lib.card[key];
			if (!def || typeof def !== "object") continue;
			if (!def.type && !def.init && !def.content) continue;
			const cn = get.translation(key);
			if ((key + " " + cn).toLowerCase().includes(q)) matches.push(key);
			if (matches.length >= 24) break;
		}
		if (!matches.length) {
			const e = document.createElement("div");
			e.style.cssText = "opacity:.5;font-size:10px;padding:4px";
			e.textContent = "无匹配牌";
			res.appendChild(e);
			return;
		}
		matches.forEach((key) => res.appendChild(renderCardThumb(key)));
	};
	inp.addEventListener("input", doSearch);
	inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
}

let launcher = null;
function buildLauncher() {
	if (launcher) return;
	launcher = document.createElement("div");
	launcher.id = "nm8_launcher";
	launcher.textContent = "控制台";
	launcher.title = "点击展开/收起 NM8 控制台（始终可见）";
	// 常驻右上角，避开游戏原生顶栏（top:0~46），不与原生按键重叠
	launcher.style.cssText = "position:fixed;right:12px;top:46px;z-index:999999;padding:5px 14px;border-radius:5px;cursor:pointer;background:rgba(26,28,36,.96);color:#f2f2f2;font:13px/1.4 'Microsoft YaHei',sans-serif;border:1px solid rgba(255,255,255,.2);box-shadow:0 2px 8px rgba(0,0,0,.5);display:block;user-select:none";
	launcher.onmouseenter = () => { launcher.style.background = "rgba(46,48,58,.98)"; launcher.style.borderColor = "rgba(255,255,255,.32)"; };
	launcher.onmouseleave = () => { launcher.style.background = "rgba(26,28,36,.96)"; launcher.style.borderColor = "rgba(255,255,255,.2)"; };
	launcher.onclick = () => { S._showPanel = !S._showPanel; if (panel) panel.style.display = S._showPanel ? "flex" : "none"; renderPanel(); };
	(document.body || document.documentElement).appendChild(launcher);
}
function showLauncher() { if (launcher) launcher.style.display = "block"; }
function hideLauncher() { if (launcher) launcher.style.display = "none"; }

function esc(s) { return String(s == null ? "" : s); }

function renderPanel() {
	buildPanel();
	if (!S._showPanel) { if (panel) panel.style.display = "none"; return; }
	const body = panel.querySelector("#nm8_body");
	if (!body) return;
	if (S._targetSel && S._targetSel.options.length !== (game.players || []).length) fillTargetOptions(S._targetSel);
	const s = snapshot();

	let html = "";
	html += `<div style="display:flex;justify-content:space-between;opacity:.8;margin-bottom:6px;font-size:11px">
		<span>接管 <b style="color:${s.takeover ? "#7ec699" : "#888"}">${s.takeover ? "开" : "关"}</b></span>
		<span>模式 ${esc(s.mode)}</span>
		<span>轮次 ${s.roundNumber || 0}</span>
		<span>存活 <b style="color:#7ec699">${s.aliveCount}</b>/<b style="color:#f08c8c">${s.deadCount || 0}</b></span>
	</div>`;

	if (s.event) {
		const key = isKeyDecision(s.event);
		html += `<div style="margin-bottom:6px;padding:4px 7px;border-radius:6px;background:${key ? "rgba(240,140,140,.20)" : "rgba(255,255,255,.06)"};font-size:11px">
		事件 <b>${esc(s.event.name)}</b>${s.event.skillCn ? " 【" + esc(s.event.skillCn) + "】" : ""}
		决策 <b style="color:#ffd866">${esc(s.event.playerCn || "?")}</b>${key ? " ⏸待外部" : ""}</div>`;
	}

	(s.players || []).forEach((p) => {
		if (!p) return;
		const dead = p.isDead ? "opacity:.42" : "";
		const col = ID_COLOR[p.identity] || "#ccc";
		const badges = [];
		if (p.isLinked) badges.push("🔗");
		if (p.isTurnedOver) badges.push("翻");
		if (p.isDead) badges.push("✖");
		html += `<div style="${dead};margin:5px 0 2px;padding-top:4px;border-top:1px solid rgba(255,255,255,.07)">
			<div style="display:flex;justify-content:space-between;align-items:baseline">
				<span><b style="color:${col}">${esc(p.identityCn)}</b> ${esc(p.cn)} ${badges.join("")}</span>
				<span style="font-weight:700;color:${p.hp <= 2 ? "#f08c8c" : "#e8eaf0"}">${p.hp}/${p.maxHp}</span>
			</div>`;
		if (p.handcards && p.handcards.length) html += `<div style="opacity:.72;font-size:11px;margin:1px 0">🂠手 ${p.handcards.map((c) => esc(c.cn)).join(" ")}</div>`;
		else if (p.handCount) html += `<div style="opacity:.5;font-size:11px;margin:1px 0">🂠手 ×${p.handCount}</div>`;
		if (p.equips && p.equips.length) html += `<div style="opacity:.7;font-size:11px;margin:1px 0;color:#9ec5ff">🛡装备 ${p.equips.map((c) => esc(c.cn)).join(" ")}</div>`;
		if (p.judges && p.judges.length) html += `<div style="opacity:.7;font-size:11px;margin:1px 0;color:#ffd866">⚖判定 ${p.judges.map((c) => esc(c.cn)).join(" ")}</div>`;
		if (p.skills && p.skills.length) html += `<div style="opacity:.55;font-size:11px;margin:1px 0">✦ ${p.skills.map((k) => esc(k.cn)).join("·")}</div>`;
		html += `</div>`;
	});

	const logs = S.log.slice(-6);
	if (logs.length) {
		html += `<div style="margin-top:6px;border-top:1px solid rgba(255,255,255,.07);padding-top:4px;opacity:.6;font-size:10px">`;
		logs.forEach((l) => { html += `<div>${esc(l.kind)}: ${esc(l.text).slice(0, 40)}</div>`; });
		html += `</div>`;
	}

	body.innerHTML = html;
}

// ---------------------------------------------------------------- 官方能力封装（AI 操控接口）

function seatToPlayer(seat) {
	if (typeof seat === "object" && seat && seat.name) return seat; // 直接传 player
	if (typeof seat === "number") return game.players?.[seat];
	if (typeof seat === "string") return game.players?.find((p) => p.name === seat) || game.players?.[seat];
	return null;
}

const cheatAPI = {
	/** 给指定座位发一张牌（官方 lib.cheat.gx） */
	give(cardName, seat) {
		try { const t = seatToPlayer(seat) || game.me; lib.cheat.gx(cardName, t); return { ok: true, card: cardName, target: t && t.name }; }
		catch (e) { return { ok: false, reason: String(e) }; }
	},
	/** 全场发牌（官方 lib.cheat.gg） */
	giveAll(cardName) { try { lib.cheat.gg(cardName); return { ok: true, card: cardName }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 给指定座位发全套神装（官方 lib.cheat.ge） */
	equip(seat) { try { const t = seatToPlayer(seat) || game.me; lib.cheat.ge(t); return { ok: true, target: t && t.name }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 摸牌（官方 lib.cheat.d） */
	draw(n, seat) { try { const t = seatToPlayer(seat) || game.me; lib.cheat.d(n || 1, t); return { ok: true, target: t && t.name }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 看手牌（官方 lib.cheat.h） */
	peek(seat) { try { const t = seatToPlayer(seat) || game.me; const hs = t.getCards("h"); return { ok: true, target: t.name, hand: hs.map((c) => get.translation(c.name)) }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 显示全场身份（官方 lib.cheat.id） */
	identities() { try { lib.cheat.id(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 在控制台执行任意 JS（官方"其他→命令"等价） */
	run(code) { try { const r = (0, eval)(code); return { ok: true, result: String(r) }; } catch (e) { return { ok: false, reason: String(e) }; } },
};

const godAPI = {
	/** 直接设体力（同步，立刻生效） */
	setHp(seat, v) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; p.hp = v; p.update(); return { ok: true, hp: p.hp }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 治疗 n 点：同步直改 hp 并刷新（recover 异步事件 .then 序列化不稳定，故同步直改保证返回值可靠） */
	heal(seat, n) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; const before = p.hp || 0; p.hp = Math.min(p.maxHp != null ? p.maxHp : before, before + (n || 1)); p.update(); return { ok: true, hp: p.hp, from: before, dead: !!(p.isDead && p.isDead()) }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 造成伤害 n 点：走引擎 damage 事件，必须 .start() 才结算并触发阵亡 */
	hurt(seat, n) { const p = seatToPlayer(seat); if (!p) return Promise.resolve({ ok: false, reason: "无此座位" }); return p.damage({ num: n || 1, nocard: true, nosource: true }).start().then(() => ({ ok: true, hp: p.hp, dead: !!(p.isDead && p.isDead()) })); },
	/** 流失体力 n 点（无来源）：走 loseHp 事件结算 */
	loseHp(seat, n) { const p = seatToPlayer(seat); if (!p) return Promise.resolve({ ok: false, reason: "无此座位" }); return p.loseHp(n || 1).start().then(() => ({ ok: true, hp: p.hp, dead: !!(p.isDead && p.isDead()) })); },
	/** 发牌到手牌：复用官方 lib.cheat.gx（同步插手牌 DOM，已验证可用） */
	give(seat, cardName) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; if (lib.cheat && lib.cheat.gx) lib.cheat.gx(cardName, p); else { const c = game.createCard(cardName); p.gain(c).start(); } return { ok: true, card: cardName, target: p.name }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 加技能 */
	addSkill(seat, name) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; p.addSkill(name); return { ok: true, skill: name }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 秒杀：走引擎 die 事件，正确置 dead 并更新 game.dead / 胜负判定 */
	kill(seat) { const p = seatToPlayer(seat); if (!p) return Promise.resolve({ ok: false, reason: "无此座位" }); if (p.isDead && p.isDead()) return Promise.resolve({ ok: true, alreadyDead: true }); return p.die().start().then(() => ({ ok: true, dead: !!(p.isDead && p.isDead()) })); },
	/** 复活 */
	revive(seat) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; p.revive(); return { ok: true }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 改身份 */
	setIdentity(seat, id) { try { const p = seatToPlayer(seat); if (!p) return { ok: false, reason: "无此座位" }; p.setIdentity(id); return { ok: true, identity: id }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 当前胜者判定（无则 null） */
	winner() {
		try {
			const alive = game.players || [];
			if (alive.length === 0) return "all";
			const zhu = alive.find((p) => p.identity === "zhu");
			if (!zhu) {
				const fan = alive.some((p) => p.identity === "fan");
				return fan ? "fan" : "nei";
			}
			const others = alive.filter((p) => p !== zhu);
			if (others.every((p) => p.identity === "nei")) return "nei";
			if (!others.some((p) => p.identity === "fan" || p.identity === "zhong")) return "zhu";
			return null;
		} catch (e) { return null; }
	},
};

const controlAPI = {
	/** 打开官方控制面板（ui.control） */
	open() { try { if (ui.control && ui.control.show) ui.control.show(); else if (ui.control) ui.control.classList.remove("hidden"); return { ok: true }; } catch (e) { return { ok: false, reason: String(e) }; } },
	/** 通过官方命令行节点执行 JS（等价于"其他→命令"） */
	command(code) {
		try {
			if (!ui.commandnode) return { ok: false, reason: "commandnode 不存在（需对局进行中）" };
			const input = ui.commandnode.link?.querySelector?.("input,textarea") || ui.commandnode.querySelector?.("input,textarea");
			if (!input) return { ok: false, reason: "未找到命令输入框" };
			input.value = code;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			const exec = ui.commandnode.link?.querySelector?.(".button,button") || ui.commandnode.querySelector?.(".button,button");
			if (exec) exec.click();
			return { ok: true, command: code };
		} catch (e) { return { ok: false, reason: String(e) }; }
	},
};

// ---------------------------------------------------------------- 对局行为日志：复用官方录像缓冲 lib.video

// 官方录像机制：引擎每次动作调 game.addVideo(type,player,content) 同步 push 进 lib.video
// （源码 noname/game/index.js）。扩展只读取并归一化 player 字段，不维护第二份缓冲、不修改任何游戏状态。
function normVideoPlayer(p) {
	if (p == null) return null;
	if (typeof p === "string") return p;
	try { if (p.dataset && p.dataset.position != null) return String(p.dataset.position); } catch (e) {}
	try { if (p.position != null) return String(p.position); } catch (e) {}
	try { if (p.name) return String(p.name); } catch (e) {}
	return null;
}
function mapVideoEvent(e, seq) {
	return { seq, type: e.type, player: normVideoPlayer(e.player), content: e.content, delay: e.delay };
}

// ---------------------------------------------------------------- 对外接口

function buildAPI() {
	window.NM8 = {
		VERSION: "3.4.0", // v3.4.0：引擎容错(ignore_error)+全局错误捕获，自动驱动不再因内容包 bug 卡死
		ENGINE_DRIVEN: Array.from(ENGINE_DRIVEN_EVENTS),
		setForcePlay(on) { S.forcePlay = !!on; return { ok: true, forcePlay: S.forcePlay }; },
		failStat() { return { ...S.failStat, forcePlay: S.forcePlay }; },
		/**
		 * 切换引擎容错：true=吞掉 content 异常并继续推进（默认，自动驱动不卡死）；
		 * false=恢复引擎默认（异常会冻结，便于人工调试定位 bug）。
		 */
		setIgnoreError(on) {
			try {
				if (lib.config && "ignore_error" in lib.config) {
					lib.config.ignore_error = !!on;
					S.ignoreError = !!on;
					return { ok: true, ignore_error: lib.config.ignore_error };
				}
			} catch (e) {}
			return { ok: false, reason: "lib.config 不可用" };
		},
		/**
		 * 手动/看门狗兜底恢复：当前事件卡死时，依次尝试 finish→resume→loop 推进一步。
		 * 仅在 ignore_error 已吞错、事件仍停滞时作为最后手段。
		 */
		recover() {
			const trace = [];
			try {
				const ev = _status.event;
				if (ev && typeof ev.finish === "function") { ev.result = ev.result || { bool: false }; ev.finish(); trace.push("finish"); }
			} catch (e) { trace.push("finish:err"); }
			try { if (_status.paused && typeof game.resume === "function") { game.resume(); trace.push("resume"); } } catch (e) {}
			try { if (typeof game.loop === "function") { game.loop(); trace.push("loop"); } } catch (e) {}
			pushLog("recover", "恢复尝试: " + trace.join(","));
			return { ok: true, trace };
		},
		buildAt: Date.now(),
		/**
		 * 对外状态快照。过滤内部字段（下划线开头）与大对象，避免 CDP 序列化 "Object reference chain too long"。
		 */
		get state() {
			const pub = { showPanel: !!S._showPanel };
			for (const k of Object.keys(S)) {
				if (k.startsWith("_")) continue;
				const v = S[k];
				if (v === null || ["string", "number", "boolean"].includes(typeof v)) pub[k] = v;
				else if (Array.isArray(v)) pub[k] = v;
				else if (v && typeof v === "object" && Object.keys(v).length <= 60) pub[k] = v;
			}
			return pub;
		},

		// —— 监控 ——
		snapshot,
		event: currentEvent,
		players() { return (game.players || []).map(readPlayer); },

		// —— 对局行为日志（复用官方录像缓冲 lib.video，实时、纯观测）——
		// 官方录像事件结构 {type, player, content, delay} —— 即"其他→录像"导出文件解码后的内容。
		// tail(since,n)：返回 lib.video 中 seq>since 的归一化事件（other AI 边打边消费）；
		// head(n)：返回前 n 条（整局复盘）；len()：当前事件总数。
		log: {
			len() { return (lib.video || []).length; },
			head(n) { const v = lib.video || []; const k = n > 0 ? n : v.length; return v.slice(0, k).map((e, i) => mapVideoEvent(e, i + 1)); },
			tail(since, n) {
				const v = lib.video || [];
				const start = since > 0 ? since : Math.max(0, v.length - (n && n > 0 ? n : 50));
				return v.slice(start).map((e, i) => mapVideoEvent(e, start + i + 1));
			},
			get(since) { return this.tail(since); },
		},
		// 原始官方录像 JSON（未归一化），便于需要引擎原生字段的场景
		video(n) {
			try {
				const v = (lib.video || []);
				const take = (n && n > 0) ? v.slice(0, n) : v;
				return JSON.stringify({ len: v.length, round: _status.roundNumber || 0, phase: _status.phase || null, inGame: !!_status.game, events: take });
			} catch (e) { return "ERR:" + e; }
		},

		// —— 接管 / 决策 ——
		takeover: setTakeover,
		step,
		decide,
		setMode(m) { S.mode = m; return { ok: true, mode: S.mode }; },

		// —— 控制台 UI ——
		showPanel(on) { S._showPanel = !!on; if (panel) panel.style.display = S._showPanel ? "flex" : "none"; renderPanel(); return { ok: true, showPanel: S._showPanel }; },
		togglePanel() { S._showPanel = !S._showPanel; if (panel) panel.style.display = S._showPanel ? "flex" : "none"; renderPanel(); return { ok: true, showPanel: S._showPanel }; },
		autoRun(on, interval) {
			S.autoRun = !!on;
			if (S._timer) clearInterval(S._timer);
			if (on) {
				S._timer = setInterval(() => {
					try { if (_status.paused) step(true); watchdog(); renderPanel(); } catch (e) {}
				}, interval || 900);
			}
			return { ok: true, autoRun: S.autoRun };
		},

		// —— 官方能力封装（AI 操控接口核心）——
		cheat: cheatAPI,
		god: godAPI,
		control: controlAPI,

		// —— 选将辅助 ——
		pickCharacter(n) {
			try {
				const cards = Array.from(document.querySelectorAll(".button.character.newstyle.selectable, .character.selectable, .button.character"))
					.filter((c) => c.offsetParent !== null);
				if (!cards.length) return { ok: false, reason: "未找到可选武将卡" };
				const idx = typeof n === "number" ? n : 0;
				const target = cards[idx] || cards[0];
				target.click();
				pushLog("pick", "点击武将卡 #" + idx);
				return { ok: true, clicked: idx, total: cards.length };
			} catch (e) { return { ok: false, reason: String(e && e.message ? e.message : e) }; }
		},
		listCharacters() {
			return Array.from(document.querySelectorAll(".button.character.newstyle.selectable, .character.selectable, .button.character"))
				.filter((c) => c.offsetParent !== null)
				.map((c, i) => ({
					i,
					name: (c.querySelector(".name")?.textContent || c.textContent || "").trim().slice(0, 10),
					hp: (c.querySelector(".hp")?.textContent || "").trim(),
					x: Math.round(c.getBoundingClientRect().x + c.getBoundingClientRect().width / 2),
					y: Math.round(c.getBoundingClientRect().y + c.getBoundingClientRect().height / 2),
				}));
		},

		// —— 日志 ——
		log2() { return S.log.slice(-50); }, // 内部操作日志（NM8 自身动作）
		clearLog() { S.log = []; return { ok: true }; },

		// —— 一键启动 ——
		quickStart() {
			setTakeover(true);
			S._showPanel = true;
			buildPanel();
			if (panel) panel.style.display = "flex";
			return this.autoRun(true, 900);
		},

		help: () => ({
			snapshot: "NM8.snapshot() → 全场 JSON（武将/身份/体力/手牌/装备/判定/技能）",
			players: "NM8.players() → 各座位摘要数组",
			takeover: "NM8.takeover(true/false) → 接管/释放全部座位",
			step: "NM8.step() → 走一步；关键决策返回 {pending:true, ask}",
			decide: "NM8.decide({action:'ok'|'cancel'|'cards'|'targets'|'button'}) → 外部下发指令",
			setMode: "NM8.setMode('hybrid'|'builtin'|'external')",
			showPanel: "NM8.showPanel(true) → 显示浮层；togglePanel() 切换（F9 等价）",
			autoRun: "NM8.autoRun(true, 900) → 自动驱动",
			log: "NM8.log.len()/head(n)/tail(since,n) → 读取官方录像缓冲（实时对局行为，供其他 AI 消费）",
			video: "NM8.video(n) → 原始官方录像 JSON",
			cheat: "NM8.cheat.give('sha',seat) / giveAll / equip / draw / peek / identities / run(code)  —— 官方 lib.cheat",
			god: "NM8.god.setHp/heal/hurt/kill/revive/addSkill/setIdentity/winner —— 引擎原生操控任意座位",
			control: "NM8.control.open() 打开官方控制面板 / command('js') 走官方命令行",
			quickStart: "NM8.quickStart() → 接管+浮层+自动跑",
		}),
	};
}

/**
 * 屏蔽会阻塞主线程的 alert/confirm，改为写入日志。
 * 无名杀遇到未捕获异常时会弹 alert；全自动/接管场景下会卡死，必须拦截。
 */
function installAlertShield() {
	try {
		window.alert = function (msg) {
			const text = String(msg || "").slice(0, 2000);
			pushLog("alert", "ALERT suppressed: " + text);
			console.warn("[NM8] alert suppressed:", text);
			setTimeout(() => {
				try { if (_status && _status.paused && ui && ui.click && ui.click.cancel) ui.click.cancel(); } catch (e) {}
				try { if (S.autoRun && window.NM8 && typeof window.NM8.step === "function") window.NM8.step(true); } catch (e) {}
			}, 0);
			return undefined;
		};
		window.confirm = function (msg) {
			const text = String(msg || "").slice(0, 2000);
			pushLog("alert", "CONFIRM auto-true: " + text);
			console.warn("[NM8] confirm auto-true:", text);
			return true;
		};
	} catch (e) { pushLog("warn", "alert shield failed: " + e); }
}

/**
 * 全局错误捕获：引擎在 lib.config.ignore_error=true 时会吞掉 content 异常并 console.error，
 * 这些异常不会变成 unhandledrejection。但 trigger（技能 onrespond 等）层抛出的异常仍可能冒泡，
 * 这里统一捕获进 NM8 内部日志，保证"容错续推"的同时，用户仍可在 /errors 看到"刚才哪里出错"，
 * 而不是悄无声息地跳过。
 */
let _errCapInstalled = false;
function installErrorCapture() {
	if (_errCapInstalled) return;
	_errCapInstalled = true;
	try {
		window.addEventListener("error", (ev) => {
			try {
				const msg = ev && ev.message ? ev.message : (ev && ev.error ? String(ev.error) : "error");
				pushLog("engineError", String(msg).slice(0, 300));
				S.errorCount++;
			} catch (e) {}
		}, true);
		window.addEventListener("unhandledrejection", (ev) => {
			try {
				const r = ev && ev.reason ? ev.reason : "unhandledrejection";
				pushLog("engineError", ("rejection: " + (r && r.message ? r.message : r)).slice(0, 300));
				S.errorCount++;
			} catch (e) {}
		});
		pushLog("init", "已安装全局错误捕获(容错可见)");
	} catch (e) { pushLog("warn", "错误捕获安装失败: " + e); }
}

// ---------------------------------------------------------------- 官方集成 + 扩展体

function integrateOfficial() {
	try {
		// 启用官方作弊（让"其他→控制/命令"菜单可用，对标官方操控能力）
		if (lib.config && "cheat" in lib.config) lib.config.cheat = true;
		pushLog("init", "已启用官方作弊(其他→控制/命令)");
	} catch (e) {
		pushLog("error", "官方集成失败(不影响主功能): " + e);
	}
	try {
		// 官方容错开关：引擎事件循环 gameEvent.js:232 的 this.content(this).catch(...)
		// 仅在 lib.config.ignore_error 为真时吞掉 content 步骤的异常并继续推进；
		// 否则异常会 re-throw 冻结整局（典型如 content.js:9996 决斗响应 event.card.name 未定义）。
		// 本控制台主打"自动驱动两局"，宁可吞错续推也不能卡死，故默认开启。
		// 异常仍会被 NM8 全局错误捕获记录到 /errors，可见性不丢（见 installErrorCapture）。
		if (lib.config && "ignore_error" in lib.config) {
			lib.config.ignore_error = true;
			S.ignoreError = true;
			pushLog("init", "已启用引擎容错(lib.config.ignore_error)，内容包 bug 不再冻结对局");
		}
	} catch (e) {
		pushLog("warn", "忽略错误开关设置失败: " + e);
	}
}

const extensionPackage = {
	name: "nm8_console",
	config: {
		nm8_autostart: {
			name: "启动后自动接管",
			init: false,
			item: { true: "开", false: "关" },
			onclick(bool) { S.autostartConfig = bool; },
		},
	},
	help: {
		"AI 悬浮控制台": `<li>进入对局后，F12 控制台执行 <b>NM8.help()</b> 查看全部接口
<li>常用：<b>NM8.quickStart()</b> 一键接管+浮层+自动驱动
<li>混合模式下关键决策暂停，等外部 AI 调 <b>NM8.decide(...)</b>
<li>官方作弊封装：<b>NM8.cheat.*</b> / 引擎操控：<b>NM8.god.*</b> / 官方面板：<b>NM8.control.*</b>
<li>对局行为日志复用官方录像缓冲：<b>NM8.log.tail(since)</b> 供其他 AI 实时读取
<li>对局左上角有 <b>控制台</b> 按钮：点开弹面板，点隐藏/F9 收起后按钮重现`,
	},
	package: {},
	files: { character: [], card: [], skill: [], audio: [] },

	// 早期初始化：让 window.NM8 在对局开始前（甚至主菜单）就可用，并屏蔽 alert
	precontent() {
		buildAPI();
		// NNM8 是本项目对外代号，与 NM8 完全等价（方便搜索/调用）：两个名字指向同一对象
		try { window.NNM8 = window.NM8; } catch (e) {}
		installAlertShield();
		installErrorCapture();
		integrateOfficial();
		pushLog("init", "NM8 控制台已就绪(precontent)");
	},

	arenaReady() {
		installTakeover();
		pushLog("init", "NM8 悬浮控制台已挂载");

		if (S._render) clearInterval(S._render);
		S._render = setInterval(() => { try { if (S._showPanel) renderPanel(); } catch (e) {} }, 600);

		if (S.autostartConfig) {
			setTimeout(() => { try { window.NM8.quickStart(); } catch (e) { pushLog("error", String(e)); } }, 1500);
		}

		// 进对局后右上角常驻"控制台"启动器（始终可见，不自动弹面板）；点它才展开，停靠右侧不与原生按键重叠
		try { buildLauncher(); showLauncher(true); } catch (e) { pushLog("error", "初始化浮层失败: " + e); }

		// F9 切换浮层显示/隐藏（双保险，无需 F12）
		if (!S._keyBound) {
			S._keyBound = true;
			document.addEventListener("keydown", (ev) => {
				if (ev.key === "F9" || ev.code === "F9") {
					ev.preventDefault();
					try { window.NM8.togglePanel(); } catch (e) {}
				}
			});
		}

		console.log("%c[NM8] AI 悬浮控制台已加载，执行 NM8.help() 查看接口（F9 切换浮层）", "color:#7ec699");
	},

	content(config, pack) {
		// precontent 已构建 NM8；此处兜底（兼容个别加载顺序），幂等
		buildAPI();
	},
};

// 从 info.json 读取作者/简介/版本等元信息填进 package，让「扩展管理」界面正确显示。
try {
	const extensionInfo = await lib.init.promises.json(`${lib.assetURL}extension/nm8_console/info.json`);
	Object.keys(extensionInfo)
		.filter((key) => key !== "name")
		.forEach((key) => { extensionPackage.package[key] = extensionInfo[key]; });
} catch (e) {
	// 读取失败不影响主功能
}

export let type = "extension";
export default extensionPackage;
