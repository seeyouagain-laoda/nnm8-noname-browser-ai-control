/*
 * ⚠️ 声明（AI 生成 · 仅供参考）
 * 本代码由 AI 生成；仅适用于《无名杀》PC 版；
 * 仅测试过当前版本（诗笺版 Windows64 位 v1.75，引擎内部 1.11.5）；
 * 其他版本未验证，仅供参考，使用风险自负。
 */
// 无名杀 合并静态服务器：可靠静态(MIME正确) + 复制 noname-server.js 的文件接口
// 用途：在普通 Chrome 里把 Electron 版无名杀跑起来，并补齐浏览器缺失的私有 API / 资源
// 许可：MIT（与无名杀本体 GPL-3.0 互不冲突；游戏本体请自行合法拥有）
const http = require('http');
const fs = require('fs');
const path = require('path');
// 无名杀资源根目录（即安装目录下的 resources/app）。
// 默认值仅为示例，请改成你本机实际路径；也可通过环境变量 NONAME_ROOT 覆盖（推荐）。
const ROOT = process.env.NONAME_ROOT || 'D:/noname-shijian-v1.75-win32-x64/resources/app';
const PORT = 8091;

const MIME = {
  '.html':'text/html; charset=utf-8', '.htm':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.cjs':'text/javascript; charset=utf-8', '.ts':'text/javascript; charset=utf-8',
  '.jsx':'text/javascript; charset=utf-8', '.tsx':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.map':'application/json; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.svg':'image/svg+xml', '.webp':'image/webp', '.ico':'image/x-icon',
  '.wav':'audio/wav', '.mp3':'audio/mpeg', '.ogg':'audio/ogg', '.m4a':'audio/mp4',
  '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf',
  '.wasm':'application/wasm'
};
const ROOT_NORM = path.normalize(ROOT);
const isInProject = (rel) => { const fp = path.normalize(path.join(ROOT, rel)); return fp === ROOT_NORM || fp.startsWith(ROOT_NORM + path.sep); };
const successfulJson = (data) => ({ success:true, code:200, data });
const failedJson = (code, msg) => ({ success:false, code, errorMsg:msg });

