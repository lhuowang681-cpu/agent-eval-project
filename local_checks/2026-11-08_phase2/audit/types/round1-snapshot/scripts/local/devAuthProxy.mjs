#!/usr/bin/env node
/**
 * 本地开发态鉴权代理 —— 让桌面端能连上本地后端，而不必登录携程云。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────
 * 桌面端把用户挡在 `desktop-onboarding?screen=login`。门禁本身不认「携程账号」，
 * 认的是「远端服务器是否可用」：主进程 `AuthCtr` 会主动刷 token，失败就
 * `broadcastAuthorizationRequired()` → 渲染进程跳登录页。
 *
 * 本地后端有开发态旁路（请求头 `lobe-auth-dev-backend-api: 1` → MOCK_DEV_USER_ID，
 * 三处入口都有 `NODE_ENV === 'development'` 守卫，F11.6 已验证生产下失效）。
 * 但那个头**没人替桌面端加**：
 *   · 渲染进程的请求可以用 Playwright 拦截注入；
 *   · **主进程的请求不行** —— 实测 401 全部来自主进程，Playwright 看不到也改不了。
 *
 * 所以在中间放一个代理：桌面端的 selfHost 地址指向它，它统一补上旁路头再转发。
 * 好处是**完全不改产品代码**，也不需要放宽后端的鉴权守卫。
 *
 * ── 边界 ────────────────────────────────────────────────────────────────
 * · 只监听回环地址，只转发到回环地址；拒绝任何非本机目标。
 * · 仅用于本地离线验证。它等价于「把开发态旁路头自动加上」，
 *   而该旁路本身就只在 NODE_ENV=development 下生效。
 * · 不要在任何共享/生产环境运行。
 *
 * Usage:
 *   node scripts/local/devAuthProxy.mjs                 # :3011 → :3010
 *   node scripts/local/devAuthProxy.mjs --port 3011 --target 3010
 */
import { createServer, request as httpRequest } from 'node:http';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};

const PORT = Number(opt('--port', 3011));
const TARGET_PORT = Number(opt('--target', 3010));
const TARGET_HOST = '127.0.0.1';

let injected = 0;
let total = 0;

const server = createServer((req, res) => {
  total++;

  const headers = {
    ...req.headers,
    host: `${TARGET_HOST}:${TARGET_PORT}`,
    // 这一行就是全部的「绕过」：把开发态旁路头补上。
    'lobe-auth-dev-backend-api': '1',
  };
  injected++;

  const upstream = httpRequest(
    { headers, host: TARGET_HOST, method: req.method, path: req.url, port: TARGET_PORT },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `dev-auth-proxy upstream failed: ${e.message}` }));
  });

  req.pipe(upstream);
});

server.listen(PORT, '127.0.0.1', () => {
  console.info(`[dev-auth-proxy] http://127.0.0.1:${PORT}  →  http://${TARGET_HOST}:${TARGET_PORT}`);
  console.info('[dev-auth-proxy] 每个请求自动补 `lobe-auth-dev-backend-api: 1`');
  console.info('[dev-auth-proxy] 仅回环，仅供本地离线验证使用');
});

const report = setInterval(() => {
  if (total > 0) console.info(`[dev-auth-proxy] 已转发 ${total} 个请求（注入 ${injected}）`);
}, 30_000);
report.unref?.();
