#!/usr/bin/env tsx
/**
 * Offline smoke test — PLAN.md phase 4 checkpoints 5-10.
 *
 * Drives one full agent run end to end against the local mocks:
 *   health → auth → agent + topic → createOperation → SSE → agent_runtime_end
 * then repeats it with a scenario that forces a tool call.
 *
 * Prerequisites (all local, no network):
 *   bun run tsx scripts/local/pgliteServer.ts      # :5432
 *   bun run tsx tools/mock-llm/server.ts           # :8088
 *   bun run tsx tools/mock-services/server.ts      # :8089
 *   bun run dev:next                               # :3010
 *
 * Usage:  bun run tsx tools/api-test/smoke.ts
 */
import { check, collectStream, rest, setScenario, summary, trpcMutate, trpcQuery } from './client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const typesOf = (events: { type: string }[]) => [...new Set(events.map((e) => e.type))];

const runAgentOnce = async (label: string, scenario: string) => {
  console.info(`\n▶ ${label}（场景 ${scenario}）`);

  await setScenario(scenario, { firstTokenDelayMs: 0, tokensPerSecond: 0 });

  // A builtin agent gives us a valid agentId without inventing config.
  // NOTE: getBuiltinAgent is a *query*, createTopic/sendMessageInServer/createOperation are mutations.
  const agent = await trpcQuery<{ id: string }>('agent.getBuiltinAgent', { slug: 'inbox' });
  check('取得 inbox 内置 agent', !!agent?.id, agent?.id);

  const topicId = await trpcMutate<string>('topic.createTopic', {
    agentId: agent.id,
    title: `smoke ${label} ${Date.now()}`,
  });
  check('创建 topic', !!topicId, String(topicId));

  const sent = await trpcMutate<any>('aiChat.sendMessageInServer', {
    agentId: agent.id,
    newAssistantMessage: { model: 'mock-model', provider: 'openai' },
    newUserMessage: { content: `smoke test: ${label}` },
    topicId,
  });
  check(
    '落库 user + assistant 消息',
    !!sent?.userMessageId && !!sent?.assistantMessageId,
    `user=${sent?.userMessageId} assistant=${sent?.assistantMessageId}`,
  );

  const op = await trpcMutate<any>('aiAgent.createOperation', {
    agentId: agent.id,
    autoStart: true,
    messages: sent?.messages ?? [],
    modelRuntimeConfig: { model: 'mock-model', provider: 'openai' },
    // 声明 calculator（single-tool / infinite-tools 场景调的就是它）。
    //
    // 必须声明：manifest 缺失现在会被 fail-closed 拦成待审批（附录 C-1 的修复）。
    // 这不是为了绕开检查 —— 真实调用方本来就会把工具连同 manifest 一起传，
    // 模型也只能调用请求里声明过的工具。此前 smoke 不传却仍能执行，
    // 恰恰就是被修掉的那个漏洞。
    toolManifestMap: {
      'lobe-calculator': {
        api: [{ description: 'Evaluate an expression.', name: 'calculate', parameters: {} }],
        identifier: 'lobe-calculator',
        meta: { title: 'Calculator' },
        type: 'builtin',
      },
    },
    topicId,
  });

  check('createOperation 成功', op?.success === true, op?.status);
  check(
    'operationId 形如 agt_{ts}_{agentId}_{topicId}_{nanoid}',
    /^agt_\d+_.+_.+_.{8}$/.test(op?.operationId ?? ''),
    op?.operationId,
  );
  check('首步已调度', op?.firstStep?.scheduled === true);

  // The first step is scheduled with a small setTimeout delay; subscribe right away
  // and rely on includeHistory to backfill anything already emitted.
  const { events, endedCleanly, elapsedMs } = await collectStream(op.operationId, {
    timeoutMs: 90_000,
  });

  console.info(`    收到 ${events.length} 个事件，用时 ${elapsedMs}ms`);
  console.info(`    事件类型: ${typesOf(events).join(', ')}`);

  check('SSE 收到事件', events.length > 0, `${events.length} 个`);
  check('收到 agent_runtime_end 并干净关闭', endedCleanly);

  const status = await trpcQuery<any>('aiAgent.getOperationStatus', {
    includeHistory: true,
    operationId: op.operationId,
  });

  console.info(
    `    最终状态: ${status?.currentState?.status}，步数 ${status?.currentState?.stepCount}，` +
      `tokens ${status?.currentState?.usage?.llm?.tokens?.total ?? 0}`,
  );

  return { events, op, status };
};

const main = async () => {
  console.info('═'.repeat(60));
  console.info('离线冒烟测试 — PLAN.md 阶段 4 检查点 5-10');
  console.info('═'.repeat(60));

  // ---- 检查点 5-8 ----------------------------------------------------------
  console.info('\n▶ 基础健康与鉴权');

  const health = await rest('/api/v1/health');
  check('检查点5 /api/v1/health', health.status === 200 && health.body?.status === 'ok');

  const agentHealth = await rest('/api/agent/run');
  check('检查点6 /api/agent/run', agentHealth.status === 200 && agentHealth.body?.healthy === true);

  const hc = await trpcQuery<string>('healthcheck');
  check('检查点7 tRPC lambda.healthcheck', hc === "i'm live!", String(hc));

  const me = await rest('/api/v1/users/me');
  check(
    '检查点8 dev 旁路 /api/v1/users/me',
    me.status === 200 && me.body?.data?.id === process.env.MOCK_DEV_USER_ID,
    me.body?.data?.id,
  );

  const noAuth = await fetch(`${process.env.TEST_BASE_URL ?? 'http://localhost:3010'}/api/v1/users/me`);
  check(
    '无凭证被拒（注意：实现返回 500 而非 401，见附录 A.4）',
    noAuth.status === 401 || noAuth.status === 500,
    `HTTP ${noAuth.status}`,
  );

  // ---- 检查点 9：纯文本闭环 ------------------------------------------------
  const plain = await runAgentOnce('检查点9 纯文本闭环', 'simple');
  const plainTypes = typesOf(plain.events);

  // NOTE: the SSE vocabulary differs from the internal AgentEvent union.
  // Over the wire you get: connected, agent_runtime_init, step_start, stream_start,
  // stream_chunk, stream_end, step_complete, tool_start, tool_end, agent_runtime_end
  // — not the `llm_stream` / `tool_result` names used inside packages/agent-runtime.
  check('检查点9 收到 stream_chunk（流式正文）', plainTypes.includes('stream_chunk'));
  check('检查点9 事件序列完整', ['agent_runtime_init', 'step_start', 'step_complete', 'agent_runtime_end'].every((t) => plainTypes.includes(t)));
  check('检查点9 operation 到达终态', ['done', 'error'].includes(plain.status?.currentState?.status));
  check('检查点9 状态为 done（非 error）', plain.status?.currentState?.status === 'done',
    plain.status?.currentState?.error ? JSON.stringify(plain.status.currentState.error).slice(0, 200) : '');

  await sleep(500);

  // ---- 检查点 10：工具闭环 -------------------------------------------------
  const tool = await runAgentOnce('检查点10 工具闭环', 'single-tool');
  const toolTypes = typesOf(tool.events);
  check('检查点10 出现 tool_start / tool_end', toolTypes.includes('tool_start') && toolTypes.includes('tool_end'), toolTypes.join(','));
  check(
    '检查点10 步数 > 1（工具轮 + 总结轮）',
    (tool.status?.currentState?.stepCount ?? 0) > 1,
    `stepCount=${tool.status?.currentState?.stepCount}`,
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((error) => {
  console.error('\n💥 冒烟测试异常终止:', error);
  process.exit(1);
});
