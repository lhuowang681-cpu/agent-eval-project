#!/usr/bin/env tsx
/**
 * Phase 6 bench driver — sequential, single-request focus.
 *
 * Scope is deliberately narrow (PLAN.md decision 8): with PGlite serialising
 * queries and no Redis, concurrency numbers would measure a fake bottleneck, so
 * this drives one request at a time and records latency composition, cost
 * structure and trend curves. It does NOT measure throughput.
 *
 * Usage:
 *   bun run tsx bench/run-scenarios.ts               # default 8 iterations each
 *   bun run tsx bench/run-scenarios.ts --n 20
 */
import { setScenario } from '../tools/api-test/client';
import { createOperation, getStatus, isTerminal, prepareConversation, waitForStatus } from '../tools/api-test/helpers';

const nArg = process.argv.indexOf('--n');
const N = nArg > -1 ? Number(process.argv[nArg + 1]) : 8;

interface Sample {
  label: string;
  wallMs: number;
  steps: number;
  llmCalls: number;
  toolCalls: number;
  tokensIn: number;
  tokensOut: number;
  status: string;
}

const pctl = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

const runOnce = async (label: string, scenario: string, mock: Record<string, unknown>): Promise<Sample> => {
  await setScenario(scenario, mock);
  const ctx = await prepareConversation(`bench ${label}`);
  const t0 = Date.now();
  const op = await createOperation(ctx);
  const st = await waitForStatus(op.operationId, isTerminal, { intervalMs: 120, timeoutMs: 120_000 });
  const wallMs = Date.now() - t0;
  const cs = st?.currentState ?? {};
  return {
    label,
    llmCalls: cs.usage?.llm?.apiCalls ?? 0,
    status: cs.status,
    steps: cs.stepCount ?? 0,
    tokensIn: cs.usage?.llm?.tokens?.input ?? 0,
    tokensOut: cs.usage?.llm?.tokens?.output ?? 0,
    toolCalls: cs.usage?.tools?.totalCalls ?? 0,
    wallMs,
  };
};

const report = (label: string, samples: Sample[]) => {
  const w = samples.map((s) => s.wallMs);
  const ok = samples.filter((s) => s.status === 'done').length;
  console.info(
    `  ${label.padEnd(28)} n=${String(samples.length).padStart(2)} done=${ok}` +
      `  P50=${String(pctl(w, 50)).padStart(6)}ms  P90=${String(pctl(w, 90)).padStart(6)}ms` +
      `  P95=${String(pctl(w, 95)).padStart(6)}ms  P99=${String(pctl(w, 99)).padStart(6)}ms` +
      `  steps=${samples[0]?.steps}  tok=${samples[0]?.tokensIn}/${samples[0]?.tokensOut}`,
  );
};

const main = async () => {
  console.info('═'.repeat(96));
  console.info(`阶段 6 基准测试 —— 每组 ${N} 次，串行执行`);
  console.info('数据库 PGlite（串行化）+ 无 Redis + Mock LLM；不测并发吞吐，见 PLAN.md 决策 8');
  console.info('═'.repeat(96));

  // ── S3/S4 基线：LLM 变成常量，测框架自身开销 ──────────────────────────────
  console.info('\n── S4 端到端（纯文本，LLM 零延迟）──');
  const base: Sample[] = [];
  for (let i = 0; i < N; i += 1) base.push(await runOnce('S4 baseline', 'simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 }));
  report('纯文本 / LLM 0ms', base);

  // ── S5 含工具 ─────────────────────────────────────────────────────────────
  console.info('\n── S5 含工具调用 ──');
  const tool: Sample[] = [];
  for (let i = 0; i < N; i += 1) tool.push(await runOnce('S5 tool', 'single-tool', { firstTokenDelayMs: 0, tokensPerSecond: 0 }));
  report('单工具（3 步）', tool);

  const par: Sample[] = [];
  for (let i = 0; i < N; i += 1) par.push(await runOnce('S5 parallel', 'parallel-tools', { firstTokenDelayMs: 0, tokensPerSecond: 0 }));
  report('三工具并行（3 步）', par);

  // ── 档位扫描：LLM 侧耗时 → E2E 的传导 ────────────────────────────────────
  console.info('\n── 档位扫描：首 token 延迟 → E2E 传导 ──');
  const tiers = [0, 200, 500, 1000];
  const tierRows: { tier: number; p50: number; delta: number }[] = [];
  for (const tier of tiers) {
    const s: Sample[] = [];
    for (let i = 0; i < Math.max(4, Math.floor(N / 2)); i += 1) {
      s.push(await runOnce(`tier ${tier}`, 'simple', { firstTokenDelayMs: tier, tokensPerSecond: 0 }));
    }
    const p50 = pctl(s.map((x) => x.wallMs), 50);
    tierRows.push({ delta: 0, p50, tier });
    report(`首 token ${tier}ms`, s);
  }
  const baseP50 = tierRows[0]?.p50 ?? 0;
  console.info('\n  传导分析（相对 0ms 档）：');
  for (const r of tierRows) {
    const expected = baseP50 + r.tier;
    console.info(
      `    首 token ${String(r.tier).padStart(4)}ms → E2E P50 ${String(r.p50).padStart(6)}ms` +
        `  预期 ${String(expected).padStart(6)}ms  偏差 ${String(r.p50 - expected).padStart(6)}ms`,
    );
  }

  // ── 成本结构参数 ──────────────────────────────────────────────────────────
  console.info('\n── 成本结构参数 ──');
  const all = [...base, ...tool, ...par];
  const amp = all.filter((s) => s.tokensIn > 0);
  console.info(`  每次对话 LLM 调用数   纯文本=${base[0]?.llmCalls}  单工具=${tool[0]?.llmCalls}  三工具并行=${par[0]?.llmCalls}`);
  console.info(`  每次对话工具调用数    纯文本=${base[0]?.toolCalls}  单工具=${tool[0]?.toolCalls}  三工具并行=${par[0]?.toolCalls}`);
  console.info(`  输入/输出 token 比    ${(amp.reduce((a, s) => a + s.tokensIn, 0) / Math.max(1, amp.reduce((a, s) => a + s.tokensOut, 0))).toFixed(2)}`);

  console.info('\n' + '─'.repeat(96));
  console.info('用 `bun run tsx bench/analyze/parseTracing.ts --since 30` 查看分步耗时构成。');
};

main().catch((e) => {
  console.error('bench 失败:', e);
  process.exit(1);
});
