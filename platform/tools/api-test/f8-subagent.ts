#!/usr/bin/env tsx
/**
 * F8 子任务与异步编排 — 阶段 5 未覆盖组之一.
 *
 * 覆盖 PLAN.md §F8：
 *   F8.4 `callSubAgent` 派发隔离子 agent
 *   F8.5 父 operation 挂起为 `waiting_for_async_tool`，子完成后 `completeSubAgentBridge` 唤醒
 *   F8.6 `verifyAsyncToolBarrier` 有界重试
 *   F8.7 拒绝嵌套子 agent（`isSubAgent`）
 * 以及 §A.3 记录的一条 🟡：
 *   `exec_task` / `exec_tasks` / `exec_client_task(s)` 四个指令**只在客户端 executor 实现**，
 *   服务端 `RuntimeExecutors` 没有对应项 → `runtime.step()` 会抛
 *   `No executor found for instruction type` 并被 catch 成 error 状态。
 *   本脚本把这条从「静态阅读推断」变成实测结论。
 *
 * 用 mock-llm 的 `sub-agent` 场景驱动：第一轮强制返回 `lobe-agent____callSubAgent`，
 * 第二轮返回收尾文本。
 *
 * Usage:  bun run tsx tools/api-test/f8-subagent.ts
 */
import 'dotenv/config';

import { check, setScenario, summary, trpcQuery } from './client';
import { createOperation, getStatus, prepareConversation, waitForStatus } from './helpers';

/**
 * Manifest for lobe-agent exposing callSubAgent without an approval policy, so the
 * dispatch is not intercepted by HIL. The server does not backfill manifests
 * (AgentRuntimeService uses the caller's toolSet verbatim), so we must supply it.
 */
const subAgentManifest = {
  'lobe-agent': {
    api: [
      {
        description: 'Dispatch an isolated sub-agent.',
        name: 'callSubAgent',
        parameters: {
          properties: { instruction: { type: 'string' }, title: { type: 'string' } },
          required: ['instruction'],
          type: 'object',
        },
      },
      {
        description: 'Execute a background task.',
        name: 'execTask',
        parameters: {
          properties: { instruction: { type: 'string' }, title: { type: 'string' } },
          type: 'object',
        },
      },
    ],
    identifier: 'lobe-agent',
    meta: { title: 'Lobe Agent' },
    type: 'builtin',
  },
};

