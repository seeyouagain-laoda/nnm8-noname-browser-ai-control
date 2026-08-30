/*
 * ⚠️ 声明（AI 生成 · 仅供参考）
 * 本代码由 AI 生成；仅适用于《无名杀》PC 版；
 * 仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）；
 * 其他版本未验证，仅供参考，使用风险自负。
 */
// 无名杀 NM8 —— 对外 AI 控制网关（HTTP JSON API）
// 作用：把游戏内 window.NM8（cheat/god/decide/quickStart/autoRun/players/snapshot…）
//       封装成标准 HTTP 接口，让其他 AI（OpenClaw / WorkBuddy / 任意 HTTP 客户端）
//       通过 http://127.0.0.1:8092 全自动驱动游戏，无需点界面。
//
// 架构：本进程(8092) --CDP(WebSocket)--> 游戏 Chrome(9333) --window.NM8--> 引擎
// 不改动游戏任何源码，独立进程，可单独重启。
//
// 启动：node nm8_api.cjs   （需先双击「启动无名杀控制台.bat」打开游戏）
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 9333;
const API_PORT = 8092;
const TARGET_HINT = '8091'; // 游戏页 url 含此串
// 实时日志落盘目录：默认放在仓库根 nm8_logs/（可移植）；可用环境变量 NM8_LOG_DIR 覆盖回原桌面路径
const FIELDLOG_DIR = process.env.NM8_LOG_DIR
  ? process.env.NM8_LOG_DIR
  : path.join(__dirname, '..', 'nm8_logs');

let cdp = null;          // 当前 CDP WebSocket
let cdpPageId = null;    // 当前选中的页面 id（断线重连复用，避免连到卡死页）
let msgId = 0;           // CDP JSON-RPC id 计数

// —— 实时对局日志落盘（Node 侧；扩展内是纯内存缓冲，浏览器无 fs）——
let fieldLogFile = null;     // 当前日志文件路径（其他 AI 可直读）
let fieldLogFH = null;       // 当前日志文件写流
let fieldLogLastSeq = 0;     // 已落盘的最后一个 seq（增量拉取用）
function rotateFieldLogFile() {
  try { if (fieldLogFH) { try { fieldLogFH.end(); } catch (e) {} fieldLogFH = null; } } catch (e) {}
  try { fs.mkdirSync(FIELDLOG_DIR, { recursive: true }); } catch (e) {}
  const name = 'nm8_live_log_' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl';
  fieldLogFile = path.join(FIELDLOG_DIR, name);
  fieldLogFH = fs.createWriteStream(fieldLogFile, { flags: 'a' });
  fieldLogLastSeq = 0;
  return fieldLogFile;
}
function appendFieldLogEntries(entries) {
  if (!fieldLogFH || !Array.isArray(entries) || !entries.length) return;
  for (const e of entries) {
    try { fieldLogFH.write(JSON.stringify(e) + '\n'); } catch (err) {}
    if (e.seq > fieldLogLastSeq) fieldLogLastSeq = e.seq;
  }
}

// ---------- CDP 连接 ----------
function fetchTargets() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: CDP_PORT, path: '/json', timeout: 4000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve([]); } });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

// 打开一个页面 WebSocket（连不上/超时返回 null）
function openWs(url) {
  return new Promise((resolve) => {
    let ws;
    try { ws = new WebSocket(url); } catch (e) { return resolve(null); }
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} resolve(null); }, 5000);
    ws.on('open', () => { clearTimeout(to); resolve(ws); });
    ws.on('error', () => { clearTimeout(to); resolve(null); });
  });
}

// 在指定 ws 上做一次 Runtime.evaluate（带超时；返回解包值或 {__timeout}/{__error}）
function rpcEvalOnWs(ws, expr, awaitPromise, timeoutMs) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const to = setTimeout(() => { try { ws.off('message', onMsg); } catch (e) {} resolve({ __timeout: true }); }, timeoutMs);
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.id !== id) return;
      try { ws.off('message', onMsg); } catch (e) {}
      clearTimeout(to);
      if (m.error) return resolve({ __error: m.error.message });
      const rr = m.result && m.result.result;
      if (!rr) return resolve(null);
      if (rr.type === 'undefined') return resolve(null);
      if ('value' in rr) return resolve(rr.value);
      resolve(rr);
    };
    ws.on('message', onMsg);
    try { ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise } })); }
    catch (e) { clearTimeout(to); resolve({ __error: String(e) }); }
  });
}

