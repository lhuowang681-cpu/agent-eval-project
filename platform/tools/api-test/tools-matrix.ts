#!/usr/bin/env tsx
/**
 * L3 contract test — F4 tool invocation & routing, plus spot checks on F5 builtin tools.
 *
 * Covers F4.1, F4.2, F4.7 (indirectly), F4.8, F4.10 and the F5 packages reachable
 * without external services. Tools that need real infrastructure (cloud-sandbox,
 * local-system on desktop, remote-device, feishu) are recorded as out of scope.
 *
 * Usage:  bun run tsx tools/api-test/tools-matrix.ts
 */
import { check, setScenario, summary, trpcQuery } from './client';
import { createOperation, getStatus, isTerminal, prepareConversation, waitForStatus } from './helpers';

const runTurn = async (scenario: string, title: string) => {
  await setScenario(scenario, { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation(title);
  const op = await createOperation(ctx);
  const status = await waitForStatus(op.operationId, isTerminal, { timeoutMs: 60_000 });
  return { ctx, op, status };
};

/** Pull the tool messages the run produced, so we can assert on real results. */
const toolMessages = async (topicId: string, agentId: string) => {
  const msgs = await trpcQuery<any[]>('message.getMessages', { agentId, topicId });
  return (msgs ?? []).filter((m) => m.role === 'tool');
};

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F4 · 工具调用与路由（含 F5 抽查）');
  console.info('═'.repeat(64));

  // ── F4.1 单工具 → 回灌 ────────────────────────────────────────────────────
  console.info('\n▶ F4.1 单工具调用与结果回灌');
  const single = await runTurn('single-tool', 'F4.1 single tool');
  const s1 = single.status?.currentState ?? {};
  console.info(`    状态 ${s1.status}，步数 ${s1.stepCount}，tokens ${s1.usage?.llm?.tokens?.total ?? 0}`);
  check('F4.1 到达终态 done', s1.status === 'done', s1.status);
  check('F4.1 步数 = 3（LLM → 工具 → LLM）', s1.stepCount === 3, `stepCount=${s1.stepCount}`);
  check('F4.1 发生了 2 次 LLM 调用', (s1.usage?.llm?.apiCalls ?? 0) === 2, `apiCalls=${s1.usage?.llm?.apiCalls}`);
  check('F4.1 记录了 1 次工具调用', (s1.usage?.tools?.totalCalls ?? 0) === 1, `toolCalls=${s1.usage?.tools?.totalCalls}`);

  const tm1 = await toolMessages(single.ctx.topicId, single.ctx.agentId);
  check('F4.1 落库了 tool 角色消息', tm1.length >= 1, `${tm1.length} 条`);
  if (tm1[0]) {
    console.info(`    工具消息: ${tm1[0].plugin?.identifier}/${tm1[0].plugin?.apiName} → ${String(tm1[0].content).slice(0, 60)}`);
    check('F4.1 工具消息带 plugin 元信息', !!tm1[0].plugin?.identifier, tm1[0].plugin?.identifier);
  }

  // ── F4.2 批量并行 ─────────────────────────────────────────────────────────
  console.info('\n▶ F4.2 批量并行工具');
  const par = await runTurn('parallel-tools', 'F4.2 parallel tools');
  const s2 = par.status?.currentState ?? {};
  console.info(`    状态 ${s2.status}，步数 ${s2.stepCount}，工具调用 ${s2.usage?.tools?.totalCalls ?? 0} 次`);
  check('F4.2 到达终态 done', s2.status === 'done', s2.status);
  check('F4.2 三个工具都被调用', (s2.usage?.tools?.totalCalls ?? 0) === 3, `toolCalls=${s2.usage?.tools?.totalCalls}`);
  check(
    'F4.2 并行执行（步数与单工具相同，未串成多步）',
    s2.stepCount === 3,
    `stepCount=${s2.stepCount}（3 = 一批并行；>3 说明被串行拆步）`,
  );

  const tm2 = await toolMessages(par.ctx.topicId, par.ctx.agentId);
  check('F4.2 三条工具消息均落库', tm2.length === 3, `${tm2.length} 条`);

  // ── F4.10 alwaysOn 工具 ───────────────────────────────────────────────────
  console.info('\n▶ F4.10 alwaysOn 工具恒可用');
  check(
    'F4.10 未传 tools 时 builtin 仍可执行',
    (s1.usage?.tools?.totalCalls ?? 0) > 0,
    'createOperation 未传 tools/toolManifestMap，calculator 仍被成功调用 —— ' +
      '印证附录 C：工具执行不依赖 manifest',
  );

  // ── F4.8 工具执行失败的回灌 ───────────────────────────────────────────────
  console.info('\n▶ F4.8 不存在的工具 → 错误回灌而非中断');
  await setScenario('bad-tool', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctxBad = await prepareConversation('F4.8 bad tool');
  const opBad = await createOperation(ctxBad);
  const sBad = await waitForStatus(opBad.operationId, isTerminal, { timeoutMs: 60_000 });
  const csBad = sBad?.currentState ?? {};
  console.info(`    状态 ${csBad.status}，步数 ${csBad.stepCount}`);
  check(
    'F4.8 未知工具不会让 operation 崩成 error',
    csBad.status === 'done',
    `status=${csBad.status}${csBad.error ? ' err=' + JSON.stringify(csBad.error).slice(0, 120) : ''}`,
  );

  const tmBad = await toolMessages(ctxBad.topicId, ctxBad.agentId);
  check('F4.8 失败结果作为 tool 消息回灌', tmBad.length >= 1, `${tmBad.length} 条`);
  if (tmBad[0]) {
    console.info(`    回灌内容: ${String(tmBad[0].content).slice(0, 100)}`);
  }

  // ── F10.3 usage 归一化 ────────────────────────────────────────────────────
  console.info('\n▶ F10.3 usage 明细归一化');
  const rich = await runTurn('usage-rich', 'F10.3 usage');
  const u = rich.status?.currentState?.usage ?? {};
  console.info(`    tokens: in=${u.llm?.tokens?.input} out=${u.llm?.tokens?.output} total=${u.llm?.tokens?.total}`);
  check('F10.3 input tokens 已累计', (u.llm?.tokens?.input ?? 0) > 0, String(u.llm?.tokens?.input));
  check('F10.3 output tokens 已累计', (u.llm?.tokens?.output ?? 0) > 0, String(u.llm?.tokens?.output));
  check(
    'F10.3 total = input + output',
    (u.llm?.tokens?.total ?? 0) === (u.llm?.tokens?.input ?? 0) + (u.llm?.tokens?.output ?? 0),
    `${u.llm?.tokens?.input} + ${u.llm?.tokens?.output} = ${u.llm?.tokens?.total}`,
  );

  // ── F5 覆盖边界 ───────────────────────────────────────────────────────────
  console.info('\n▶ F5 内置工具包覆盖边界');
  check('F5.21 calculator 实测可用', (s1.usage?.tools?.totalCalls ?? 0) > 0);
  check(
    'F5 其余包未在本脚本覆盖',
    true,
    'web-browsing/knowledge-base/memory 需 mock 外部服务；cloud-sandbox/local-system/remote-device 需真实环境；' +
      'task/notebook/agent-documents 需专门的 agent 配置 —— 见报告「未覆盖」一节',
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 tools-matrix 异常:', e);
  process.exit(1);
});
