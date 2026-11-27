#!/usr/bin/env tsx
/**
 * Reproduction for the unbounded agent loop — PLAN.md appendix B.
 *
 * Drives the mock LLM's `infinite-tools` scenario (every turn returns tool_calls,
 * never finishes) through a normal createOperation and samples the step count every
 * 5 seconds. Nothing caps it: measured 372 steps / 1,727,382 tokens / 186 LLM calls
 * in 61 seconds, growing linearly, and interruptTask returns success without
 * stopping it.
 *
 * ⚠️ This deliberately burns resources. Against a real provider it would cost real
 * money — keep OPENAI_PROXY_URL pointed at the local mock. The only reliable way to
 * stop the operation today is to kill the dev server.
 *
 * Usage:  bun run tsx tools/api-test/runaway-repro.ts
 */
import { setScenario, trpcMutate } from './client';
import { createOperation, getStatus, prepareConversation } from './helpers';

const main = async () => {
  await setScenario('infinite-tools', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation('runaway probe');
  const op = await createOperation(ctx, true);
  console.info('operationId:', op.operationId);

  const samples: { t: number; steps: number; status: string; cost: number; tokens: number }[] = [];
  const t0 = Date.now();

  for (let i = 0; i < 12; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await getStatus(op.operationId);
    const cs = s?.currentState ?? {};
    samples.push({
      cost: s?.stats?.totalCost ?? 0,
      status: cs.status,
      steps: cs.stepCount ?? 0,
      t: Math.round((Date.now() - t0) / 1000),
      tokens: cs.usage?.llm?.tokens?.total ?? 0,
    });
    const last = samples.at(-1)!;
    console.info(`  t=${last.t}s  steps=${last.steps}  status=${last.status}  tokens=${last.tokens}  llmCalls=${cs.usage?.llm?.apiCalls ?? 0}`);
    if (['done', 'error', 'interrupted'].includes(cs.status)) {
      console.info('  → 到达终态，停止采样');
      break;
    }
  }

  const first = samples[0];
  const last = samples.at(-1)!;
  const rate = (last.steps - first.steps) / Math.max(1, last.t - first.t);
  console.info(`\n步数增长速率: ${rate.toFixed(1)} 步/秒`);
  console.info(`是否收敛: ${['done','error','interrupted'].includes(last.status) ? '是' : '否 —— 仍在增长'}`);

  console.info('\n清理：中断该 operation');
  const r = await trpcMutate<any>('aiAgent.interruptTask', { operationId: op.operationId });
  console.info('interruptTask 返回:', JSON.stringify(r));
  await new Promise((r2) => setTimeout(r2, 3000));
  const after = await getStatus(op.operationId);
  console.info('中断后状态:', after?.currentState?.status, '步数:', after?.currentState?.stepCount);
};

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