// 给一个页面打分：是否存活 / 是否含 window.NM8 / 是否在对局（主线程卡死的页会超时）
async function scorePage(page) {
  const ws = await openWs(page.webSocketDebuggerUrl);
  if (!ws) return { id: page.id, alive: false };
  const r = await rpcEvalOnWs(ws,
    "(function(){ try { var n=(typeof window.NM8!=='undefined'&&window.NM8); if(!n) return 'NONM8'; var ps=(n.snapshot().players||[]).filter(function(x){return x&&x.name;}); return 'NM8|'+ps.length; } catch(e){ return 'ERR:'+e; } })()",
    false, 4000);
  try { ws.close(); } catch (e) {}
  if (r && typeof r === 'string' && r.indexOf('NM8') === 0) {
    const cnt = parseInt((r.split('|')[1] || '0'), 10) || 0;
    return { id: page.id, alive: true, hasNM8: true, inGame: cnt > 0, players: cnt, url: page.webSocketDebuggerUrl };
  }
  return { id: page.id, alive: true, hasNM8: false, url: page.webSocketDebuggerUrl };
}

// 从所有 8091 页面里挑可用目标：优先「已在对局」，其次「含 NM8 的响应页」；跳过卡死页
async function selectTarget() {
  const targets = await fetchTargets();
  const pages = (targets || []).filter(t => t.type === 'page' && (t.url || '').includes(TARGET_HINT));
  if (!pages.length) return null;
  const scored = await Promise.all(pages.map(scorePage)); // 并行探测，卡死页超时自动落选
  let best = null;
  let anyAlive = null; // 回退：即使扩展未加载(NM8 不存在)，也连存活的 8091 页（用于"先验证浏览器操控"）
  for (const s of scored) {
    if (s.alive && !anyAlive) anyAlive = s;
    if (s.hasNM8) {
      if (s.inGame) return s;            // 已开局的页面优先（对局就在它身上）
      if (!best) best = s;
    }
  }
  return best || anyAlive;
}

async function ensureCdp() {
  if (cdp && cdp.readyState === WebSocket.OPEN && cdpPageId) return cdp;       // 复用已选页面
  if (cdpPageId) {                                                          // 断线后尝试重连同一页面
    const targets = await fetchTargets();
    const t = (targets || []).find(x => x.id === cdpPageId);
    if (t) { const ws = await openWs(t.webSocketDebuggerUrl); if (ws) { cdp = ws; return ws; } }
  }
  const sel = await selectTarget();
  if (!sel) { cdp = null; cdpPageId = null; return null; }
  const ws = await openWs(sel.url);
  if (!ws) { cdp = null; cdpPageId = null; return null; }
  cdp = ws; cdpPageId = sel.id;
  return ws;
}

// 在游戏页面执行 JS 表达式，returnByValue + 可选 awaitPromise，带超时
function cdpEval(expr, awaitPromise = true, timeout = 20000) {
  return new Promise(async (resolve, reject) => {
    const ws = await ensureCdp();
    if (!ws) { cdp = null; cdpPageId = null; return reject(new Error('CDP 未连接：请先双击「启动无名杀控制台.bat」打开游戏')); }
    const id = ++msgId;
    const to = setTimeout(() => { try { ws.off('message', onMsg); } catch (e) {} cdp = null; cdpPageId = null; reject(new Error('CDP 调用超时')); }, timeout);
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (m.id !== id) return;
      try { ws.off('message', onMsg); } catch (e) {}
      clearTimeout(to);
      if (m.error) { cdp = null; cdpPageId = null; return reject(new Error('CDP错误: ' + m.error.message)); }
      const r = m.result;
      if (r && r.exceptionDetails) {
        const ex = r.exceptionDetails;
        return reject(new Error('游戏内异常: ' + (ex.text || '') + ' ' + (ex.exception && ex.exception.description ? ex.exception.description : '')));
      }
      // 解包 CDP RemoteObject：returnByValue 下 result 形如 {type,value}
      const rr = r && r.result;
      if (!rr) return resolve(null);
      if (rr.type === 'undefined') return resolve(null);
      if ('value' in rr) return resolve(rr.value);
      resolve(rr);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise } }));
  });
}

