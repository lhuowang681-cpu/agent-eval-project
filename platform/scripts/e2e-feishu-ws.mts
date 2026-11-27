/**
 * Standalone e2e harness for the migrated Feishu WebSocket long-connection.
 * Exercises the REAL migrated class `FeishuWSConnection` (no DB/Redis needed):
 *  1. starts a local HTTP server acting as the downstream webhook endpoint
 *  2. starts the migrated WS long-connection with real credentials
 *  3. when you DM the bot, the migrated code forwards the event here → we print it
 *
 * Run: DEBUG=bot-platform:* bun scripts/e2e-feishu-ws.mts
 */
import http from 'node:http';
import fs from 'node:fs';

import { FeishuWSConnection } from '../src/server/services/bot/platforms/feishu/gateway.ts';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const pick = (k: string) =>
  env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';

const appId = pick('AUTH_FEISHU_APP_ID');
const appSecret = pick('AUTH_FEISHU_APP_SECRET');

if (!appId || !appSecret) {
  console.error('Missing AUTH_FEISHU_APP_ID / AUTH_FEISHU_APP_SECRET in .env');
  process.exit(1);
}

const PORT = 39871;
let received = 0;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    received++;
    try {
      const payload = JSON.parse(body);
      const ev = payload.event ?? {};
      const msg = ev.message ?? {};
      const sender = ev.sender ?? {};
      let text = msg.content;
      try {
        text = JSON.parse(msg.content)?.text ?? msg.content;
      } catch {}
      console.log('\n========== ✅ EVENT FORWARDED BY MIGRATED CODE ==========');
      console.log('event_type :', payload.header?.event_type);
      console.log('chat_type  :', msg.chat_type);
      console.log('msg_type   :', msg.message_type);
      console.log('text       :', text);
      console.log('sender open_id (=YOUR MY_FEISHU_OPEN_ID):', sender.sender_id?.open_id);
      console.log('========================================================\n');
    } catch {
      console.log('forwarded (non-JSON) body:', body.slice(0, 200));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"code":0}');
  });
});

server.listen(PORT, () => {
  console.log(`[harness] local webhook listener on http://localhost:${PORT}`);
});

const conn = new FeishuWSConnection({
  appId,
  appSecret,
  domain: 'feishu',
  webhookUrl: `http://localhost:${PORT}/api/agent/webhooks/feishu/${appId}`,
});

console.log('[harness] starting migrated FeishuWSConnection (domain=feishu, appId=%s…)', appId.slice(0, 8));

conn
  .start()
  .then(() => {
    console.log('\n[harness] ✅ WS long-connection started. Now DM the bot "智行公共前端" in Feishu.');
    console.log('[harness] Waiting for incoming messages… (Ctrl+C to stop)\n');
  })
  .catch((err) => {
    console.error('\n[harness] ❌ WS start FAILED:', err?.message || err);
    console.error('[harness] Likely cause: the Feishu app event subscription is NOT set to 长连接 mode,');
    console.error('[harness] or im.message.receive_v1 is not subscribed. Check open.feishu.cn → 事件与回调.');
    process.exit(1);
  });

process.on('SIGINT', () => {
  console.log(`\n[harness] stopping. total forwarded events: ${received}`);
  conn.close();
  server.close();
  process.exit(0);
});