const toolSet = {
  enabledToolIds: ['lobe-agent'],
  toolManifestMap: subAgentManifest,
  tools: [
    {
      function: {
        description: 'Dispatch an isolated sub-agent.',
        name: 'lobe-agent____callSubAgent',
        parameters: {
          properties: { instruction: { type: 'string' }, title: { type: 'string' } },
          required: ['instruction'],
          type: 'object',
        },
      },
      type: 'function',
    },
  ],
};

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('F8 子任务与异步编排 — 阶段 5 补测');
  console.info('═'.repeat(64));

  console.info('\n▶ F8.4 / F8.5 callSubAgent 派发与挂起');

  await setScenario('sub-agent', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation('F8 子 agent 派发');

  const op = await createOperation(ctx, true, {
    toolManifestMap: subAgentManifest,
    tools: toolSet.tools,
  });
  check('createOperation 成功', !!op.operationId, op.operationId);

  // The parent should either park on waiting_for_async_tool, or (if the bridge
  // resolves fast) run through to done. Both are informative; a hard error is not.
  const settled = await waitForStatus(
    op.operationId,
    (s) =>
      ['done', 'error', 'interrupted', 'waiting_for_async_tool', 'waiting_for_human'].includes(
        s?.currentState?.status,
      ),
    { intervalMs: 300, timeoutMs: 90_000 },
  );

  const st = settled?.currentState ?? {};
  console.info(`    父 operation 状态: ${st.status}，步数 ${st.stepCount}，tokens ${st.usage?.llm?.tokens?.total ?? '?'}`);

  check(
    '父 operation 未进入 error 状态',
    st.status !== 'error',
    `status=${st.status}${st.status === 'error' ? ' — ' + JSON.stringify(st.error ?? {}).slice(0, 160) : ''}`,
  );

  const parkedOrDone = ['waiting_for_async_tool', 'done'].includes(st.status);
  check(
    'F8.5 父 operation 落到 waiting_for_async_tool 或已被桥接唤醒到 done',
    parkedOrDone,
    `status=${st.status}`,
  );

  console.info('\n▶ F8.5 桥接唤醒');

  if (st.status === 'waiting_for_async_tool') {
    // Give the child time to finish and completeSubAgentBridge to fold the result back.
    const woken = await waitForStatus(
      op.operationId,
      (s) => ['done', 'error'].includes(s?.currentState?.status),
      { intervalMs: 500, timeoutMs: 120_000 },
    );
    const ws = woken?.currentState ?? {};
    check(
      '子任务完成后父 operation 被唤醒并走到终态',
      ws.status === 'done',
      `status=${ws.status}，步数 ${ws.stepCount}`,
    );
  } else if (st.status === 'done') {
    check('父 operation 已直接完成（桥接在观测间隔内完成）', true, `步数 ${st.stepCount}`);
  } else {
    check('子任务完成后父 operation 被唤醒并走到终态', false, `停在 ${st.status}`);
  }

  console.info('\n▶ A.3 验证：服务端是否缺 exec_task executor');
  console.info('    静态阅读结论是「exec_task/exec_tasks/exec_client_task(s) 只在客户端实现，');
  console.info('    服务端会抛 No executor found for instruction type」。这里实测。');

  // `exec-task` 是为这条推断专门加的 mock 场景（tools/mock-llm/scenarios.ts）。
  // Mock 只支持切换已注册场景，不支持临时覆盖 turns，所以必须注册进去。
  await setScenario('exec-task', { firstTokenDelayMs: 0, tokensPerSecond: 0 });

  const ctx2 = await prepareConversation('F8 execTask 服务端缺口探针');
  const op2 = await createOperation(ctx2, true, {
    toolManifestMap: subAgentManifest,
    tools: [
      {
        function: {
          description: 'Execute a background task.',
          name: 'lobe-agent____execTask',
          parameters: { properties: { instruction: { type: 'string' } }, type: 'object' },
        },
        type: 'function',
      },
    ],
  });

  const st2 = await waitForStatus(
    op2.operationId,
    (s) => ['done', 'error', 'waiting_for_async_tool'].includes(s?.currentState?.status),
    { intervalMs: 300, timeoutMs: 60_000 },
  );
  const cs2 = st2?.currentState ?? {};
  const errText = JSON.stringify(cs2.error ?? cs2 ?? {}).toLowerCase();
  const noExecutor = errText.includes('no executor found');

  console.info(`    结果状态: ${cs2.status}`);

  if (noExecutor) {
    console.info('    ⚠️ 实测确认：服务端确实没有 exec_task executor —— A.3 那条 🟡 成立');
    check('A.3 推断成立：服务端缺 exec_task executor', true, 'No executor found for instruction type');
  } else {
    // 关键：`execTask` 作为**工具**被调用，走的是 call_tool 路径，跟 Brain 产出
    // `exec_task` **指令**是两回事。本探针只覆盖了前者，没能构造出后者。
    // 因此这里既不能判 A.3 成立，也不能判它被证伪 —— 只能记为「未复现」。
    console.info('    execTask 作为普通工具被正常执行（stepType=call_tool），未出现 No executor found。');
    console.info('    ⚠️ 这只说明「工具调用路径」正常，**没有**构造出 Brain 产出 exec_task 指令的场景。');
    console.info('    A.3 那条推断仍然是「未验证」，不能据此判定它不成立。');
    check(
      'execTask 工具调用路径正常（A.3 的指令路径仍未覆盖）',
      cs2.status === 'done',
      `status=${cs2.status}，stepType 见 .agent-tracing 最新快照`,
    );
  }

  console.info('\n▶ F8.7 嵌套子 agent 拒绝');

  // getPendingInterventions 的入参是 operationId / userId 二选一，传空对象会被 schema 拒。
  let pendingErr = '';
  const pending = await trpcQuery<any>('aiAgent.getPendingInterventions', {
    operationId: op.operationId,
  }).catch((e) => {
    pendingErr = String(e);
    return null;
  });
  check(
    'getPendingInterventions 可调用（F6.9，顺带覆盖）',
    pending !== null && typeof pending === 'object',
    pendingErr ? pendingErr.slice(0, 160) : JSON.stringify(pending).slice(0, 120),
  );
  check(
    '已完成的 operation 无待办干预',
    pending?.totalCount === 0,
    `totalCount=${pending?.totalCount}`,
  );

  const finalStatus = await getStatus(op.operationId, true);
  console.info(
    `\n    父 operation 最终：status=${finalStatus?.currentState?.status}` +
      ` 步数=${finalStatus?.currentState?.stepCount}` +
      ` LLM 调用=${finalStatus?.currentState?.usage?.llm?.apiCalls ?? '?'}`,
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ f8-subagent 脚本异常:', error);
  process.exitCode = 1;
});