// ---------- 自动开局序列（在游戏页内执行）----------
function autoStartExpr(n, autoRun) {
  return `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const N = ${JSON.stringify(n)};
  const DO_AUTORUN = ${JSON.stringify(autoRun !== false)};
  const hasNM8 = typeof window.NM8 !== 'undefined';
  const inGame = hasNM8 && (window.NM8.snapshot().players || []).some(p => p && p.name);
  // 已在对局：直接接管 + 自动驱动（内置 AI 全自动，不暂停等外部）
  if (inGame) { window.NM8.setMode('builtin'); window.NM8.setForcePlay(false); if (DO_AUTORUN) { const r = window.NM8.autoRun(true, 900); return { action: 'takeover', autoRun: r.autoRun }; } return { action: 'takeover', autoRun: false }; }
  if (!hasNM8) return { action: 'noNM8', error: '扩展未加载' };
  // 注：v3.3.0 起日志直接读官方录像缓冲 lib.video（NM8.log），无需清空独立缓冲
  // 配置身份局
  try {
    const lib = window.lib;
    lib.config.mode_config = lib.config.mode_config || {};
    lib.config.mode_config.identity = lib.config.mode_config.identity || {};
    lib.config.mode_config.identity.player_number = String(N);
    lib.config.mode_config.identity.free_choose = false; // 用官方精选将池，避免 OL 将缺 AI 卡死
    lib.saveConfig('mode_config', lib.config.mode_config);
    lib.saveConfig('mode', 'identity');
  } catch (e) {}
  const clickText = (txt) => {
    const els = [...document.querySelectorAll('*')].filter(el => (el.innerText || '').trim() === txt && el.getBoundingClientRect().width > 0);
    els.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    if (els[0]) { els[0].click(); return true; } return false;
  };
  if (!clickText('身份')) return { action: 'noIdentityButton' };
  await sleep(4000);
  for (let i = 0; i < 60; i++) {
    const cards = [...document.querySelectorAll('.button.character.newstyle.selectable')].filter(c => c.offsetParent !== null);
    const cnt = (window.NM8.snapshot().players || []).filter(x => x && x.name).length;
    if (cnt >= N && cards.length === 0) break;
    if (!cards.length) { await sleep(1200); continue; }
    cards[0].click(); await sleep(1300);
  }
  for (let t = 0; t < 40; t++) {
    const ps = window.NM8.snapshot().players || [];
    const okAll = ps.length >= N && ps.every(p => !!p.name);
    if (okAll) break;
    const b = [...document.querySelectorAll('.button,.menubutton')].find(b => {
      const x = (b.innerText || '').replace(/\\s/g, '');
      return (x.includes('开始') || x.includes('确定') || x.includes('确认')) && b.offsetParent !== null;
    });
    if (b) b.click();
    await sleep(1000);
  }
  await sleep(2500);
  window.NM8.setMode('builtin'); // 内置 AI 全自动出牌，不再 hybrid 暂停等外部
  window.NM8.setForcePlay(false); // 关闭强制出牌，避免 ok 无选牌被引擎驳回死循环
  // 只开 autoRun，不再 quickStart（避免全座位接管导致自定义技能卡死）
  if (DO_AUTORUN) { const r = window.NM8.autoRun(true, 900); return { action: 'started', autoRun: r.autoRun, mode: window.NM8.state.mode, players: (window.NM8.snapshot().players || []).length }; }
  return { action: 'started', autoRun: false, mode: window.NM8.state.mode, players: (window.NM8.snapshot().players || []).length };
})()`;
}

