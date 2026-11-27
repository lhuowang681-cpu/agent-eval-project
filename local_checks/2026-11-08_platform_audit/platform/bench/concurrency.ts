#!/usr/bin/env tsx
/**
 * Concurrency gradient — PLAN.md 待补测 #7, and the part of phase 6 that
 * decision 8 deleted.
 *
 * WHY THIS COULD NOT RUN BEFORE
 * `bench/run-scenarios.ts` opens with the reason: PGlite serialises every query
 * internally, so any concurrency number measured against it is a property of the
 * WASM query queue, not of the application. With a real Postgres (paradedb/pg17)
 * and a real Redis behind queue mode, the gradient means something again.
 *
 * WHAT IT MEASURES
 *   A. HTTP read path  — /api/v1/health (framework floor) and a DB-backed read,
 *      at 1→2→5→10→20→50 concurrent clients: throughput, P50/P95/P99, error rate.
 *   B. Agent E2E       — full createOperation→agent_runtime_end at a smaller
 *      gradient, since each run costs seconds of queue round-trips.
 *
 * The knee is reported as the first concurrency level where error rate > 1% or
 * P99 more than doubles versus the level before it — the criterion phase 6's
 * checkpoint 4 asks for.
 *
 * Usage:
 *   bun run tsx bench/concurrency.ts                 # read path only (fast)
 *   bun run tsx bench/concurrency.ts --agent         # also drive agent E2E
 *   bun run tsx bench/concurrency.ts --levels 1,5,20
 */
import 'dotenv/config';

import { BASE_URL, setScenario } from '../tools/api-test/client';
import { createOperation, isTerminal, prepareConversation, waitForStatus } from '../tools/api-test/helpers';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};

const LEVELS = opt('--levels', '1,2,5,10,20,50').split(',').map(Number);
const DURATION_MS = Number(opt('--duration', '8000'));
const AGENT_LEVELS = opt('--agent-levels', '1,2,5,10').split(',').map(Number);

/**
 * 两套凭证，按被测服务的形态选：
 *   dev  (`next dev`)   → 开发态旁路头，能打 tRPC 与 REST
 *   prod (`next start`) → NODE_ENV=production 让旁路失效（F11.6），必须用 API Key，
 *                          而 API Key 只对 `/api/v1/*` REST 有效，tRPC 走 OIDC/session 不吃它。
 * 所以设了 TEST_API_KEY 时，读路径自动从 tRPC 换成等价的 REST 端点，
 * 否则测出来的只是「鉴权拒绝」的快路径，毫无意义。
 */
const API_KEY = process.env.TEST_API_KEY;

const AUTH: Record<string, string> = API_KEY
  ? { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  : { 'Content-Type': 'application/json', 'lobe-auth-dev-backend-api': '1' };

const pctl = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

interface LevelResult {
  concurrency: number;
  requests: number;
  errors: number;
  errorRate: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Hammer one URL with `concurrency` workers for `DURATION_MS`, closed-loop. */
const loadUrl = async (url: string, concurrency: number): Promise<LevelResult> => {
  const latencies: number[] = [];
  let errors = 0;
  const stopAt = Date.now() + DURATION_MS;

  const worker = async () => {
    while (Date.now() < stopAt) {
      const t0 = Date.now();
      try {
        const res = await fetch(url, { headers: AUTH });
        // Drain the body: an undrained response keeps the socket busy and would
        // distort both latency and the connection-pool behaviour we want to see.
        await res.text();
        if (!res.ok) errors++;
      } catch {
        errors++;
      }
      latencies.push(Date.now() - t0);
    }
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsed = (Date.now() - t0) / 1000;

  const requests = latencies.length;
  return {
    concurrency,
    errorRate: requests ? errors / requests : 0,
    errors,
    max: pctl(latencies, 100),
    p50: pctl(latencies, 50),
    p95: pctl(latencies, 95),
    p99: pctl(latencies, 99),
    requests,
    rps: elapsed ? requests / elapsed : 0,
  };
};

const table = (rows: LevelResult[]) => {
  console.info(
    '\n  并发   请求数    RPS      P50     P95     P99     max    错误率',
  );
  console.info('  ' + '─'.repeat(62));
  for (const r of rows) {
    console.info(
      `  ${String(r.concurrency).padStart(3)}  ${String(r.requests).padStart(7)}  ` +
        `${r.rps.toFixed(1).padStart(7)}  ${String(r.p50).padStart(5)}ms ${String(r.p95).padStart(5)}ms ` +
        `${String(r.p99).padStart(5)}ms ${String(r.max).padStart(5)}ms  ${(r.errorRate * 100).toFixed(2)}%`,
    );
  }
};

/**
 * Knee = first level with >1% errors, or where P99 more than doubles vs the
 * previous level. Reported as "not reached" when neither happens — saying
 * "no knee below 50" is a result; inventing one is not.
 */
const findKnee = (rows: LevelResult[]): string => {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].errorRate > 0.01) return `并发 ${rows[i].concurrency}（错误率 ${(rows[i].errorRate * 100).toFixed(2)}% > 1%）`;
    if (i > 0 && rows[i - 1].p99 > 0 && rows[i].p99 > rows[i - 1].p99 * 2) {
      return `并发 ${rows[i].concurrency}（P99 ${rows[i - 1].p99}ms → ${rows[i].p99}ms，翻倍以上）`;
    }
  }
  return `在测试范围内（最高 ${rows.at(-1)?.concurrency}）未出现拐点`;
};

