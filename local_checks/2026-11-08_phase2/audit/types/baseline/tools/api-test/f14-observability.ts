#!/usr/bin/env tsx
/**
 * F14 可观测性 — 阶段 5 未覆盖组之一.
 *
 * 覆盖 PLAN.md §F14：
 *   F14.1 agent-tracing 分步快照落盘与固化
 *   F14.2 快照结构完整性（StepSnapshot 的字段契约）
 *   F14.4 triplog trace context 注入（本地为存根，验证不炸即可）
 *
 * 并把一条实测到的可移植性问题固化为断言：
 *   固化阶段用 `symlink` 生成 `.agent-tracing/latest.json`，
 *   Windows 非提权进程建符号链接会 EPERM。错误被 catch 成
 *   "snapshot finalization failed"，运行本身不受影响，但 latest.json 永远不存在。
 *   PLAN.md 检查点 9 恰恰断言了这个文件 —— 在 Windows 上该断言无法成立。
 *
 * Usage:  bun run tsx tools/api-test/f14-observability.ts
 */
import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { check, setScenario, summary } from './client';
import { createOperation, isTerminal, prepareConversation, waitForStatus } from './helpers';

const TRACING_DIR = join(process.cwd(), '.agent-tracing');

const snapshotFiles = () =>
  existsSync(TRACING_DIR)
    ? readdirSync(TRACING_DIR)
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .sort()
    : [];

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('F14 可观测性（agent-tracing） — 阶段 5 补测');
  console.info('═'.repeat(64));

  check('agent-tracing 目录存在（dev 态自动开启）', existsSync(TRACING_DIR), TRACING_DIR);

  const before = snapshotFiles().length;
  console.info(`  运行前快照数: ${before}`);

  console.info('\n▶ F14.1 跑一轮对话并观察快照固化');

  await setScenario('single-tool', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation('F14 可观测性用例');
  const op = await createOperation(ctx);
  const st = await waitForStatus(op.operationId, isTerminal, { intervalMs: 300, timeoutMs: 120_000 });

  check('对话跑到终态', st?.currentState?.status === 'done', `status=${st?.currentState?.status}`);

  // Finalization happens just after the terminal step; give it a beat to land.
  await new Promise((r) => setTimeout(r, 2500));

  const after = snapshotFiles();
  console.info(`  运行后快照数: ${after.length}`);
  check('产生了新的快照文件', after.length > before, `${before} → ${after.length}`);

  console.info('\n▶ F14.2 快照结构契约');

  const newest = after.at(-1);
  check('能定位到最新快照', !!newest, newest ?? '(无)');

  if (newest) {
    const raw = readFileSync(join(TRACING_DIR, newest), 'utf8');
    const snap = JSON.parse(raw);

    const topRequired = [
      'agentId',
      'completedAt',
      'completionReason',
      'model',
      'operationId',
      'provider',
      'startedAt',
      'steps',
      'totalCost',
      'totalSteps',
      'totalTokens',
      'traceId',
      'userId',
    ];
    const missingTop = topRequired.filter((k) => !(k in snap));
    check(
      '顶层字段齐全（含 totalCost / totalTokens / completionReason）',
      missingTop.length === 0,
      missingTop.length ? `缺 ${missingTop.join(',')}` : `${topRequired.length} 个字段齐全`,
    );

    const stepRequired = [
      'completedAt',
      'events',
      'executionTimeMs',
      'inputTokens',
      'messagesBaseline',
      'messagesDelta',
      'outputTokens',
      'startedAt',
      'stepIndex',
      'stepType',
      'totalCost',
      'totalTokens',
    ];
    const step0 = snap.steps?.[0] ?? {};
    const missingStep = stepRequired.filter((k) => !(k in step0));
    check(
      'StepSnapshot 字段齐全（延迟/成本分析的数据源）',
      missingStep.length === 0,
      missingStep.length ? `缺 ${missingStep.join(',')}` : `${stepRequired.length} 个字段齐全`,
    );

    check(
      '🐛 steps 数组长度与 totalSteps 一致',
      Array.isArray(snap.steps) && snap.steps.length === snap.totalSteps,
      `steps=${snap.steps?.length} totalSteps=${snap.totalSteps}` +
        (snap.steps?.length === snap.totalSteps ? '' : ' —— 两者对不上，取哪个做「步数」会得出不同结论'),
    );

    // ⚠️ 语义陷阱：步内 `totalTokens` 是**累计值**（实测 38, 38, 175, 175），
    // 与顶层 `totalTokens` 同名但含义不同。对它求和毫无意义（会得到 426 vs 175）。
    // 真正的单步增量是 `inputTokens` / `outputTokens`，且仅 call_llm 步有值。
    const stepTotals = (snap.steps ?? []).map((s: any) => s.totalTokens ?? 0);
    const monotonic = stepTotals.every((v: number, i: number) => i === 0 || v >= stepTotals[i - 1]);
    check(
      '步内 totalTokens 单调不减（确认其为累计值而非增量）',
      monotonic,
      `[${stepTotals.join(', ')}]`,
    );
    check(
      '最后一步的累计 token 等于顶层 totalTokens',
      stepTotals.at(-1) === snap.totalTokens,
      `末步=${stepTotals.at(-1)} totalTokens=${snap.totalTokens}`,
    );

    const deltaSum = (snap.steps ?? []).reduce(
      (a: number, s: any) => a + (s.inputTokens ?? 0) + (s.outputTokens ?? 0),
      0,
    );
    check(
      '各步 input+output 增量之和等于顶层 totalTokens',
      deltaSum === snap.totalTokens,
      `Σ(in+out)=${deltaSum} totalTokens=${snap.totalTokens}`,
    );

    const hasToolStep = (snap.steps ?? []).some(
      (s: any) => s.stepType === 'tool' || (s.events ?? []).some((e: any) => String(e.type).includes('tool')),
    );
    check('工具场景下快照记录到工具事件', hasToolStep, `stepTypes=${(snap.steps ?? []).map((s: any) => s.stepType).join(',')}`);

    console.info(
      `\n    最新快照: ${newest}` +
        `\n    步数 ${snap.totalSteps} / tokens ${snap.totalTokens} / cost $${snap.totalCost}` +
        `\n    完成原因 ${snap.completionReason}`,
    );
  }

  console.info('\n▶ 🐛 latest.json 的可移植性问题');

  const latest = join(TRACING_DIR, 'latest.json');
  const latestExists = existsSync(latest);

  if (latestExists) {
    check('latest.json 存在（该平台可建符号链接）', true, `${statSync(latest).size} bytes`);
  } else {
    console.info('    latest.json 不存在。服务端日志中对应的是：');
    console.info("    snapshot finalization failed: EPERM: operation not permitted, symlink ... -> latest.json");
    console.info('    Windows 非提权进程无法创建符号链接；错误被 catch，运行不受影响。');
    console.info('    但 PLAN.md 检查点 9 断言的正是这个文件 —— 在 Windows 上该断言不可能成立。');
    // Recorded as a finding, not a pass: the file genuinely is not there.
    check(
      'latest.json 生成（PLAN.md 检查点 9 的断言）',
      false,
      'Windows 非提权下 symlink EPERM —— 建议改用复制或写入指针文件',
    );
  }

  summary();
};

main().catch((error) => {
  console.error('\n❌ f14-observability 脚本异常:', error);
  process.exitCode = 1;
});
