#!/usr/bin/env node
/**
 * 用生产构建产物起移动端静态服务 —— 复测 PLAN.md §14 的结论.
 *
 * §14 是在 `bun run dev:spa:mobile` 下观测到的：会话列表里唯一入口是
 * `href="/agent/undefined"`，点进去页面没有输入框。但旧主机已记录 dev 模式本身是个
 * 不一致的混合态（`MOBILE=true` 只作用于 build input 与 define，dev server 仍从根目录
 * 服务桌面版 index.html），所以那条结论不能直接推广到生产构建。
 *
 * 这个服务器只做两件事：
 *   1. 把 `dist/mobile/` 当静态根，SPA fallback 到 index.mobile.html
 *      （生产部署也是这么干的 —— 没有 dev server 的路径歧义）
 *   2. 把 /api、/trpc、/webapi 代理到 :3010，让前端能真正连上后端
 *
 * Usage:  node scripts/local/serveMobileDist.mjs [--port 3013]
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIST = join(ROOT, 'dist', 'mobile');
const argv = process.argv.slice(2);
const portIdx = argv.indexOf('--port');
const PORT = Number(portIdx > -1 ? argv[portIdx + 1] : 3013);
const API_TARGET = { host: '127.0.0.1', port: 3010 };

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

if (!existsSync(DIST)) {
  console.error(`\n❌ 找不到 ${DIST}\n   先跑：bun run build:spa:mobile\n`);
  process.exit(1);
}

/*
 * 是否给转发的 API 请求注入开发态鉴权头。
 *
 * 为什么需要：生产构建下浏览器**没有会话**，SPA 拿不到已登录用户就会跳 `/signin`，
 * 于是「聊天页有没有输入框」这条观测永远验不了（plan §14 记的正是这个卡点）。
 * 服务端的 dev 旁路只认请求头，浏览器自己发不出这个头 —— 由代理补上即可。
 *
 * ⚠️ 安全：整条链路只监听 127.0.0.1，且必须显式加 `--dev-auth` 才启用。
 * 这个头等同于「无条件放行为 MOCK_DEV_USER_ID」，绝不可用于共享或生产环境。
 */
const DEV_AUTH = argv.includes('--dev-auth');

const proxy = (req, res) => {
  const upstream = httpRequest(
    {
      headers: {
        ...req.headers,
        host: `${API_TARGET.host}:${API_TARGET.port}`,
        ...(DEV_AUTH ? { 'lobe-auth-dev-backend-api': '1' } : {}),
      },
      host: API_TARGET.host,
      method: req.method,
      path: req.url,
      port: API_TARGET.port,
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`proxy error: ${e.message}`);
  });
  req.pipe(upstream);
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (/^\/(api|trpc|webapi|oidc)\b/.test(url.pathname)) return proxy(req, res);

  // 构建产物里的资源引用带 `/spa/` 前缀（`src="/spa/assets/index.mobile-*.js"`），
  // 那是 build:spa:copy 之后的部署布局；而 dist/mobile 下资源就在 assets/ vendor/ i18n/。
  // 不做这层映射的话，所有 JS 请求会落到 SPA fallback 拿到 HTML，
  // 浏览器报 "Expected a JavaScript-or-Wasm module script but the server responded with
  // a MIME type of text/html"，页面全白。
  const pathname = url.pathname.replace(/^\/spa\//, '/');

  const rel = normalize(pathname).replace(/^([/\\])+/, '');
  const file = join(DIST, rel);
  if (rel && file.startsWith(DIST) && existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    return createReadStream(file).pipe(res);
  }

  // SPA fallback → 移动端入口。生产部署就是这个形态：
  // 任何路由都返回 index.mobile.html，由客户端路由接管。
  const entry = join(DIST, 'index.mobile.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  createReadStream(entry).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.info(`[mobile-dist] http://127.0.0.1:${PORT}  (root: ${DIST})`);
  console.info(`[mobile-dist] /api /trpc /webapi → 127.0.0.1:${API_TARGET.port}`);
  console.info('[mobile-dist] 所有非静态路径 fallback 到 index.mobile.html');
});
