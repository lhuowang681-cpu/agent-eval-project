#!/usr/bin/env tsx
/**
 * F13.4 —— Agent Gateway 客户端契约（对本地模拟器）。
 *
 * ⚠️ **先读这段边界，否则会误读结论。**
 *
 * 模拟器（`scripts/local/agentGatewayEmulator.mjs`）是照**我们自己客户端**
 * （`packages/agent-gateway-client`）的协议理解实现的。因此本组用例能证明的是：
 *
 *   ✅ 客户端的鉴权握手、事件分发、状态机流转、失败分支处理是**自洽**的；
 *   ❌ **不能**证明我们的理解与真实 Agent Gateway 一致。
 *
 * 真实网关若在字段名、时序或鉴权语义上与此不同，这里全绿也发现不了。
 * 所以结论只写「客户端契约自洽」，**不写**「已验证网关对接」——
 * 这与 QStash 模拟器是同一类局限。
 *
 * 前置：node scripts/local/agentGatewayEmulator.mjs --port 8790
 * Usage: bun x tsx tools/api-test/f13-gateway.ts
 */
import { AgentStreamClient } from '../../packages/agent-gateway-client/src/index';
import { check, summary } from './client';

const GATEWAY = process.env.GATEWAY_EMU_URL ?? 'ws://127.0.0.1:8790';
const TOKEN = 'local-gateway-token';

/** 跑一次会话，收集观测结果 */
const runSession = (
  operationId: string,
  { scenario, token = TOKEN, timeoutMs = 10_000 }: { scenario?: string; token?: string; timeoutMs?: number } = {},
) =>
  new Promise<{
    events: string[];
    statuses: string[];
    authFailed?: string;
    authExpired: boolean;
    completed: boolean;
    client: AgentStreamClient;
  }>((resolve) => {
    /*
     * scenario 不能拼在 gatewayUrl 后面：`buildWsUrl` 是 `${base}/ws?operationId=...`，
     * base 自带查询串会拼出 `ws://host?scenario=x/ws?operationId=y` 这种畸形 URL，
     * 连接直接失败（实测踩过）。改为塞进 operationId —— 模拟器按前缀识别。
     */
    const url = GATEWAY;
    if (scenario) operationId = `${operationId}__scenario_${scenario}`;
    const client = new AgentStreamClient({
      autoReconnect: false,
      gatewayUrl: url,
      operationId,
      token,
    });

    const out = {
      authExpired: false,
      authFailed: undefined as string | undefined,
      client,
      completed: false,
      events: [] as string[],
      statuses: [] as string[],
    };

    const finish = () => {
      clearTimeout(timer);
      client.disconnect();
      resolve(out);
    };

    const timer = setTimeout(finish, timeoutMs);

    client.on('status_changed', (s: any) => out.statuses.push(String(s)));
    client.on('agent_event', (e: any) => {
      out.events.push(e?.type);
      if (e?.type === 'agent_runtime_end') setTimeout(finish, 300);
    });
    client.on('auth_failed', (reason: any) => {
      out.authFailed = String(reason);
      setTimeout(finish, 100);
    });
    client.on('auth_expired', () => {
      out.authExpired = true;
      setTimeout(finish, 100);
    });
    client.on('session_complete', () => {
      out.completed = true;
      setTimeout(finish, 200);
    });

    client.connect();
  });

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F13.4 · Agent Gateway 客户端契约（本地模拟器）');
  console.info('═'.repeat(64));

  // 模拟器探活 —— 没起就直接说清楚，不要跑出一堆看不懂的超时
  const healthUrl = GATEWAY.replace(/^ws/, 'http') + '/health';
  const alive = await fetch(healthUrl)
    .then((r) => r.ok)
    .catch(() => false);
  if (!alive) {
    console.error(
      `\n❌ 模拟器未就绪（${healthUrl}）\n   先跑：node scripts/local/agentGatewayEmulator.mjs --port 8790\n`,
    );
    process.exit(1);
  }

  console.info('\n▶ F13.4.1 正常会话');
  const ok = await runSession('op_gw_ok');
  check('鉴权握手通过并进入 connected', ok.statuses.includes('connected'), ok.statuses.join(' → '));
  check(
    '收到完整事件序列（init → stream → end）',
    ok.events.includes('agent_runtime_init') &&
      ok.events.includes('stream_chunk') &&
      ok.events.includes('agent_runtime_end'),
    `${ok.events.length} 个：${ok.events.join(', ')}`,
  );
  check(
    '事件顺序正确（init 在 chunk 前，end 在最后）',
    ok.events.indexOf('agent_runtime_init') < ok.events.indexOf('stream_chunk') &&
      ok.events.at(-1) === 'agent_runtime_end',
    `first=${ok.events[0]} last=${ok.events.at(-1)}`,
  );

  console.info('\n▶ F13.4.2 鉴权失败分支');
  const bad = await runSession('op_gw_bad', { timeoutMs: 6000, token: 'wrong-token' });
  check('错误 token 触发 authFailed（而非静默连上）', !!bad.authFailed, bad.authFailed ?? '(未触发)');
  check('鉴权失败后不进入 connected', !bad.statuses.includes('connected'), bad.statuses.join(' → '));
  check('鉴权失败时不投递任何事件', bad.events.length === 0, `${bad.events.length} 个`);

  console.info('\n▶ F13.4.3 令牌过期分支');
  const exp = await runSession('op_gw_exp', { scenario: 'auth_expired', timeoutMs: 6000 });
  check('服务端 auth_expired 被客户端识别', exp.authExpired, String(exp.authExpired));

  console.info('\n▶ F13.4.4 会话结束的两条路径');

  /*
   * 路径一：终态事件即结束。客户端收到 `agent_runtime_end` 会**自行断开**
   * （client.ts:302-304），因此服务端随后发的 session_complete 根本到不了 ——
   * 这是产品的正确行为，不是缺陷。最初我按"两者都该收到"写断言，是我的期望错了。
   */
  check(
    '终态事件后客户端自行断开（不再等待 session_complete）',
    ok.statuses.at(-1) === 'disconnected' && ok.events.at(-1) === 'agent_runtime_end',
    `last status=${ok.statuses.at(-1)} last event=${ok.events.at(-1)}`,
  );

  /*
   * 路径二：服务端直接宣告会话结束、不带任何 agent 事件 ——
   * 对应「重连到一个早已跑完的 operation」。这条才验得到 session_complete 本身。
   */
  const done = await runSession('op_gw_done', { scenario: 'complete_only', timeoutMs: 6000 });
  check('无事件时收到 session_complete', done.completed, String(done.completed));
  check('session_complete 后进入 disconnected', done.statuses.includes('disconnected'), done.statuses.join(' → '));

  console.info(
    '\n    ⚠️ 边界：本组验证的是**客户端契约自洽**（握手/分发/状态机/失败分支），' +
      '\n    不构成「已验证与真实 Agent Gateway 对接」—— 模拟器按我方协议理解实现，' +
      '\n    真实网关若字段或时序不同，此处全绿也发现不了。同 QStash 模拟器的局限。',
  );

  const ok2 = summary();
  process.exit(ok2 ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 f13-gateway 异常:', e);
  process.exit(1);
});