// ---------- HTTP 工具 ----------
const J = JSON.stringify;
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function ok(res, data) { send(res, 200, { success: true, data }); }
function fail(res, code, msg) { send(res, 200, { success: false, code, error: msg }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

const API_DOC = {
  name: '无名杀 NM8 AI 控制网关',
  base: 'http://127.0.0.1:8092',
  auth: '无（仅监听 127.0.0.1 本机回环，供本机 AI 客户端调用）',
  note: '所有 POST 接口 body 为 JSON；返回统一 {success,data|error}。游戏内异常会原样返回 error。',
  routes: {
    'GET  /api/v1/health': '网关与游戏连接状态、NM8 版本、是否在对局',
    'GET  /api/v1/state':  '全场状态：state/players/snapshot/当前事件/是否暂停',
    'GET  /api/v1/players':'所有角色信息数组',
    'GET  /api/v1/snapshot':'完整对局快照（NM8.snapshot() 原始结构）',
    'GET  /api/v1/log':    '最近若干条 NM8 内部日志（默认40，?n= 可调）',
    'GET  /api/v1/errors': '仅报错/警告/弹窗/引擎容错类日志（含 engineError），供外部 AI 快速判断异常',
    'GET  /api/v1/fieldlog':'实时对局行为日志（纯观测）：?since=N 取增量序列号后的事件；返回 {file:落盘jsonl路径, lastSeq, entries}',
    'POST /api/v1/start':  '{n?} 自动开局或接管当前局并自动驱动；已在对局则直接接管',
    'POST /api/v1/stop':   '停止自动驱动(autoRun=false)',
    'POST /api/v1/give':   '{card,seat} 作弊发牌（牌key，如 sha/shan/tao/zhuge）',
    'POST /api/v1/giveAll':'{card} 给全场每人发该牌',
    'POST /api/v1/giveCard':'{seat,card} 引擎原生发牌（精确指定牌名，区别于 cheat.give 作弊通道）',
    'POST /api/v1/equip':  '{seat} 给某座位神装',
    'POST /api/v1/draw':   '{n?,seat?} 抽 n 张牌（默认1，seat 默认我）',
    'POST /api/v1/peek':   '{seat?} 查看某座位手牌',
    'POST /api/v1/hp':     '{seat,value} 设血量',
    'POST /api/v1/heal':   '{seat,n?} 加血',
    'POST /api/v1/hurt':   '{seat,n?} 扣血',
    'POST /api/v1/loseHp': '{seat,n?} 失去体力（触发濒死结算）',
    'POST /api/v1/kill':   '{seat} 击杀',
    'POST /api/v1/revive': '{seat} 复活',
    'POST /api/v1/addSkill':'{seat,skill} 给角色添加技能',
    'POST /api/v1/setIdentity':'{seat,identity} 设定角色身份（主公/忠臣/反贼/内奸）',
    'POST /api/v1/identities':'查看全场身份分布',
    'POST /api/v1/winner':'强制判定胜方（调试用）',
    'POST /api/v1/control':'打开控制台（ui.control）',
    'POST /api/v1/mode':   '{mode?} 设置驱动模式 builtin/hybrid/external',
    'POST /api/v1/forcePlay':'{on} 开关强制出牌',
    'POST /api/v1/takeover':'{on} 接管/释放当前决策',
    'POST /api/v1/step':   '{force?} 单步推进事件',
    'POST /api/v1/clearLog':'清空 NM8 内部日志缓冲',
    'POST /api/v1/decide': '{action,ids?,names?,index?} 外部决策：ok/cancel/cards/targets/button',
    'POST /api/v1/command':'{code} 执行任意游戏 JS 代码（高级，等同控制台"运行"）',
    'POST /api/v1/panel':  '{on} 显示/隐藏控制台面板',
    'POST /api/v1/exec':   '{expression} 执行任意 JS 表达式并返回值（终极兜底）',
    'POST /api/v1/reload': '重载游戏页面（Page.reload）'
  },
  examples: [
    'curl http://127.0.0.1:8092/api/v1/health',
    'curl -X POST http://127.0.0.1:8092/api/v1/start -H "Content-Type: application/json" -d "{\\"n\\":5}"',
    'curl -X POST http://127.0.0.1:8092/api/v1/give -H "Content-Type: application/json" -d "{\\"card\\":\\"zhuge\\",\\"seat\\":\\"1\\"}"',
    'curl -X POST http://127.0.0.1:8092/api/v1/hp -H "Content-Type: application/json" -d "{\\"seat\\":\\"1\\",\\"value\\":8}"'
  ]
};

// ---------- HTTP 服务 ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  const method = req.method;
  if (method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': '*' }); return res.end(); }
  try {
    if (p === '/' || p === '/api/v1/help') return send(res, 200, API_DOC);
    if (p === '/api/v1/health') {
      const h = await cdpEval(`(function(){ try { return { nm8: typeof window.NM8, version: window.NM8 && window.NM8.VERSION, inGame: (window.NM8.snapshot().players||[]).some(x=>x&&x.name), players:(window.NM8.snapshot().players||[]).length, autoRun: window.NM8.state && window.NM8.state.autoRun }; } catch(e){ return { nm8:'error', err:String(e) }; } })()`, false).catch(e => ({ nm8: 'error', err: String(e) }));
      return ok(res, { cdp: !!(cdp && cdp.readyState === WebSocket.OPEN), ...h });
    }
    if (p === '/api/v1/state') {
      const s = await cdpEval(`(function(){ try { var snap=window.NM8.snapshot(); var st=window.NM8.state; var e=window.NM8.event(); return { state:st, players:window.NM8.players(), snapshot:snap, event:(e?{name:e.name,player:(e.player&&e.player.name)||null}:null), paused:(snap&&typeof snap.paused!=='undefined'?snap.paused:null), autoRun:(st&&st.autoRun)||false, mode:(st&&st.mode)||null }; } catch(e){ return {error:String(e)}; } })()`, false);
      return ok(res, s);
    }
    if (p === '/api/v1/players') { const r = await cdpEval('window.NM8.players()', false); return ok(res, r); }
    if (p === '/api/v1/snapshot') { const r = await cdpEval('window.NM8.snapshot()', false); return ok(res, r); }
    if (p === '/api/v1/log') { const r = await cdpEval(`window.NM8.log2().slice(-40)`, false); return ok(res, r); }
    if (p === '/api/v1/errors') {
      // 只返回报错/警告/弹窗类日志，供外部 AI 快速判断"是否出问题了"（含引擎容错吞掉的 engineError）
      const r = await cdpEval(`window.NM8.log2().filter(function(x){return ['error','alert','watchdog','warn','engineError'].indexOf(x.kind)>=0;}).slice(-30)`, false);
      return ok(res, r);
    }
    if (p === '/api/v1/fieldlog') {
      // 实时对局行为日志：返回增量事件 + 落盘文件路径（其他 AI 可直读该 jsonl）
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      const r = await cdpEval('window.NM8.log.get(' + since + ')', false, 8000).catch(() => []);
      return ok(res, { file: fieldLogFile, lastSeq: fieldLogLastSeq, entries: Array.isArray(r) ? r : [] });
    }

    if (method === 'POST') {
      let body = {};
      try { body = await readBody(req); } catch (e) {}
      if (p === '/api/v1/start') { rotateFieldLogFile(); const r = await cdpEval(autoStartExpr(body.n || 5, body.autoRun !== false), true, 90000); try { fieldLogFH.write(JSON.stringify({ seq: 0, t: Date.now(), type: '__game_start', content: r }) + '\n'); } catch (e) {} return ok(res, r); }
      if (p === '/api/v1/stop') { const r = await cdpEval('window.NM8.autoRun(false)', false); return ok(res, r); }
      if (p === '/api/v1/give') { const r = await cdpEval(`window.NM8.cheat.give(${J(body.card)}, ${J(body.seat)})`, false); return ok(res, r); }
      if (p === '/api/v1/giveAll') { const r = await cdpEval(`window.NM8.cheat.giveAll(${J(body.card)})`, false); return ok(res, r); }
      if (p === '/api/v1/equip') { const r = await cdpEval(`window.NM8.cheat.equip(${J(body.seat)})`, false); return ok(res, r); }
      if (p === '/api/v1/draw') { const r = await cdpEval(`window.NM8.cheat.draw(${J(body.n || 1)}, ${J(body.seat || 'me')})`, false); return ok(res, r); }
      if (p === '/api/v1/peek') { const r = await cdpEval(`window.NM8.cheat.peek(${J(body.seat || 'me')})`, false); return ok(res, r); }
      if (p === '/api/v1/hp') { const r = await cdpEval(`window.NM8.god.setHp(${J(body.seat)}, ${J(body.value)})`, false); return ok(res, r); }
      if (p === '/api/v1/heal') { const r = await cdpEval(`window.NM8.god.heal(${J(body.seat)}, ${J(body.n || 1)})`); return ok(res, r); }
      if (p === '/api/v1/hurt') { const r = await cdpEval(`window.NM8.god.hurt(${J(body.seat)}, ${J(body.n || 1)})`); return ok(res, r); }
      if (p === '/api/v1/loseHp') { const r = await cdpEval(`window.NM8.god.loseHp(${J(body.seat)}, ${J(body.n || 1)})`); return ok(res, r); }
      if (p === '/api/v1/kill') { const r = await cdpEval(`window.NM8.god.kill(${J(body.seat)})`); return ok(res, r); }
      if (p === '/api/v1/revive') { const r = await cdpEval(`window.NM8.god.revive(${J(body.seat)})`); return ok(res, r); }
      // —— 引擎原生发牌（精确指定牌名，区别于 cheat.give 的官方作弊通道）——
      if (p === '/api/v1/giveCard') { const r = await cdpEval(`window.NM8.god.give(${J(body.seat)}, ${J(body.card)})`); return ok(res, r); }
      if (p === '/api/v1/addSkill') { const r = await cdpEval(`window.NM8.god.addSkill(${J(body.seat)}, ${J(body.skill)})`, false); return ok(res, r); }
      if (p === '/api/v1/setIdentity') { const r = await cdpEval(`window.NM8.god.setIdentity(${J(body.seat)}, ${J(body.identity)})`, false); return ok(res, r); }
      if (p === '/api/v1/identities') { const r = await cdpEval(`window.NM8.cheat.identities()`, false); return ok(res, r); }
      if (p === '/api/v1/winner') { const r = await cdpEval(`window.NM8.god.winner()`, false); return ok(res, r); }
      if (p === '/api/v1/control') { const r = await cdpEval(`window.NM8.control.open()`, false); return ok(res, r); }
      if (p === '/api/v1/mode') { const r = await cdpEval(`window.NM8.setMode(${J(body.mode || 'builtin')})`, false); return ok(res, r); }
      if (p === '/api/v1/forcePlay') { const r = await cdpEval(`window.NM8.setForcePlay(${J(!!body.on)})`, false); return ok(res, r); }
      if (p === '/api/v1/takeover') { const r = await cdpEval(`window.NM8.takeover(${J(!!body.on)})`, false); return ok(res, r); }
      if (p === '/api/v1/step') { const r = await cdpEval(`window.NM8.step(${J(!!body.force)})`, false); return ok(res, r); }
      if (p === '/api/v1/clearLog') { const r = await cdpEval(`window.NM8.clearLog()`, false); return ok(res, r); }
      if (p === '/api/v1/log') { const r = await cdpEval(`window.NM8.log2().slice(-${J(body.n || 40)})`, false); return ok(res, r); }
      if (p === '/api/v1/decide') { const r = await cdpEval(`window.NM8.decide(${J(body)})`, false); return ok(res, r); }
      if (p === '/api/v1/command') { const r = await cdpEval(`window.NM8.cheat.run(${J(body.code)})`, true); return ok(res, r); }
      if (p === '/api/v1/panel') { const r = await cdpEval(`window.NM8.showPanel(${J(!!body.on)})`, false); return ok(res, r); }
      if (p === '/api/v1/exec') { const r = await cdpEval(body.expression, true); return ok(res, r); }
      if (p === '/api/v1/reload') {
        const ws = await ensureCdp();
        if (!ws) return fail(res, 500, 'CDP 未连接');
        try { ws.send(JSON.stringify({ id: ++msgId, method: 'Page.reload', params: {} })); } catch (e) {}
        cdp = null; cdpPageId = null; // 重载后旧连接失效，下次请求重新选择
        return ok(res, { reloaded: true });
      }
      return fail(res, 404, '未知路由: ' + p);
    }
    return fail(res, 404, '未找到: ' + p);
  } catch (e) {
    return fail(res, 500, String(e && e.message ? e.message : e));
  }
});

// 后台增量拉取：每 800ms 从游戏内 fieldLog 取新增事件追加到 jsonl 文件（仅在对局日志文件开启时）
setInterval(async () => {
  try {
    if (!fieldLogFH) return;                              // 没开局则不拉取
    if (!cdp || cdp.readyState !== WebSocket.OPEN) return; // CDP 未连则跳过本轮
    const r = await cdpEval('window.NM8.log.get(' + fieldLogLastSeq + ')', false, 5000).catch(() => null);
    if (Array.isArray(r)) appendFieldLogEntries(r);
  } catch (e) {}
}, 800);

server.listen(API_PORT, '127.0.0.1', () => console.log('[NM8 AI API] listening on http://127.0.0.1:' + API_PORT));
