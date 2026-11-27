#!/usr/bin/env tsx
/**
 * 附录 B / C 修复的回归验证。
 *
 * 对照的是修复前的实测基线：
 *   B-1  无默认步数上限 → 无限增长（1 分钟 173 万 tokens）
 *   B-2  interruptTask 返回成功但停不下来（372 → 564 步）
 *   B-3  status 恒为 idle，从不变 running
 *   C-1  不传 toolManifestMap → 审批被静默绕过、工具直接执行
 *   C-2  approve/reject 后 pendingToolsCalling 永不清除，永久 waiting_for_human
 *
 * Usage:  bun run tsx tools/api-test/fix-verify.ts
 */
import 'dotenv/config';

import { check, setScenario, summary, trpcMutate } from './client';
import { createOperation, getStatus, prepareConversation, waitForStatus } from './helpers';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 一个**不带 humanIntervention** 的 manifest。
 *
 * 为什么 B-1/B-2 必须传它：C-1 的修复让「manifest 缺失」变成 fail-closed，
 * 不传的话工具第一轮就被拦成待审批，循环压根转不起来，
 * 也就测不到 maxSteps 收敛和中断 —— 那是修复生效的副作用，不是这两项的结论。
 * 这里显式声明「该工具无需审批」，让循环自由地跑，才能验证收敛与中断。
 */
const autoRunManifest = {
  // infinite-tools 场景调的是 `lobe-calculator____calculate`
  'lobe-calculator': {
    api: [{ description: 'Evaluate an expression.', name: 'calculate', parameters: {} }],
    identifier: 'lobe-calculator',
    meta: { title: 'Calculator' },
    type: 'builtin',
  },
};


