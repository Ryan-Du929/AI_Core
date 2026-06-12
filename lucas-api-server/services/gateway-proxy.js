// gateway-proxy.js — OpenClaw Gateway 內嵌代理
// 讓 http://localhost:18789/api/* → localhost:3080
// 讓 http://localhost:18789/trading-diary → localhost:3080
// 使用方式: node gateway-proxy.js (放在 OpenClaw 啟動後執行)

const http = require('http');
const httpProxy = require('http-proxy');

const TARGET = 'http://localhost:3080';
const GATEWAY_PORT = 18789;

const proxy = httpProxy.createProxyServer({
  target: TARGET,
  changeOrigin: true,
  ws: false,
});

proxy.on('error', (err, req, res) => {
  console.error('[Proxy] Error:', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502);
    res.end('Bad Gateway');
  }
});

// 不需要獨立 server，直接修改方式：
// 方案：在 gateway 層加一條反向代理規則
// 但 OpenClaw gateway 不支援自訂路由
// 
// 替代方案：開一個獨立的 proxy server 在 3082
// 但你要連 localhost:3082 而不是 18789
//
// 最佳方案：用 OpenClaw 的 plugin 機制，但 plugin 系統也不支援 proxy
//
// 最終方案：我直接改寫 trading-diary/index.html 的 API_BASE
// 讓前端透過 OpenClaw gateway 的 WebSocket proxy 轉發？

console.log('=== 方案評估 ===');
console.log('OpenClaw gateway (18789) 不支援自訂 reverse proxy');
console.log('');
console.log('可用方案：');
console.log('1. 開 proxy port 3082 → 你連 localhost:3082');
console.log('2. 在 docker-compose 加 port mapping (最乾淨)');
console.log('3. 用 npx serve 把靜態頁另開一個 port');

// 方案 1：開 proxy
const PROXY_PORT = 3082;
const proxyServer = http.createServer((req, res) => {
  // 只代理 /api/* 和 / (靜態檔)
  proxy.web(req, res, { target: TARGET });
});

proxyServer.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`\n✅ Proxy running: http://localhost:${PROXY_PORT} → ${TARGET}`);
  console.log(`   Open in browser: http://localhost:${PROXY_PORT}`);
});