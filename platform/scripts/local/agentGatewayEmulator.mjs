#!/usr/bin/env node
/**
 * 本地 Agent Gateway 模拟器。
 *
 * 走的是与 QStash 模拟器同一条路子：把「连不上的外部服务」换成一个**按我们自己的
 * 协议定义**实现的本地实现，从而把业务成功路径从「离线不可达」变成可跑。
 *
 * 协议来源：`packages/agent-gateway-client/src/{client,types}.ts` —— 那是我们这侧
 * 的客户端实现，线上协议在里面是完整的：
 *   · 连接    `GET {gateway}/ws?operationId=...`（WebSocket 升级）
 *   · 客户端  `{type:'auth', token}` → `{type:'heartbeat'}` / `{type:'interrupt'}`
 *             / `{type:'tool_result', ...}`
 *   · 服务端  auth_success | auth_failed | auth_expired | agent_event
 *             | heartbeat_ack | resume_complete | session_complete
 *
 * ⚠️ **保真度边界（必须先说清楚）**
 * 本模拟器是照**我们客户端的协议理解**写的。它能验证我们这侧的收发、状态机、
 * 重连与错误处理是否自洽；**验证不了我们的理解与真实网关是否一致**。
 * 真实网关若在字段名、时序或鉴权语义上与此不同，这里全绿也发现不了。
 * 因此结论只能写成「客户端契约自洽」，**不能**写成「已验证网关对接」。
 *
 * Usage:
 *   node scripts/local/agentGatewayEmulator.mjs [--port 8790] [--token <expected>]
 *
 * 行为开关（供测试构造分支）：
 *   ?scenario=auth_failed   连上后直接拒绝鉴权
 *   ?scenario=auth_expired  鉴权通过后立刻发 auth_expired
 *   ?scenario=silent        鉴权通过后不发任何事件（验客户端心跳/超时）
 *   默认                     鉴权通过 → 推一串事件 → session_complete
 */
import { createServer } from 'node:http';
import process from 'node:process';

import { WebSocketServer } from 'ws';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};

const PORT = Number(argOf('--port', 8790));
const EXPECTED_TOKEN = argOf('--token', 'local-gateway-token');

/** 与真实运行大致同形的一串事件；类型取自 AgentStreamEventType */
const scriptedEvents = (operationId) => [
  { data: {}, operationId, stepIndex: 0, type: 'agent_runtime_init' },
  { data: {}, operationId, stepIndex: 0, type: 'step_start' },
  { data: {}, operationId, stepIndex: 0, type: 'stream_start' },
  { data: { chunkType: 'text', content: '来自' }, operationId, stepIndex: 0, type: 'stream_chunk' },
  {
    data: { chunkType: 'text', content: '本地网关模拟器' },
    operationId,
    stepIndex: 0,
    type: 'stream_chunk',
  },
  { data: {}, operationId, stepIndex: 0, type: 'stream_end' },
  { data: {}, operationId, stepIndex: 0, type: 'step_complete' },
  { data: {}, operationId, stepIndex: 0, type: 'agent_runtime_end' },
];

const httpServer = createServer((req, res) => {
  // 供测试探活
  if (req.url?.startsWith('/health')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, url);
  });
});

wss.on('connection', (ws, req, url) => {
  const operationId = url.searchParams.get('operationId') ?? '';
  /*
   * 场景开关从 **operationId 后缀**读，而不是独立的查询参数。
   *
   * 因为客户端的 `buildWsUrl` 是 `${gatewayUrl}/ws?operationId=...` —— 调用方没有
   * 往 URL 上加参数的口子，硬塞会拼出 `ws://host?scenario=x/ws?operationId=y`
   * 这种畸形地址。用后缀是唯一不改产品代码就能传参的通道。
   */
  const scenarioMatch = operationId.match(/__scenario_([a-z_]+)$/);
  const scenario = scenarioMatch?.[1] ?? url.searchParams.get('scenario') ?? 'default';
  let authed = false;

  console.info(`[gateway-emu] 连接 operationId=${operationId} scenario=${scenario}`);

  const send = (msg) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // 心跳：任何时候都应答
    if (msg.type === 'heartbeat') {
      send({ type: 'heartbeat_ack' });
      return;
    }

    if (msg.type === 'auth') {
      if (scenario === 'auth_failed' || msg.token !== EXPECTED_TOKEN) {
        console.info('[gateway-emu] 鉴权拒绝');
        send({ reason: 'invalid token', type: 'auth_failed' });
        return;
      }

      authed = true;
      send({ type: 'auth_success' });
      console.info('[gateway-emu] 鉴权通过');

      if (scenario === 'auth_expired') {
        setTimeout(() => send({ type: 'auth_expired' }), 50);
        return;
      }
      if (scenario === 'silent') return;
      // 鉴权后直接宣告会话已结束，不发任何 agent 事件 ——
      // 对应「重连到一个早已跑完的 operation」这条真实路径。
      // 必须与正常流程分开测：正常流程里客户端收到 agent_runtime_end 就自行断开，
      // 后续的 session_complete 根本到不了（那是产品的正确行为，不是缺陷）。
      if (scenario === 'complete_only') {
        setTimeout(() => send({ type: 'session_complete' }), 50);
        return;
      }

      // 逐条推事件，最后 session_complete
      let i = 0;
      const events = scriptedEvents(operationId);
      const timer = setInterval(() => {
        if (ws.readyState !== ws.OPEN || i >= events.length) {
          clearInterval(timer);
          if (ws.readyState === ws.OPEN) send({ type: 'session_complete' });
          return;
        }
        send({ event: events[i], id: String(i + 1), type: 'agent_event' });
        i += 1;
      }, 60);
      return;
    }

    if (!authed) return;

    // 客户端 → 服务端的两类控制消息：回显到日志，供测试断言"确实送达"
    if (msg.type === 'interrupt') {
      console.info('[gateway-emu] 收到 interrupt');
      send({ type: 'session_complete' });
      return;
    }
    if (msg.type === 'tool_result') {
      console.info(`[gateway-emu] 收到 tool_result toolCallId=${msg.toolCallId}`);
    }
  });

  ws.on('close', () => console.info('[gateway-emu] 断开'));
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.info(`[gateway-emu] ws://127.0.0.1:${PORT}/ws  （token=${EXPECTED_TOKEN}）`);
});