// 是否为 Electron 专属扩展：源码直接使用 Node API(process/require/electron/node:)，浏览器环境无法加载
function isElectronOnly(name) {
  const d = path.join(ROOT, 'extension', name);
  const candidates = ['extension.js', 'extension.ts'];
  for (const f of candidates) {
    const fp = path.join(d, f);
    if (!fs.existsSync(fp)) continue;
    try {
      const src = fs.readFileSync(fp, 'utf-8');
      if (/\bprocess\b/.test(src) || /\brequire\s*\(/.test(src) ||
          /from\s+['"]electron['"]/.test(src) || /node:/.test(src)) {
        return true;
      }
    } catch (e) {}
  }
  return false;
}
// 计算内置扩展目录：extension/ 下含 extension.js / extension.ts 的文件夹（仅浏览器兼容的）
function getBuiltinExtensions() {
  const extDir = path.join(ROOT, 'extension');
  const out = [];
  try {
    for (const n of fs.readdirSync(extDir)) {
      if (n[0] === '.' || n[0] === '_') continue;
      const d = path.join(extDir, n);
      if (!fs.statSync(d).isDirectory()) continue;
      if (fs.existsSync(path.join(d, 'extension.js')) || fs.existsSync(path.join(d, 'extension.ts'))) {
        if (isElectronOnly(n)) { console.log('[noname bridge] skip electron-only ext:', n); continue; }
        out.push(n);
      }
    }
  } catch (e) { console.log('getBuiltinExtensions error', e); }
  return out;
}
const BUILTIN_EXT = getBuiltinExtensions();
// Electron 专属扩展（浏览器无法加载，需主动剔除）
const ELECTRON_ONLY_EXT = (() => {
  const extDir = path.join(ROOT, 'extension');
  const out = [];
  try {
    for (const n of fs.readdirSync(extDir)) {
      if (n[0] === '.' || n[0] === '_') continue;
      const d = path.join(extDir, n);
      if (!fs.statSync(d).isDirectory()) continue;
      if (fs.existsSync(path.join(d, 'extension.js')) || fs.existsSync(path.join(d, 'extension.ts'))) {
        if (isElectronOnly(n)) out.push(n);
      }
    }
  } catch (e) {}
  return out;
})();
console.log('[noname bridge] browser-safe builtin extensions:', BUILTIN_EXT.join(', '));
console.log('[noname bridge] electron-only (skipped):', ELECTRON_ONLY_EXT.join(', '));

// 缺失资源兜底：消除浏览器桥接下的 404 控制台错误（Electron 下由扩展加载器静默处理）
const EMPTY_MODULE = 'export default {};\n';
const TRANSPARENT_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC','base64');
function sendBuffer(res, buf, type) {
  res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin':'*' });
  res.end(buf);
}
function resolveFallback(rel, fp, st) {
  // 1) 目录请求(/theme/style/card) -> 目录内默认文件
  if (st && st.isDirectory()) {
    for (const f of ['index.css','default.css','style.css','index.js','default.js']) {
      const cand = path.join(fp, f);
      if (fs.existsSync(cand)) return cand;
    }
  }
  // 2) mode/X/index.js -> mode/X.js (扁平布局的 stock 模式)
  const m = rel.match(/^mode\/([^/]+)\/index\.(js|ts)$/);
  if (m) {
    for (const ext of ['js','ts']) {
      const cand = path.join(ROOT, `mode/${m[1]}.${ext}`);
      if (fs.existsSync(cand)) return cand;
    }
  }
  // 3) 缺失图片 -> 透明 PNG（静默，不报错）
  if (/^image\//.test(rel) && /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(rel)) return 'TRANSPARENT';
  // 4) 缺失的内容模块(card/character/skill/mode/extension/audio 下的 .js/.ts) -> 空模块
  if (/\.(js|ts|mjs)$/i.test(rel) && /^(card|character|skill|mode|extension|audio)\//.test(rel)) return 'EMPTY_MODULE';
  return null;
}
function serveStatic(res, urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const rel = p.replace(/^\/+/, '');
  if (!isInProject(rel)) { res.writeHead(403); res.end('forbidden'); return; }
  const fp = path.join(ROOT, rel);
  fs.stat(fp, (e, st) => {
    if (!e && st.isFile()) {
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin':'*' });
      return fs.createReadStream(fp).pipe(res);
    }
    const fb = resolveFallback(rel, fp, st);
    if (fb === 'TRANSPARENT') return sendBuffer(res, TRANSPARENT_PNG, 'image/png');
    if (fb === 'EMPTY_MODULE') return sendBuffer(res, EMPTY_MODULE, 'text/javascript; charset=utf-8');
    if (fb) {
      const ext = path.extname(fb).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin':'*' });
      return fs.createReadStream(fb).pipe(res);
    }
    res.writeHead(404, {'Content-Type':'text/plain'}); res.end('404');
  });
}
function sendJson(res, obj) {
  res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
  res.end(JSON.stringify(obj));
}
function q(req){ return new URL(req.url, 'http://localhost'); }

const server = http.createServer((req, res) => {
  const u = q(req);
  const route = u.pathname;
    const send = () => {
    if (route === '/readFile') {
      const f = u.searchParams.get('fileName');
      if (!f || !isInProject(f) || !fs.existsSync(path.join(ROOT,f))) { console.log('MISSING readFile', f); return sendJson(res, failedJson(404,'文件不存在')); }
      return sendJson(res, successfulJson(Array.prototype.slice.call(new Uint8Array(fs.readFileSync(path.join(ROOT,f))))));
    }
    if (route === '/readFileAsText') {
      const f = u.searchParams.get('fileName');
      if (!f || !isInProject(f) || !fs.existsSync(path.join(ROOT,f))) { console.log('MISSING readFileAsText', f); return sendJson(res, failedJson(404,'文件不存在')); }
      return sendJson(res, successfulJson(fs.readFileSync(path.join(ROOT,f),'utf-8')));
    }
    if (route === '/getFileList') {
      const d = u.searchParams.get('dir');
      if (!d || !isInProject(d) || !fs.existsSync(path.join(ROOT,d))) return sendJson(res, failedJson(404,'文件夹不存在'));
      const files=[], folders=[];
      for (const n of fs.readdirSync(path.join(ROOT,d))) {
        if (n[0]==='.'||n[0]==='_') continue;
        if (fs.statSync(path.join(ROOT,d,n)).isDirectory()) folders.push(n); else files.push(n);
      }
      return sendJson(res, successfulJson({ folders, files }));
    }
    if (route === '/checkFile') {
      const f = u.searchParams.get('fileName');
      try { if (fs.statSync(path.join(ROOT,f)).isFile()) return sendJson(res, successfulJson('file')); if (fs.statSync(path.join(ROOT,f)).isDirectory()) return sendJson(res, successfulJson('directory')); }
      catch(e){}
      // 不存在时按浏览器约定返回 missing，让前端走 callback(-1) 而不是 onerror，避免 boot 弹窗
      return sendJson(res, successfulJson('missing'));
    }
    if (route === '/checkDir') {
      const d = u.searchParams.get('dir');
      try { if (fs.statSync(path.join(ROOT,d)).isDirectory()) return sendJson(res, successfulJson('directory')); }
      catch(e){}
      return sendJson(res, successfulJson('missing'));
    }
    if (route === '/createDir') {
      const d = u.searchParams.get('dir');
      if (!isInProject(d)) return sendJson(res, failedJson(400,'越权'));
      fs.mkdirSync(path.join(ROOT,d), { recursive:true });
      return sendJson(res, successfulJson(true));
    }
    if (route === '/removeDir') {
      const d = u.searchParams.get('dir');
      if (isInProject(d) && fs.existsSync(path.join(ROOT,d))) fs.rmdirSync(path.join(ROOT,d), { recursive:true });
      return sendJson(res, successfulJson(true));
    }
    if (route === '/removeFile') {
      const f = u.searchParams.get('fileName');
      if (f && f !== 'noname.config.txt' && isInProject(f) && fs.existsSync(path.join(ROOT,f))) fs.unlinkSync(path.join(ROOT,f));
      return sendJson(res, successfulJson(true));
    }
    // 清洗版 index.html：去掉 SW 注册 + reload 引导脚本，保留全部模块预加载清单
    if (route === '/__bridge.html') {
      let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8')
        .replace(/<script type="module">\s*\/\/ src\/entry\.ts[\s\S]*?<\/script>/, '');
      // 注入早期脚本：真实 Chrome 打开也能跳过 GPL/免费弹窗 + 触发官方暴露路径
      const early = `<script>
        try {
          localStorage.setItem('gplv3_noname_alerted','true');
          localStorage.setItem('noname_freeTips','true');
          localStorage.setItem('noname_gplv3','true');
          window.isNonameServer = true;
        } catch(e) {}
      </script>`;
      // 注入自动启用内置扩展并写盘(IndexedDB)逻辑：
      // - 仅启用浏览器兼容的内置扩展，主动剔除 Electron 专属扩展(应用配置/拖拽读取 等用到 process/require)
      // - 用版本化标记，浏览器扩展列表与当前安全清单不符时自动重跑(覆盖已写入的坏扩展)，但不动用户手动新增的其他扩展
      const autoext = `<script>
      (function(){
        var BUILTIN = ${JSON.stringify(BUILTIN_EXT)};
        var ELECTRON_ONLY = ${JSON.stringify(ELECTRON_ONLY_EXT)};
        var PREFIX = 'noname_0.9_';
        var MARK = 'autoext_done_v2';
        var MARKVAL = BUILTIN.join('|');
        function enableAll(){
          try{
            if (localStorage.getItem(PREFIX+'disable_extension')) return;
            var saved = localStorage.getItem(PREFIX+MARK);
            if (saved === MARKVAL) return; // 已是最新安全清单，跳过
            if (!window.game || !window.lib || !window.game.promises || !window.game.promises.saveConfig){ setTimeout(enableAll,500); return; }
            var curArr = (window.lib.config && Array.isArray(window.lib.config.extensions)) ? window.lib.config.extensions.slice() : [];
            // 剔除 Electron 专属
            var bad = {}; for (var b=0;b<ELECTRON_ONLY.length;b++) bad[ELECTRON_ONLY[b]]=true;
            var clean = curArr.filter(function(x){ return !bad[x]; });
            // 合并安全内置
            var set = {}; for (var i=0;i<clean.length;i++) set[clean[i]]=true;
            var changed=false;
            for (var j=0;j<BUILTIN.length;j++){ if(!set[BUILTIN[j]]){ set[BUILTIN[j]]=true; changed=true; } }
            var arr = Object.keys(set);
            var tasks = [ window.game.promises.saveConfig('extensions', arr) ];
            for (var k=0;k<BUILTIN.length;k++){ tasks.push(window.game.promises.saveConfig('extension_'+BUILTIN[k]+'_enable', true)); }
            for (var m=0;m<ELECTRON_ONLY.length;m++){ tasks.push(window.game.promises.saveConfig('extension_'+ELECTRON_ONLY[m]+'_enable', false)); }
            Promise.all(tasks).then(function(){
              localStorage.setItem(PREFIX+MARK, MARKVAL);
              console.log('[autoext] browser-safe extensions: '+arr.join(','));
              if (changed){ if(window.game.reload) window.game.reload(); else location.reload(); }
            }).catch(function(e){ console.log('[autoext] save failed '+e); });
          }catch(e){ console.log('[autoext] error '+e); }
        }
        if (document.readyState==='complete'||document.readyState==='interactive') setTimeout(enableAll,1500);
        else window.addEventListener('DOMContentLoaded', function(){ setTimeout(enableAll,1500); });
      })();
      </script>`;
      html = html.replace(/<head>/i, '<head>' + early + autoext);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(html);
      return;
    }
    // 补齐 Vite 虚拟模块（让 index.html 在无 Vite 下也能跑）
    if (route === '/vue') {
      return serveStatic(res, '/node_modules/.pnpm/vue@3.5.28/node_modules/vue/dist/vue.esm-browser.js');
    }
    if (route === '/preload.js') {
      return serveStatic(res, '/noname/init/browser.js');
    }
    // 暴露游戏 API：在 library/index.js 末尾追加（仅线上分发，不改动磁盘文件）
    if (route === '/noname/library/index.js') {
      const fp = path.join(ROOT, 'noname/library/index.js');
      if (fs.existsSync(fp)) {
        let src = fs.readFileSync(fp, 'utf-8');
        src += `
;(function(){
  function __nm_expose(){
    try{window.__nm_game=game;}catch(e){}
    try{window.__nm_ui=ui;}catch(e){}
    try{window.__nm_lib=lib;}catch(e){}
    try{window.__nm_get=get;}catch(e){}
    try{window.__nm_ai=ai;}catch(e){}
    try{window.__nm_status=_status;}catch(e){}
    try{window.__nm_cheat=(typeof lib!=='undefined'&&lib.cheat)?lib.cheat:window.__nm_cheat;}catch(e){}
    try{window.game=game;}catch(e){}
    try{window.ui=ui;}catch(e){}
    try{window.lib=lib;}catch(e){}
  }
  __nm_expose();
  setTimeout(__nm_expose, 1000);
  setTimeout(__nm_expose, 3000);
})();
`;
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(src);
        return;
      }
    }
    // 静态
    serveStatic(res, route);
  };
  if (req.method === 'POST' && route === '/writeFile') {
    let body='';
    req.on('data', c=> body+=c);
    req.on('end', () => {
      try {
        const { path:p, data } = JSON.parse(body);
        if (!isInProject(p)) return sendJson(res, failedJson(400,'越权'));
        fs.mkdirSync(path.dirname(path.join(ROOT,p)), { recursive:true });
        fs.writeFileSync(path.join(ROOT,p), Buffer.from(data));
        return sendJson(res, successfulJson(true));
      } catch(e){ return sendJson(res, failedJson(500,String(e))); }
    });
    return;
  }
  send();
});
server.listen(PORT, '127.0.0.1', () => console.log('noname bridge server on', PORT));
