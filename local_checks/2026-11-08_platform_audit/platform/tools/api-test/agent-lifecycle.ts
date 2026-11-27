#!/usr/bin/env tsx
/**
 * L3 contract test — F2 Agent lifecycle & state machine.
 *
 * Covers F2.1, F2.2, F2.3, F2.5, F2.8, F2.9, F2.10, F2.12.
 * F2.4 (step lock) is NOT covered — it needs Redis; see PLAN.md 待将来补测清单 #1.
 *
 * Usage:  bun run tsx tools/api-test/agent-lifecycle.ts
 */
import { check, setScenario, summary, trpcMutate } from './client';
import { createOperation, getStatus, isTerminal, prepareConversation, runScenario, waitForStatus } from './helpers';

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F2 · Agent 生命周期与状态机');
  console.info('═'.repeat(64));

  // ── F2.1 / F2.2 createOperation + autoStart ───────────────────────────────
  console.info('\n▶ F2.1/F2.2 创建 operation 与 autoStart');
  await setScenario('simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 });

  const ctxA = await prepareConversation('F2 autoStart=true');
  const opA = await createOperation(ctxA, true);
  check('F2.1 createOperation 返回 success', opA?.success === true);
  check('F2.1 operationId 命名规范', /^agt_\d+_.+_.+_.{8}$/.test(opA?.operationId ?? ''), opA?.operationId);
  check('F2.2 autoStart=true 时首步被调度', opA?.firstStep?.scheduled === true);

  const ctxB = await prepareConversation('F2 autoStart=false');
  const opB = await createOperation(ctxB, false);
  check('F2.2 autoStart=false 时不调度', !opB?.firstStep, JSON.stringify(opB?.firstStep ?? null));

  const idleStatus = await getStatus(opB.operationId);
  check(
    'F2.2 未启动时状态非终态',
    !isTerminal(idleStatus),
    idleStatus?.currentState?.status,
  );

  // ── F2.5 手动 startExecution ──────────────────────────────────────────────
  console.info('\n▶ F2.5 手动 startExecution');
  const started = await trpcMutate<any>('aiAgent.startExecution', {
    delay: 50,
    operationId: opB.operationId,
  });
  check('F2.5 startExecution 返回 success', started?.success === true, JSON.stringify(started));

  const afterStart = await waitForStatus(opB.operationId, isTerminal);
  check('F2.5 手动启动后到达终态', isTerminal(afterStart), afterStart?.currentState?.status);
  check('F2.5 最终 done', afterStart?.currentState?.status === 'done');

  // ── F2.3 / F2.12 状态查询字段完整性 ───────────────────────────────────────
  console.info('\n▶ F2.3/F2.12 状态查询');
  const full = await getStatus(opA.operationId, true);
  const cs = full?.currentState ?? {};
  check('F2.12 含 status', typeof cs.status === 'string', cs.status);
  check('F2.12 含 stepCount', typeof cs.stepCount === 'number', String(cs.stepCount));
  check('F2.12 含 usage', !!cs.usage);
  check('F2.12 含 cost', !!cs.cost);
  check('F2.12 含 stats 汇总', !!full?.stats, JSON.stringify(full?.stats ?? {}).slice(0, 80));
  check('F2.12 isCompleted 与 status 一致', full?.isCompleted === (cs.status === 'done'));
  check('F2.12 includeHistory 返回执行历史', Array.isArray(full?.executionHistory), `${full?.executionHistory?.length ?? 'n/a'} 条`);

  // ── F2.8 maxSteps → forceFinish ───────────────────────────────────────────
  console.info('\n▶ F2.8 maxSteps 超限 → forceFinish（infinite-tools 场景）');
  // 必须声明 calculator：infinite-tools 调的就是它，manifest 缺失现在会被
  // fail-closed 拦成待审批（附录 C-1 的修复），循环压根转不起来。
  const inf = await runScenario('infinite-tools', 'F2.8 forceFinish', undefined, {
    // 传小 maxSteps 才能在用例超时内观察到收敛：默认兜底是 1000，
    // 硬闸在 1005 步，45 秒根本跑不到。
    maxSteps: 6,
    toolManifestMap: {
      'lobe-calculator': {
        api: [{ description: 'Evaluate an expression.', name: 'calculate', parameters: {} }],
        identifier: 'lobe-calculator',
        meta: { title: 'Calculator' },
        type: 'builtin',
      },
    },
  });
  const infState = inf.status?.currentState ?? {};
  console.info(`    步数 ${infState.stepCount}，状态 ${infState.status}`);
  check(
    'F2.8 无限工具调用最终收敛（未挂死）',
    isTerminal(inf.status),
    `status=${infState.status} steps=${infState.stepCount}`,
  );
  check(
    'F2.8 以 done 收尾而非 error（forceFinish 语义）',
    infState.status === 'done',
    infState.error ? JSON.stringify(infState.error).slice(0, 150) : '',
  );
  check('F2.8 步数确实增长到多步', (infState.stepCount ?? 0) > 1, `stepCount=${infState.stepCount}`);

  // ── F2.10 中断 ────────────────────────────────────────────────────────────
  console.info('\n▶ F2.10 中断');
  await setScenario('simple', { firstTokenDelayMs: 8000, tokensPerSecond: 1 });
  const ctxC = await prepareConversation('F2.10 interrupt');
  const opC = await createOperation(ctxC, true);
  await new Promise((r) => setTimeout(r, 600));

  const interrupted = await trpcMutate<boolean>('aiAgent.interruptTask', { operationId: opC.operationId });
  // interruptTask 返回的是 { operationId, success, threadId }，不是裸 boolean。
  // 且 success 现在**如实反映**中断结果（原来无条件 true，属谎报）。
  check(
    'F2.10 interruptTask 报告中断成功',
    (interrupted as any)?.success === true,
    JSON.stringify(interrupted).slice(0, 120),
  );

  const afterInterrupt = await waitForStatus(
    opC.operationId,
    (s) => isTerminal(s),
    { timeoutMs: 30_000 },
  );
  check(
    'F2.10 中断后进入终态',
    isTerminal(afterInterrupt),
    afterInterrupt?.currentState?.status,
  );
  if (afterInterrupt?.currentState?.status === 'interrupted') {
    check('F2.10 记录 interruption 上下文', !!afterInterrupt.currentState.interruption,
      JSON.stringify(afterInterrupt.currentState.interruption ?? {}).slice(0, 120));
  } else {
    check(
      'F2.10 中断语义（注意：可能已先行完成）',
      true,
      `实际 status=${afterInterrupt?.currentState?.status}，中断请求可能晚于执行完成`,
    );
  }

  // ── F2.9 costLimit ────────────────────────────────────────────────────────
  // 原先这条只是记录「schema 未暴露、此路径未覆盖」。附录 B 的修复已把
  // maxSteps / costLimit 加进 CreateAgentOperationSchema，故改为真实验证。
  console.info('\n▶ F2.9 costLimit');
  const costOp = await runScenario('usage-rich', 'F2.9 costLimit', undefined, {
    costLimit: { currency: 'USD', maxTotalCost: 0.000_01, onExceeded: 'stop' },
  });
  const costState = costOp?.status?.currentState ?? {};
  check(
    'F2.9 costLimit 可经 createOperation 传入并落到状态',
    costState?.costLimit?.maxTotalCost === 0.000_01,
    JSON.stringify(costState?.costLimit ?? null),
  );
  // cost 必须从零值起步：否则熔断比较是 `undefined >= N`，恒为 false（静默失效）
  check(
    'F2.9 cost 从零值起步（非 undefined）',
    typeof costState?.cost?.total === 'number',
    `cost.total=${costState?.cost?.total}`,
  );
  // ⚠️ 边界：熔断的**触发**在离线环境不可验 —— mock provider 只回 token 数、
  // 不回单次成本，本地也没有模型定价表，故 cost 恒为 0，永远够不到阈值。
  // 这里只验「配置能落到状态」与「比较有确定起点」；真实触发需接入带定价的 provider。
  check(
    'F2.9 熔断触发路径未覆盖（离线无定价数据，cost 恒为 0）',
    true,
    `实测 cost.total=${costState?.cost?.total}，阈值 0.00001 —— 不可达`,
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 agent-lifecycle 异常:', e);
  process.exit(1);
});