const runAgentLevel = async (concurrency: number) => {
  const latencies: number[] = [];
  let errors = 0;

  const one = async (i: number) => {
    const t0 = Date.now();
    try {
      const ctx = await prepareConversation(`并发 ${concurrency}-${i}`);
      const op = await createOperation(ctx);
      const st = await waitForStatus(op.operationId, isTerminal, { intervalMs: 200, timeoutMs: 180_000 });
      if (st?.currentState?.status !== 'done') errors++;
    } catch {
      errors++;
    }
    latencies.push(Date.now() - t0);
  };

  const t0 = Date.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => one(i)));
  const elapsed = (Date.now() - t0) / 1000;

  return {
    concurrency,
    errorRate: latencies.length ? errors / latencies.length : 0,
    errors,
    max: pctl(latencies, 100),
    p50: pctl(latencies, 50),
    p95: pctl(latencies, 95),
    p99: pctl(latencies, 99),
    requests: latencies.length,
    rps: elapsed ? latencies.length / elapsed : 0,
  } satisfies LevelResult;
};

const main = async () => {
  console.info('\n' + '═'.repeat(66));
  console.info('并发梯度 — PLAN.md 待补测 #7（决策 8 曾删除该部分）');
  console.info('═'.repeat(66));
  console.info(`  被测: ${BASE_URL}`);
  console.info(`  梯度: ${LEVELS.join(' → ')}   每档 ${DURATION_MS}ms 闭环加压`);
  console.info(`  DB:   ${process.env.DATABASE_URL?.replace(/:[^:@]*@/, ':***@')}`);
  console.info(`  队列: AGENT_RUNTIME_MODE=${process.env.AGENT_RUNTIME_MODE ?? '(未设=本地 setTimeout)'}`);

  console.info('\n▶ S0 框架地板：GET /api/v1/health（不碰 DB）');
  const s0: LevelResult[] = [];
  for (const c of LEVELS) s0.push(await loadUrl(`${BASE_URL}/api/v1/health`, c));
  table(s0);
  console.info(`\n  拐点: ${findKnee(s0)}`);

  const readLabel = API_KEY ? 'REST GET /api/v1/topics' : 'tRPC topic.getAllTopics';
  console.info(`\n▶ S1 读路径：${readLabel}（走 PG 连接池）`);
  const readUrl = API_KEY
    ? `${BASE_URL}/api/v1/topics?page=1&pageSize=20`
    : `${BASE_URL}/trpc/lambda/topic.getAllTopics?input=${encodeURIComponent(JSON.stringify({ json: {} }))}`;
  const s1: LevelResult[] = [];
  for (const c of LEVELS) s1.push(await loadUrl(readUrl, c));
  table(s1);
  console.info(`\n  拐点: ${findKnee(s1)}`);

  if (flag('--agent')) {
    console.info('\n▶ S4 Agent 端到端：createOperation → agent_runtime_end');
    await setScenario('simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
    const s4: LevelResult[] = [];
    for (const c of AGENT_LEVELS) {
      console.info(`    并发 ${c} …`);
      s4.push(await runAgentLevel(c));
    }
    table(s4);
    console.info(`\n  拐点: ${findKnee(s4)}`);
  } else {
    console.info('\n▶ S4 Agent 端到端：已跳过（加 --agent 开启，每档需数十秒）');
  }

  console.info('\n' + '─'.repeat(66));
  // Which server is answering changes how every number above should be read, so
  // detect it rather than hard-coding a caveat that goes stale.
  const prod = await fetch(`${BASE_URL}/api/v1/health`)
    .then((r) => r.headers.get('x-powered-by') !== null || !r.headers.get('x-nextjs-cache'))
    .catch(() => false);
  console.info(
    prod
      ? '注：若被测为 `next start`（生产构建），S1/S4 走 tRPC 的部分会因 NODE_ENV=production\n' +
          '    下开发态鉴权旁路失效而 100% 报错 —— 那是预期的安全边界（F11.6），不是性能问题。'
      : '注：若被测为 `next dev`，数值含 dev 开销（单进程、按需编译），不代表生产上限。',
  );
  console.info('─'.repeat(66) + '\n');
};

main().catch((error) => {
  console.error('\n❌ concurrency 脚本异常:', error);
  process.exitCode = 1;
});
