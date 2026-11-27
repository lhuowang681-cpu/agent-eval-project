#!/usr/bin/env tsx
/**
 * Aggregate .agent-tracing snapshots into latency / cost tables.
 *
 * Why not k6: PLAN.md originally picked k6, but decision 8 removed the entire
 * concurrency half of phase 6 (throughput, error-rate curves, knee, connection
 * pool) because PGlite serialises queries and would create a fake bottleneck.
 * What remains — per-request latency composition, cost structure parameters and
 * trend curves — comes from the runtime's own per-step snapshots, so a load
 * generator adds nothing. k6 is also not installed and would need elevation.
 *
 * Usage:
 *   bun run tsx bench/analyze/parseTracing.ts                 # all snapshots
 *   bun run tsx bench/analyze/parseTracing.ts --since 30      # last 30 minutes
 *   bun run tsx bench/analyze/parseTracing.ts --csv out.csv
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname ?? __dirname, '..', '..');
const dir = join(repoRoot, '.agent-tracing');

interface StepRow {
  traceId: string;
  stepIndex: number;
  stepType: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  toolCount: number;
}

interface RunRow {
  traceId: string;
  model?: string;
  provider?: string;
  reason?: string;
  steps: number;
  wallMs: number;
  sumStepMs: number;
  totalTokens: number;
  totalCost: number;
  llmSteps: number;
  toolSteps: number;
  startedAt: number;
}

const pct = (sorted: number[], p: number): number => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
};

const stats = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    avg: s.length ? sum / s.length : 0,
    max: s.at(-1) ?? 0,
    min: s[0] ?? 0,
    n: s.length,
    p50: pct(s, 50),
    p90: pct(s, 90),
    p95: pct(s, 95),
    p99: pct(s, 99),
  };
};

const fmt = (n: number, d = 1) => n.toFixed(d);

const main = () => {
  if (!existsSync(dir)) {
    console.error(`没有 ${dir} —— 先在 NODE_ENV=development 下跑几次 agent`);
    process.exit(1);
  }

  const sinceArg = process.argv.indexOf('--since');
  const sinceMin = sinceArg > -1 ? Number(process.argv[sinceArg + 1]) : undefined;
  const cutoff = sinceMin ? Date.now() - sinceMin * 60_000 : 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'latest.json');

  const runs: RunRow[] = [];
  const steps: StepRow[] = [];

  for (const f of files) {
    let snap: any;
    try {
      snap = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
    } catch {
      continue;
    }
    if (!snap?.traceId || !Array.isArray(snap.steps)) continue;
    if (snap.startedAt < cutoff) continue;

    const stepRows: StepRow[] = snap.steps.map((s: any) => ({
      inputTokens: s.inputTokens ?? 0,
      ms: s.executionTimeMs ?? Math.max(0, (s.completedAt ?? 0) - (s.startedAt ?? 0)),
      outputTokens: s.outputTokens ?? 0,
      stepIndex: s.stepIndex ?? 0,
      stepType: s.stepType ?? 'unknown',
      toolCount: s.toolsCalling?.length ?? 0,
      totalCost: s.totalCost ?? 0,
      totalTokens: s.totalTokens ?? 0,
      traceId: snap.traceId,
    }));
    steps.push(...stepRows);

    runs.push({
      llmSteps: stepRows.filter((s) => s.stepType === 'call_llm').length,
      model: snap.model,
      provider: snap.provider,
      reason: snap.completionReason,
      startedAt: snap.startedAt,
      steps: stepRows.length,
      sumStepMs: stepRows.reduce((a, b) => a + b.ms, 0),
      toolSteps: stepRows.filter((s) => s.stepType === 'call_tool').length,
      totalCost: snap.totalCost ?? 0,
      totalTokens: snap.totalTokens ?? 0,
      traceId: snap.traceId,
      wallMs: Math.max(0, (snap.completedAt ?? snap.startedAt) - snap.startedAt),
    });
  }

  if (!runs.length) {
    console.error('没有可用快照');
    process.exit(1);
  }

  runs.sort((a, b) => a.startedAt - b.startedAt);

  // ── 概览 ────────────────────────────────────────────────────────────────
  console.info('═'.repeat(72));
  console.info(`Agent 执行快照分析 —— ${runs.length} 次运行 / ${steps.length} 个步骤`);
  console.info('═'.repeat(72));

  const byReason = runs.reduce<Record<string, number>>((a, r) => {
    a[r.reason ?? 'unknown'] = (a[r.reason ?? 'unknown'] ?? 0) + 1;
    return a;
  }, {});
  console.info(`\n完成原因: ${Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  // ── 端到端延迟 ──────────────────────────────────────────────────────────
  const wall = stats(runs.map((r) => r.wallMs));
  console.info('\n── 端到端延迟（wall clock，ms）──');
  console.info(`  n=${wall.n}  P50=${fmt(wall.p50, 0)}  P90=${fmt(wall.p90, 0)}  P95=${fmt(wall.p95, 0)}  P99=${fmt(wall.p99, 0)}  max=${fmt(wall.max, 0)}`);

  // ── 单步延迟（按类型）────────────────────────────────────────────────────
  console.info('\n── 单步延迟（ms，按步骤类型）──');
  for (const t of ['call_llm', 'call_tool']) {
    const s = stats(steps.filter((x) => x.stepType === t).map((x) => x.ms));
    if (!s.n) continue;
    console.info(`  ${t.padEnd(10)} n=${String(s.n).padStart(4)}  P50=${fmt(s.p50, 0).padStart(6)}  P90=${fmt(s.p90, 0).padStart(6)}  P95=${fmt(s.p95, 0).padStart(6)}  P99=${fmt(s.p99, 0).padStart(6)}  max=${fmt(s.max, 0).padStart(6)}`);
  }

  // ── 耗时构成 ────────────────────────────────────────────────────────────
  //
  // ⚠️ 口径说明：快照的 startedAt/completedAt **不覆盖完整请求**。实测中快照 wall
  // 的 P50 明显小于 bench 侧测得的端到端 P50（125ms vs 398ms），且各步
  // executionTimeMs 之和会超过快照 wall。因此这里**不**用快照 wall 作分母去算
  // 「框架余量」——那样会得到负数。只报告各步耗时的绝对值与相对占比，
  // 真正的端到端请用 bench/run-scenarios.ts 的测量值。
  console.info('\n── 各步耗时（绝对值）──');
  const llmMs = steps.filter((s) => s.stepType === 'call_llm').reduce((a, s) => a + s.ms, 0);
  const toolMs = steps.filter((s) => s.stepType === 'call_tool').reduce((a, s) => a + s.ms, 0);
  const stepSum = llmMs + toolMs;
  const snapWall = runs.reduce((a, r) => a + r.wallMs, 0);
  const share = (v: number) => `${fmt((v / stepSum) * 100)}%`;
  console.info(`  call_llm 步骤   ${String(llmMs).padStart(8)} ms  占步骤耗时 ${share(llmMs).padStart(7)}`);
  console.info(`  call_tool 步骤  ${String(toolMs).padStart(8)} ms  占步骤耗时 ${share(toolMs).padStart(7)}`);
  console.info(`  步骤耗时合计    ${String(stepSum).padStart(8)} ms`);
  console.info(`  快照 wall 合计  ${String(snapWall).padStart(8)} ms  ← 小于步骤合计，说明快照时间戳不覆盖完整请求`);
  console.info(`  差值            ${String(snapWall - stepSum).padStart(8)} ms  ⚠️ 负值属口径问题，非真实并行`);

  // ── 成本结构参数 ────────────────────────────────────────────────────────
  console.info('\n── 成本结构参数（与 provider 无关，可外推）──');
  const stepsPerRun = stats(runs.map((r) => r.steps));
  const llmPerRun = stats(runs.map((r) => r.llmSteps));
  const toolPerRun = stats(runs.map((r) => r.toolSteps));
  const tokPerRun = stats(runs.map((r) => r.totalTokens));
  const tokPerLlm = stats(runs.filter((r) => r.llmSteps > 0).map((r) => r.totalTokens / r.llmSteps));
  console.info(`  每次对话步数        P50=${fmt(stepsPerRun.p50, 0)}  avg=${fmt(stepsPerRun.avg)}  max=${fmt(stepsPerRun.max, 0)}`);
  console.info(`  每次对话 LLM 调用   P50=${fmt(llmPerRun.p50, 0)}  avg=${fmt(llmPerRun.avg)}  max=${fmt(llmPerRun.max, 0)}`);
  console.info(`  每次对话工具调用    P50=${fmt(toolPerRun.p50, 0)}  avg=${fmt(toolPerRun.avg)}  max=${fmt(toolPerRun.max, 0)}`);
  console.info(`  每次对话 tokens     P50=${fmt(tokPerRun.p50, 0)}  avg=${fmt(tokPerRun.avg, 0)}  max=${fmt(tokPerRun.max, 0)}`);
  console.info(`  每次 LLM 调用 tokens P50=${fmt(tokPerLlm.p50, 0)}  avg=${fmt(tokPerLlm.avg, 0)}`);

  // ── 上下文增长 ──────────────────────────────────────────────────────────
  console.info('\n── 上下文随步数增长（输入 token 放大）──');
  const byStepIdx = new Map<number, number[]>();
  for (const s of steps) {
    if (s.stepType !== 'call_llm' || !s.inputTokens) continue;
    if (!byStepIdx.has(s.stepIndex)) byStepIdx.set(s.stepIndex, []);
    byStepIdx.get(s.stepIndex)!.push(s.inputTokens);
  }
  const idxs = [...byStepIdx.keys()].sort((a, b) => a - b).slice(0, 12);
  if (idxs.length) {
    for (const i of idxs) {
      const v = stats(byStepIdx.get(i)!);
      console.info(`  step ${String(i).padStart(2)}  n=${String(v.n).padStart(3)}  输入 tokens P50=${fmt(v.p50, 0).padStart(7)}  avg=${fmt(v.avg, 0).padStart(7)}`);
    }
    const first = stats(byStepIdx.get(idxs[0])!).p50;
    const last = stats(byStepIdx.get(idxs.at(-1)!)!).p50;
    if (first > 0) {
      console.info(`  → 从 step ${idxs[0]} 到 step ${idxs.at(-1)}：输入 token 放大 ${fmt(last / first, 2)}×`);
    }
  } else {
    console.info('  （无带 inputTokens 的 call_llm 步骤）');
  }

  // ── CSV ─────────────────────────────────────────────────────────────────
  const csvArg = process.argv.indexOf('--csv');
  if (csvArg > -1) {
    const out = process.argv[csvArg + 1] ?? 'bench-runs.csv';
    const header = 'traceId,model,provider,reason,steps,llmSteps,toolSteps,wallMs,sumStepMs,totalTokens,totalCost';
    const lines = runs.map((r) =>
      [r.traceId, r.model ?? '', r.provider ?? '', r.reason ?? '', r.steps, r.llmSteps, r.toolSteps, r.wallMs, r.sumStepMs, r.totalTokens, r.totalCost].join(','),
    );
    writeFileSync(out, [header, ...lines].join('\n'), 'utf-8');
    console.info(`\nCSV 已写入 ${out}`);
  }

  console.info('\n' + '─'.repeat(72));
  console.info('注意：数据库为 PGlite（查询串行化）、无 Redis。并发吞吐/错误率/吞吐拐点');
  console.info('不在本阶段范围内 —— 见 PLAN.md 决策 8 与「待将来补测清单」#5 #7。');
};

main();
