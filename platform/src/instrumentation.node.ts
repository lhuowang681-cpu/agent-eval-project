import { bootstrap, serverHook } from '@ctrip/vampire-core';
import { register } from '@lobechat/observability-otel/node';

import { version } from '../package.json';

// 必须先激活 hook，才能拦截随后 Next.js 的 http.createServer；
// bootstrap() 内部是 async 且会 fork 一个 IPC worker，若等它完成再挂 hook,
// createServer 已经跑过了，同链路 traceContext 就绑不上。
serverHook.activeHookServer();
console.info('[instrumentation] vampire-core serverHook activated');

// 通过 VAMPIRE_DEBUG=1 打开请求 hook 的可见性，用于在 fat/uat 验证 hook 是否命中每个请求。
// 生产不建议长期打开；listener 返回 undefined，会自动 emitHook() 走到下一个 (即 Cat middleware)，
// 不会短路后续链路。
if (process.env.VAMPIRE_DEBUG === '1') {
  serverHook.on('request', (req) => {
    console.info('[vampire-core] request hook:', req.method, req.url);
  });
}

bootstrap();
console.info('[instrumentation] vampire-core bootstrap() invoked');

console.info('[instrumentation] node.ts loaded');

const shouldEnableTelemetry =
  process.env.ENABLE_TELEMETRY &&
  (process.env.NODE_ENV === 'production' || process.env.ENABLE_TELEMETRY_IN_DEV);

if (shouldEnableTelemetry) {
  register({ version });
}

void import('@/server/bootstrap/registerPlatformQstashSchedules')
  .then(({ registerPlatformQstashSchedules }) => registerPlatformQstashSchedules())
  .catch((err) => {
    console.error('[instrumentation] Failed to register platform QStash schedules:', err);
  });

/*
 * 订阅 API Key 缓存失效广播。
 *
 * 校验结果缓存在各实例进程内，不订阅的话在别的实例上吊销的 key
 * 在本实例最多还能再用满一个 TTL（60s）。
 * 未配置 Redis 时内部静默跳过 —— 单实例部署本就不需要广播。
 */
void import('@/server/services/apiKeyCacheBus')
  .then(({ initApiKeyCacheBus }) => initApiKeyCacheBus())
  .catch((err) => {
    console.error('[instrumentation] Failed to init API key cache bus:', err);
  });
