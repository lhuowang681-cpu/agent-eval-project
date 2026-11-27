#!/usr/bin/env tsx
/**
 * Measure the per-step state write amplification — PLAN.md appendix A, risk #1.
 *
 * The claim under test: `AgentRuntime.step()` deep-clones the whole state and the
 * state manager serialises all of it on every step, so an N-step conversation writes
 * O(N²) cumulative bytes.
 *
 * This needs NO Redis. The amplification is a property of *serialising the state*,
 * not of where the bytes land — so it is measurable against the in-memory manager,
 * and the conclusion transfers directly to the Redis `SETEX` path.
 *
 * Measurement source: `.agent-tracing` snapshots. Step 0 carries `messagesBaseline`
 * (the full array) and each later step carries `messagesDelta`, so the message array
 * at any step can be reconstructed exactly. Messages dominate state size; the
 * remaining fields (toolManifestMap, usage, cost, …) are roughly constant per run and
 * are reported separately as a floor.
 *
 * Usage:
 *   bun run tsx bench/write-amplification.ts            # drive a run then analyse
 *   bun run tsx bench/write-amplification.ts --analyse  # analyse newest snapshot only
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { setScenario } from '../tools/api-test/client';
import { createOperation, isTerminal, prepareConversation, waitForStatus } from '../tools/api-test/helpers';

const repoRoot = resolve(import.meta.dirname ?? __dirname, '..');
const traceDir = join(repoRoot, '.agent-tracing');

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const kb = (n: number) => (n / 1024).toFixed(1);

const drive = async () => {
  console.info('驱动一次多轮对话（growth 场景，12 轮工具 + 收尾）…');
  await setScenario('growth', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation('write amplification');
  const op = await createOperation(ctx);
  const st = await waitForStatus(op.operationId, isTerminal, { intervalMs: 200, timeoutMs: 180_000 });
  const cs = st?.currentState ?? {};
  console.info(`  完成：status=${cs.status} steps=${cs.stepCount} tokens=${cs.usage?.llm?.tokens?.total}`);
  return op.operationId as string;
};

const newestSnapshot = () => {
  const files = readdirSync(traceDir)
    .filter((f) => f.endsWith('.json') && f !== 'latest.json')
    .map((f) => ({ f, t: JSON.parse(readFileSync(join(traceDir, f), 'utf-8')).startedAt ?? 0 }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) throw new Error('没有快照');
  return JSON.parse(readFileSync(join(traceDir, files[0].f), 'utf-8'));
};

const analyse = (snap: any) => {
  console.info('\n' + '═'.repeat(78));
  console.info(`状态写放大分析 —— trace ${snap.traceId}，${snap.steps?.length ?? 0} 步`);
  console.info('═'.repeat(78));

  let messages: any[] = [];
  const rows: { step: number; msgs: number; stateBytes: number; cumulative: number }[] = [];
  let cumulative = 0;

  for (const s of snap.steps ?? []) {
    if (s.messagesBaseline) messages = [...s.messagesBaseline];
    else if (s.messagesDelta) messages = [...messages, ...s.messagesDelta];

    const b = bytes(messages);
    cumulative += b;
    rows.push({ cumulative, msgs: messages.length, stateBytes: b, step: s.stepIndex ?? rows.length });
  }

  if (!rows.length) {
    console.info('快照里没有 messages 数据');
    return;
  }

  console.info('\n step │ 消息数 │ 本步序列化字节 │ 累计写入');
  console.info('──────┼────────┼────────────────┼──────────');
  for (const r of rows) {
    console.info(
      ` ${String(r.step).padStart(4)} │ ${String(r.msgs).padStart(6)} │ ${(kb(r.stateBytes) + ' KB').padStart(14)} │ ${(kb(r.cumulative) + ' KB').padStart(9)}`,
    );
  }

  const n = rows.length;
  const first = rows[0];
  const last = rows.at(-1)!;

  console.info('\n── 增长特征 ──');
  console.info(`  步数                 ${n}`);
  console.info(`  单步字节 首→末       ${kb(first.stateBytes)} KB → ${kb(last.stateBytes)} KB  (${(last.stateBytes / Math.max(1, first.stateBytes)).toFixed(1)}×)`);
  console.info(`  累计写入             ${kb(last.cumulative)} KB`);
  console.info(`  若单步恒定不增长     ${kb(first.stateBytes * n)} KB  ← 线性基准`);
  console.info(`  放大倍数             ${(last.cumulative / Math.max(1, first.stateBytes * n)).toFixed(1)}×`);

  // Fit: is cumulative closer to O(n) or O(n²)?
  // For per-step size growing linearly, cumulative ~ k·n²/2.
  const perStepSlope = (last.stateBytes - first.stateBytes) / Math.max(1, n - 1);
  const predictedQuadratic = first.stateBytes * n + (perStepSlope * n * (n - 1)) / 2;
  console.info('\n── 复杂度判定 ──');
  console.info(`  单步字节增长斜率     ${(perStepSlope / 1024).toFixed(2)} KB/步  ← 近似常数则单步为 O(n)`);
  console.info(`  二次模型预测累计     ${kb(predictedQuadratic)} KB`);
  console.info(`  实测累计             ${kb(last.cumulative)} KB`);
  console.info(`  拟合误差             ${(Math.abs(predictedQuadratic - last.cumulative) / Math.max(1, last.cumulative) * 100).toFixed(1)}%`);

  // Extrapolation
  console.info('\n── 外推（按实测斜率）──');
  for (const target of [20, 50, 100, 200]) {
    const perStep = first.stateBytes + perStepSlope * target;
    const cum = first.stateBytes * target + (perStepSlope * target * (target - 1)) / 2;
    console.info(`  ${String(target).padStart(3)} 步：单步 ${(kb(perStep) + ' KB').padStart(9)}   累计写入 ${(kb(cum) + ' KB').padStart(10)}  (${(cum / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.info('\n' + '─'.repeat(78));
  console.info('说明：以上是 messages 数组的序列化字节。完整 state 还包含 toolManifestMap /');
  console.info('operationToolSet / usage / cost 等，每次运行近似恒定，构成一个附加基底。');
  console.info('本测量与存储介质无关 —— 结论直接适用于 Redis SETEX 路径（AgentStateManager.ts:55）。');
};

const main = async () => {
  if (!existsSync(traceDir)) {
    console.error('没有 .agent-tracing —— 需要 NODE_ENV=development');
    process.exit(1);
  }
  if (!process.argv.includes('--analyse')) await drive();
  analyse(newestSnapshot());
};

main().catch((e) => {
  console.error('失败:', e);
  process.exit(1);
});
