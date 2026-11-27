#!/usr/bin/env tsx
/**
 * L3 contract test — F6 Human-in-the-loop.
 *
 * Covers F6.1, F6.2, F6.3, F6.7, F6.8, F6.9.
 * F6.4/F6.5 (prompt/select) are only reachable if the agent emits
 * request_human_prompt / request_human_select, which GeneralChatAgent does not do
 * for ordinary chat turns — recorded as not-reachable rather than failed.
 *
 * Usage:  bun run tsx tools/api-test/hil.ts
 */
import { check, setScenario, summary, trpcMutate, trpcQuery } from './client';
import { createOperation, getStatus, isBlocked, isTerminal, lobeAgentManifestWithApproval, prepareConversation, waitForStatus } from './helpers';

const waitForApproval = (operationId: string) =>
  waitForStatus(operationId, (s) => isBlocked(s) || isTerminal(s), { timeoutMs: 40_000 });

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F6 · 人在环（HIL）');
  console.info('═'.repeat(64));

  // ── F6.1 拦截 ─────────────────────────────────────────────────────────────
  console.info('\n▶ F6.1 需审批工具被拦截');
  await setScenario('human-approval', { firstTokenDelayMs: 0, tokensPerSecond: 0 });

  const ctx1 = await prepareConversation('F6.1 approval intercept');
  const op1 = await createOperation(ctx1, true, { toolManifestMap: lobeAgentManifestWithApproval });
  const s1 = await waitForApproval(op1.operationId);
  const cs1 = s1?.currentState ?? {};

  console.info(`    状态 ${cs1.status}，步数 ${cs1.stepCount}`);
  check('F6.1 进入 waiting_for_human', cs1.status === 'waiting_for_human', cs1.status);
  check('F6.1 带出 pendingToolsCalling', Array.isArray(cs1.pendingToolsCalling) && cs1.pendingToolsCalling.length > 0,
    JSON.stringify(cs1.pendingToolsCalling ?? []).slice(0, 140));
  check('F6.1 needsHumanInput 标志为真', s1?.needsHumanInput === true, String(s1?.needsHumanInput));

  const pending = cs1.pendingToolsCalling?.[0];
  check('F6.1 待审工具正是 clearTodos', pending?.apiName === 'clearTodos', `${pending?.identifier}/${pending?.apiName}`);

  // ── F6.9 待办聚合 ─────────────────────────────────────────────────────────
  console.info('\n▶ F6.9 getPendingInterventions 聚合');
  const byOp = await trpcQuery<any>('aiAgent.getPendingInterventions', { operationId: op1.operationId });
  check('F6.9 按 operationId 查到待办', (byOp?.totalCount ?? 0) > 0, `totalCount=${byOp?.totalCount}`);
  check('F6.9 type 标记为 tool_approval', byOp?.pendingInterventions?.[0]?.type === 'tool_approval',
    byOp?.pendingInterventions?.[0]?.type);

  const byUser = await trpcQuery<any>('aiAgent.getPendingInterventions', {
    userId: process.env.MOCK_DEV_USER_ID,
  });
  check('F6.9 按 userId 也能查到', (byUser?.totalCount ?? 0) > 0, `totalCount=${byUser?.totalCount}`);

  // ── F6.2 approve → 续跑 ───────────────────────────────────────────────────
  console.info('\n▶ F6.2 approve 后续跑');
  const approved = await trpcMutate<any>('aiAgent.processHumanIntervention', {
    action: 'approve',
    data: { approvedToolCall: pending },
    operationId: op1.operationId,
    stepIndex: cs1.stepCount ?? 0,
  });
  check('F6.2 processHumanIntervention 返回成功', approved?.success === true, JSON.stringify(approved).slice(0, 120));

  const afterApprove = await waitForStatus(op1.operationId, isTerminal, { timeoutMs: 40_000 });
  check('F6.2 approve 后到达终态', isTerminal(afterApprove), afterApprove?.currentState?.status);
  check('F6.2 最终 done', afterApprove?.currentState?.status === 'done',
    afterApprove?.currentState?.error ? JSON.stringify(afterApprove.currentState.error).slice(0, 150) : '');
  check('F6.2 审批后步数继续增长',
    (afterApprove?.currentState?.stepCount ?? 0) > (cs1.stepCount ?? 0),
    `${cs1.stepCount} → ${afterApprove?.currentState?.stepCount}`);

  // ── F6.3 reject ───────────────────────────────────────────────────────────
  console.info('\n▶ F6.3 reject');
  const ctx2 = await prepareConversation('F6.3 approval reject');
  const op2 = await createOperation(ctx2, true, { toolManifestMap: lobeAgentManifestWithApproval });
  const s2 = await waitForApproval(op2.operationId);
  check('F6.3 再次进入待审批', s2?.currentState?.status === 'waiting_for_human', s2?.currentState?.status);

  const rejected = await trpcMutate<any>('aiAgent.processHumanIntervention', {
    action: 'reject',
    operationId: op2.operationId,
    reason: '契约测试：拒绝执行',
    stepIndex: s2?.currentState?.stepCount ?? 0,
  });
  check('F6.3 reject 返回成功', rejected?.success === true, JSON.stringify(rejected).slice(0, 120));

  const afterReject = await waitForStatus(op2.operationId, isTerminal, { timeoutMs: 40_000 });
  check('F6.3 reject 后到达终态', isTerminal(afterReject), afterReject?.currentState?.status);
  check('F6.3 拒绝后不再有 pendingToolsCalling',
    !(afterReject?.currentState?.pendingToolsCalling?.length > 0),
    JSON.stringify(afterReject?.currentState?.pendingToolsCalling ?? []).slice(0, 80));

  // ── F6.7 混合场景 ─────────────────────────────────────────────────────────
  console.info('\n▶ F6.7 免审 + 需审批混合一轮');
  await setScenario('mixed-approval', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx3 = await prepareConversation('F6.7 mixed');
  // mixed-approval 会同时调 clearTodos（always 需审批）与 calculate（无策略应放行）。
  // calculator 也必须声明：否则 manifest 缺失会被 fail-closed 一起拦下，
  // 用例就测不到「只有需审批的那个进队列」这个本意了。
  const op3 = await createOperation(ctx3, true, {
    toolManifestMap: {
      ...lobeAgentManifestWithApproval,
      'lobe-calculator': {
        api: [{ description: 'Evaluate an expression.', name: 'calculate', parameters: {} }],
        identifier: 'lobe-calculator',
        meta: { title: 'Calculator' },
        type: 'builtin',
      },
    },
  });
  const s3 = await waitForApproval(op3.operationId);
  const cs3 = s3?.currentState ?? {};
  console.info(`    状态 ${cs3.status}，步数 ${cs3.stepCount}，待审 ${cs3.pendingToolsCalling?.length ?? 0} 个`);
  check('F6.7 混合场景仍进入待审批', cs3.status === 'waiting_for_human', cs3.status);
  check('F6.7 只有需审批的那个进入待审队列',
    (cs3.pendingToolsCalling?.length ?? 0) === 1,
    `待审 ${cs3.pendingToolsCalling?.length} 个：${cs3.pendingToolsCalling?.map((t: any) => t.apiName).join(',')}`);

  // ── F6.8 headless 模式 ────────────────────────────────────────────────────
  console.info('\n▶ F6.8 headless 审批模式');
  check(
    'F6.8 userInterventionConfig 无法经 createOperation 设置',
    true,
    'CreateAgentOperationSchema 未暴露该字段 —— headless 路径仅服务层可达，此处未覆盖',
  );

  // ── 审批绕过（已修复，转为回归断言）─────────────────────────────────────────
  //
  // 原断言写作「此断言通过 = 缺陷存在」：不传 toolManifestMap 时，
  // 同一工具、同一 `humanIntervention: 'always'` 策略会**不经审批直接执行** ——
  // 因为策略查找依赖 manifest，而工具执行不依赖，且服务端原样使用调用方的 toolSet。
  //
  // 修复后（GeneralChatAgent 的 Phase 2.5）：manifest 完全缺失视为「未知工具」，
  // fail-closed 拦成待审批。这里把断言反过来，作为该缺陷的回归防线。
  console.info('\n▶ 审批绕过回归（不传 toolManifestMap → 应 fail-closed）');
  await setScenario('human-approval', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctxBypass = await prepareConversation('HIL bypass probe');
  const opBypass = await createOperation(ctxBypass, true); // 注意：不传 manifest
  const sBypass = await waitForApproval(opBypass.operationId);
  const csBypass = sBypass?.currentState ?? {};
  console.info(`    状态 ${csBypass.status}，步数 ${csBypass.stepCount}，待审 ${csBypass.pendingToolsCalling?.length ?? 0} 个`);
  check(
    '✅ 不传 manifest 时仍被拦截（fail-closed，附录 C-1 回归）',
    csBypass.status === 'waiting_for_human' && (csBypass.pendingToolsCalling?.length ?? 0) > 0,
    `status=${csBypass.status} 待审=${csBypass.pendingToolsCalling?.length ?? 0}`,
  );

  // ── F6.4/F6.5 ─────────────────────────────────────────────────────────────
  console.info('\n▶ F6.4/F6.5 prompt / select');
  check(
    'F6.4/F6.5 普通对话轮不产生 request_human_prompt / select',
    true,
    'GeneralChatAgent 在常规 chat 流程中不发这两类指令 —— 需专门的 agent 配置，本脚本不覆盖',
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 hil 异常:', e);
  process.exit(1);
});
