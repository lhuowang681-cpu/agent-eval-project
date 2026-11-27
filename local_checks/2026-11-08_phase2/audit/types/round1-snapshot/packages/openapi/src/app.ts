import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

// Import user authentication middleware (supports both OIDC and API Key authentication)
import { userAuthMiddleware } from './middleware/auth';
// Import routes
import routes from './routes';

// Create Hono app instance
const app = new Hono().basePath('/api/v1');

// Global middleware
app.use('*', cors());
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', userAuthMiddleware); // User authentication middleware

/*
 * Error handling middleware.
 *
 * 原实现把**所有**错误一律转成 500，包括中间件抛的 `HTTPException` ——
 * 于是无凭证访问 `/api/v1/users/me` 得到的是
 * `500 {"error":"Authentication required"}` 而不是 401。
 *
 * 三个后果：调用方按 5xx 去重试（而重试一万次也不会有凭证）；
 * 错误率监控被鉴权失败污染；真实故障与"没登录"在监控上无法区分。
 *
 * `HTTPException` 自带正确的状态码，直接沿用即可；只有**非预期**的错误才是 500。
 */
app.onError((error: Error, c) => {
  if (error instanceof HTTPException) {
    // 4xx 是调用方问题，不该按服务端故障记；只在 5xx 时打错误日志
    if (error.status >= 500) console.error('Hono Error:', error);
    return c.json({ error: error.message }, error.status);
  }

  console.error('Hono Error:', error);
  return c.json({ error: error.message }, 500);
});

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    service: 'lobe-chat-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Register routes
Object.entries(routes).forEach(([key, value]) => app.route(`/${key}`, value));

export { app as honoApp };
