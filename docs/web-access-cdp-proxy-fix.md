# web-access `cdp-proxy.mjs` uuid 握手修复补丁

> 来源说明：本文件由原 `noname-ai-browser-control` 仓库合并而来（2026-09-04 仓库整理），作为 NNM8 浏览器控制方案的独有坑点补丁集中保留。
> 适用：WorkBuddy 内置 `web-access` skill 的 `scripts/cdp-proxy.mjs`
> 问题：连带调试端口的 Chrome 时，代理日志报 `non-101 status code`，`connected:false`
> 根因：fallback 分支直接拼 `ws://127.0.0.1:<port>/devtools/browser`（**不带 uuid**）。现代 Chrome 只认 `/json/version` 返回的 `webSocketDebuggerUrl`（带 uuid），裸端点只回 `200` 不回 `101`，Node 原生 WebSocket 握手失败。
> 许可：本补丁仅描述修改点；`cdp-proxy.mjs` 属 WorkBuddy 内置 skill，请在你本机对应目录内修改。

---

## 修改位置

函数 `discoverChromePort()` 内、调用 `findFallbackPort()` 之后，原本直接 `return { port: fallbackPort, wsPath: null }`。
改为先取 `webSocketDebuggerUrl` 抽出带 uuid 的 `wsPath` 再返回。

## 修改前（问题代码）

```js
const fallbackPort = await findFallbackPort();
if (fallbackPort !== null) {
  connectedBrowser = { id: 'unknown', label: '未知（通过手动调试端口连接）', source: 'fallback' };
  console.log(`[CDP Proxy] 通过手动调试端口连接: ${fallbackPort}`);
  return { port: fallbackPort, wsPath: null };
}
return null;
```

## 修改后（修复代码）

```js
const fallbackPort = await findFallbackPort();
if (fallbackPort !== null) {
  let wsPath = null;
  try {
    const ver = await fetch(`http://127.0.0.1:${fallbackPort}/json/version`).then(r => r.json());
    if (ver.webSocketDebuggerUrl) {
      // 抽出带 uuid 的路径，例如 /devtools/browser/<uuid>
      wsPath = ver.webSocketDebuggerUrl.replace(`ws://127.0.0.1:${fallbackPort}`, '');
    }
  } catch {
    // 取不到就退化为无 wsPath（极少情况）
  }
  connectedBrowser = { id: 'unknown', label: '未知（通过手动调试端口连接）', source: 'fallback' };
  console.log(`[CDP Proxy] 通过手动调试端口连接: ${fallbackPort}${wsPath ? ' (wsPath=' + wsPath + ')' : ''}`);
  return { port: fallbackPort, wsPath };
}
return null;
```

## 验证

```bash
# 重启代理后
curl --noproxy '*' http://127.0.0.1:3456/health
# 期望：{"status":"ok","connected":true,"chromePort":9222}
```

修复后代理即可 `connected:true` 连上带调试端口的 Chrome（实测 9222 / 9333 均通）。

---

##  upstream 回流建议

该 bug 在「用户 Chrome 已带 `--remote-debugging-port` 但代理靠 fallback 兜底」的场景下必现。
建议反馈给 web-access skill 维护方，将 `wsPath` 解析逻辑并入 `selectBrowser` / `discoverChromePort`，避免他人重复踩 `non-101` 坑。