/** 轮询到满足条件或超时，返回最后一次状态。 */
const pollUntil = async (
  operationId: string,
  predicate: (s: any) => boolean,
  timeoutMs = 90_000,
) => {
  const deadline = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < deadline) {
    last = await getStatus(operationId);
    if (predicate(last)) return last;
    await sleep(1000);
  }
  return last;
};

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('附录 B / C 修复验证');
  console.info('═'.repeat(64));

  // ── B-1 / B-3 ───────────────────────────────────────────────────────────
  console.info('\n▶ B-1 maxSteps 收敛 + B-3 status 语义');
  console.info('  用 infinite-tools 场景（模型永远返回 tool_calls），显式传 maxSteps=6。');

  await setScenario('infinite-tools', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx1 = await prepareConversation('B-1 maxSteps 收敛');
  const op1 = await createOperation(ctx1, true, { maxSteps: 6, toolManifestMap: autoRunManifest });

  // 先抓一次 running（修复前这里恒为 idle）
  const runningSeen = await pollUntil(
    op1.operationId,
    (s) => s?.currentState?.status === 'running',
    20_000,
  );
  check(
    'B-3 执行期间 status 为 running（修复前恒为 idle）',
    runningSeen?.currentState?.status === 'running',
    `status=${runningSeen?.currentState?.status}`,
  );

  const settled1 = await pollUntil(
    op1.operationId,
    (s) => ['done', 'error', 'interrupted'].includes(s?.currentState?.status),
    120_000,
  );
  const cs1 = settled1?.currentState ?? {};
  console.info(`    最终: status=${cs1.status} 步数=${cs1.stepCount} tokens=${cs1.usage?.llm?.tokens?.total ?? '?'}`);

  check(
    'B-1 无限工具循环最终收敛到终态（修复前永不收敛）',
    ['done', 'error'].includes(cs1.status),
    `status=${cs1.status}`,
  );
  // 硬闸是 maxSteps + MAX_STEPS_GRACE(5)：给 forceFinish 留出「剥工具 → 再问一次 →
  // 拿到最终文本 → finish」的空间，模型不配合就在这里无条件停。
  // 6 + 5 = 11 正是设计值（修复前同样条件下跑到 106 步）。
  check(
    'B-1 步数被硬闸约束在 maxSteps + 余量内',
    (cs1.stepCount ?? 0) <= 6 + 5,
    `stepCount=${cs1.stepCount}（maxSteps=6，硬闸=11）`,
  );

  // ── B-2 ─────────────────────────────────────────────────────────────────
  console.info('\n▶ B-2 中断真正生效');
  console.info('  再起一个无限循环，不设 maxSteps（走服务端兜底 1000），中途中断。');

  const ctx2 = await prepareConversation('B-2 中断验证');
  const op2 = await createOperation(ctx2, true, { toolManifestMap: autoRunManifest });

  await pollUntil(op2.operationId, (s) => (s?.currentState?.stepCount ?? 0) >= 3, 40_000);
  const before = await getStatus(op2.operationId);
  const stepsBefore = before?.currentState?.stepCount ?? 0;
  console.info(`    中断前步数: ${stepsBefore}`);

  const interrupted = await trpcMutate<any>('aiAgent.interruptTask', {
    operationId: op2.operationId,
  });
  check('interruptTask 返回成功', interrupted?.success === true, JSON.stringify(interrupted).slice(0, 100));

  const stopped = await pollUntil(
    op2.operationId,
    (s) => s?.currentState?.status === 'interrupted',
    60_000,
  );
  check(
    'B-2 中断后状态变为 interrupted（修复前一直 running/idle）',
    stopped?.currentState?.status === 'interrupted',
    `status=${stopped?.currentState?.status}`,
  );

  // 关键：确认步数真的不再增长
  const stepsAtStop = stopped?.currentState?.stepCount ?? 0;
  await sleep(15_000);
  const after = await getStatus(op2.operationId);
  const stepsAfter = after?.currentState?.stepCount ?? 0;
  console.info(`    中断时步数=${stepsAtStop}，15 秒后=${stepsAfter}`);
  check(
    'B-2 中断后步数不再增长（修复前从 372 一路涨到 564）',
    stepsAfter === stepsAtStop,
    `${stepsAtStop} → ${stepsAfter}`,
  );

  // ── C-1 ─────────────────────────────────────────────────────────────────
  console.info('\n▶ C-1 不传 toolManifestMap 时审批是否仍被绕过');
  console.info('  修复前：不传 manifest → 待审 0 个、工具直接执行、status=done。');

  await setScenario('human-approval', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx3 = await prepareConversation('C-1 manifest 补全');
  // 故意不传 toolManifestMap —— schema 默认值就是 {}
  const op3 = await createOperation(ctx3);

  const settled3 = await pollUntil(
    op3.operationId,
    (s) => ['done', 'error', 'waiting_for_human'].includes(s?.currentState?.status),
    90_000,
  );
  const cs3 = settled3?.currentState ?? {};
  const pending3 = (cs3.pendingToolsCalling ?? []).length;
  console.info(`    status=${cs3.status} 待审=${pending3} 步数=${cs3.stepCount}`);

  check(
    'C-1 未传 manifest 时审批仍然生效（服务端已补全）',
    cs3.status === 'waiting_for_human' && pending3 > 0,
    `status=${cs3.status} 待审=${pending3}`,
  );

  // ── C-2 ─────────────────────────────────────────────────────────────────
  console.info('\n▶ C-2 approve 后能否恢复');

  if (cs3.status === 'waiting_for_human' && pending3 > 0) {
    const toolCall = cs3.pendingToolsCalling[0];
    const res = await trpcMutate<any>('aiAgent.processHumanIntervention', {
      action: 'approve',
      data: { approvedToolCall: toolCall },
      operationId: op3.operationId,
      stepIndex: cs3.stepCount ?? 0,
    });
    console.info(`    processHumanIntervention → ${JSON.stringify(res).slice(0, 120)}`);

    const resumed = await pollUntil(
      op3.operationId,
      (s) => ['done', 'error'].includes(s?.currentState?.status),
      90_000,
    );
    const cs4 = resumed?.currentState ?? {};
    console.info(`    approve 后: status=${cs4.status} 步数=${cs4.stepCount} 待审=${(cs4.pendingToolsCalling ?? []).length}`);

    check(
      'C-2 approve 后 pendingToolsCalling 被清除（修复前永不清除）',
      (cs4.pendingToolsCalling ?? []).length === 0,
      `待审=${(cs4.pendingToolsCalling ?? []).length}`,
    );
    check(
      'C-2 approve 后走出 waiting_for_human 并到达终态（修复前永久卡住）',
      ['done', 'error'].includes(cs4.status),
      `status=${cs4.status}`,
    );
  } else {
    check('C-2 approve 后能恢复', false, '前置未拦截，无法验证');
  }

  summary();
};

main().catch((error) => {
  console.error('\n❌ fix-verify 脚本异常:', error);
  process.exitCode = 1;
});
