import fs from 'node:fs';

import lark from '@larksuiteoapi/node-sdk';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const pick = (k) =>
  env
    .match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]
    ?.trim()
    .replaceAll(/^['"]|['"]$/g, '') ?? '';
const appId = pick('AUTH_FEISHU_APP_ID');
const appSecret = pick('AUTH_FEISHU_APP_SECRET');
console.log('[diag] appId =', appId);

const dispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    let text = data?.message?.content;
    try {
      text = JSON.parse(data.message.content)?.text ?? text;
    } catch {}
    console.log('\n========== ✅ RECEIVE_V1 ==========');
    console.log('chat_type:', data?.message?.chat_type, '| msg_type:', data?.message?.message_type);
    console.log('text     :', text);
    console.log('sender open_id:', data?.sender?.sender_id?.open_id);
    console.log('===================================\n');
  },
  'im.message.message_read_v1': async (data) => {
    console.log('\n--- 📖 MESSAGE_READ_V1 ---');
    console.log('reader open_id:', data?.reader?.reader_id?.open_id);
    console.log('message_ids   :', data?.message_id_list);
    console.log('--------------------------\n');
  },
});

const client = new lark.WSClient({
  appId,
  appSecret,
  domain: lark.Domain.Feishu,
  loggerLevel: lark.LoggerLevel.info,
});
client.start({ eventDispatcher: dispatcher });
console.log('[diag] WS started. 现在发一条私聊消息给 bot。Ctrl+C 退出。');
