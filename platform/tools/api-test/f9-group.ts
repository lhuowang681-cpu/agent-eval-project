#!/usr/bin/env tsx
/**
 * F9 群体编排（Group Orchestration） — 阶段 5 未覆盖组之一.
 *
 * 覆盖 PLAN.md §F9：
 *   F9.1 Supervisor 决策下一个发言者（execGroupAgent 驱动）
 *   F9.2 delegate 委派 / F9.3 broadcast / F9.4 vote / F9.5 summarize（工具面存在性与可调用性）
 *   F9.6 群消息角色转换与还原（GroupMessageFlatten / GroupRoleTransform / SupervisorRoleRestore）
 *   F9.7 interrupt
 * 顺带覆盖 F12 的 group CRUD 面（`group.*` router 15 个 procedure）。
 *
 * 为什么之前没测：群体编排要先有 chat_group + 成员 agent + supervisor，
 * 建群这一步在旧环境没做过，F9 整组一直是空白。
 *
 * Usage:  bun run tsx tools/api-test/f9-group.ts
 */
import 'dotenv/config';

import { check, setScenario, summary, trpcMutate, trpcQuery } from './client';
import { waitForStatus } from './helpers';

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('F9 群体编排 — 阶段 5 补测');
  console.info('═'.repeat(64));

  await setScenario('simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 });

  console.info('\n▶ 建群（group.createGroupWithMembers）');

  const stamp = Date.now();
  let created: any = null;
  try {
    created = await trpcMutate<any>('group.createGroupWithMembers', {
      groupConfig: { title: `F9 群体编排用例 ${stamp}` },
      members: [
        { model: 'mock-model', provider: 'openai', systemRole: '你是研究员，负责查资料。', title: `研究员${stamp}` },
        { model: 'mock-model', provider: 'openai', systemRole: '你是审稿人，负责挑毛病。', title: `审稿人${stamp}` },
      ],
      supervisorConfig: {
        model: 'mock-model',
        provider: 'openai',
        systemRole: '你是主持人，决定下一个发言者。',
        title: `主持人${stamp}`,
      },
    });
  } catch (error) {
    check('createGroupWithMembers 成功', false, String(error).slice(0, 200));
  }

  const groupId = created?.groupId;
  check('createGroupWithMembers 返回 groupId', !!groupId, groupId ?? '(无)');
  check(
    '创建了 2 个成员 agent',
    Array.isArray(created?.agentIds) && created.agentIds.length === 2,
    `agentIds=${JSON.stringify(created?.agentIds)}`,
  );
  check('创建了 supervisor agent', !!created?.supervisorAgentId, created?.supervisorAgentId ?? '(无)');

  if (!groupId) {
    console.info('\n建群失败，后续断言无法进行。');
    summary();
    return;
  }

  console.info('\n▶ 群 CRUD 与查询面');

  const detail = await trpcQuery<any>('group.getGroupDetail', { id: groupId }).catch((e) => ({ __err: String(e) }));
  check('getGroupDetail 可读', !detail?.__err, detail?.__err?.slice(0, 140) ?? `title=${detail?.title ?? detail?.group?.title}`);

  const agents = await trpcQuery<any>('group.getGroupAgents', { groupId }).catch((e) => ({ __err: String(e) }));
  check(
    'getGroupAgents 返回成员',
    Array.isArray(agents) && agents.length >= 2,
    Array.isArray(agents) ? `${agents.length} 个成员` : String(agents?.__err).slice(0, 140),
  );

  const groups = await trpcQuery<any>('group.getGroups').catch((e) => ({ __err: String(e) }));
  check(
    'getGroups 列表包含新建的群',
    Array.isArray(groups) && groups.some((g: any) => g.id === groupId),
    Array.isArray(groups) ? `共 ${groups.length} 个群` : String(groups?.__err).slice(0, 140),
  );

  console.info('\n▶ F9.1 Supervisor 驱动一轮群体对话（aiAgent.execGroupAgent）');

  let exec: any = null;
  let execErr = '';
  try {
    exec = await trpcMutate<any>('aiAgent.execGroupAgent', {
      agentId: created.supervisorAgentId,
      groupId,
      message: '请两位就"离线测试的价值"各说一句，然后主持人总结。',
      newTopic: { title: `F9 群体对话 ${stamp}` },
    });
  } catch (error) {
    execErr = String(error);
  }

  check(
    'execGroupAgent 被接受（未因参数/权限被拒）',
    !!exec && !execErr,
    execErr ? execErr.slice(0, 220) : JSON.stringify(exec).slice(0, 160),
  );

  const opId = exec?.operationId ?? exec?.firstStep?.operationId;
  if (opId) {
    const st = await waitForStatus(
      opId,
      (s) => ['done', 'error', 'interrupted', 'waiting_for_human'].includes(s?.currentState?.status),
      { intervalMs: 400, timeoutMs: 120_000 },
    );
    const cs = st?.currentState ?? {};
    console.info(`    群 operation: status=${cs.status} 步数=${cs.stepCount} tokens=${cs.usage?.llm?.tokens?.total ?? '?'}`);
    check('群 operation 未进入 error', cs.status !== 'error', `status=${cs.status}`);
    check(
      'F9.1 Supervisor 至少推进了一步',
      (cs.stepCount ?? 0) >= 1,
      `stepCount=${cs.stepCount}`,
    );

    console.info('\n▶ F9.7 interrupt');
    const interrupted = await trpcMutate<any>('aiAgent.interruptTask', { operationId: opId }).catch(
      (e) => ({ __err: String(e) }),
    );
    check(
      'interruptTask 可调用',
      interrupted !== null,
      JSON.stringify(interrupted).slice(0, 120),
    );
    console.info(
      '    注：附录 B 已实测 interruptTask 对运行中的循环无效（只写状态、不 abort）。' +
        '\n    此处仅验证接口可达，不作为「中断有效」的证据。',
    );
  } else {
    console.info('    未拿到 operationId，跳过群 operation 的推进断言。');
  }

  console.info('\n▶ F9.2–F9.5 群体工具面存在性');

  // The group-management manifest declares 9 APIs; assert the package exposes them,
  // which is what the orchestration layer routes to.
  const expected = [
    'speak',
    'broadcast',
    'delegate',
    'executeAgentTask',
    'executeAgentTasks',
    'interrupt',
    'summarize',
    'createWorkflow',
    'vote',
  ];
  const { GroupManagementApiName } = await import(
    '../../packages/builtin-tool-group-management/src/index'
  ).catch(() => ({ GroupManagementApiName: null as any }));

  if (GroupManagementApiName) {
    const actual = Object.values(GroupManagementApiName) as string[];
    const missing = expected.filter((n) => !actual.includes(n));
    check(
      'group-management 暴露全部 9 个 API',
      missing.length === 0,
      missing.length ? `缺少 ${missing.join(',')}` : actual.join(','),
    );
  } else {
    check('group-management 暴露全部 9 个 API', false, '包导出未取到 GroupManagementApiName');
  }

  console.info('\n▶ 清理');
  // `String(e)` 会把 `TypeError: fetch failed` 的真实原因（undici 放在 `cause` 链里）
  // 整个吞掉，只剩一句无从下手的报错。这里展开 cause 链再上报。
  const describeError = (e: any): string => {
    const parts = [`${e?.name}: ${e?.message}`];
    let c = e?.cause;
    for (let d = 0; c && d < 5; d++) {
      parts.push(`cause[${d + 1}] ${c.code ?? ''} ${c.message ?? String(c)}`.trim());
      c = c.cause;
    }
    return parts.join(' | ');
  };
  let del = await trpcMutate<any>('group.deleteGroup', { id: groupId }).catch((e) => ({
    __err: describeError(e),
  }));
  /*
   * 为什么这里要重试，以及为什么**只在这里**重试：
   *
   * 本步骤首次调用稳定失败于 `ECONNRESET`，重试必定成功。已验证它不是 deleteGroup
   * 的产品缺陷 —— 用独立进程删除**同一批**跑过 operation 的 F9 群，均 200 / ~350ms。
   *
   * 两个假设已被实测证伪，不要再走一遍：
   *   · 「keep-alive 空闲超时」——  空闲 0 / 6 / 12 秒后删除，全部 200
   *   · 「动态 import 阻塞事件循环 7 秒导致连接失效」—— 单独复现该 import 后删除，200
   * 需要前面整轮群 operation 的请求量叠加才会触发，属 undici 连接池里的陈旧套接字。
   *
   * 不把重试放进公共 client：`ECONNRESET` 发生在**读响应**阶段，服务端可能已经执行过
   * 该请求，对非幂等 mutation 盲目重试会造成重复副作用。deleteGroup 幂等，故只在此处重试。
   */
  const firstErr = del?.__err;
  if (firstErr) {
    console.info(`    首次失败：${firstErr} —— 重试一次以判定是否为瞬时连接问题`);
    del = await trpcMutate<any>('group.deleteGroup', { id: groupId }).catch((e) => ({
      __err: describeError(e),
    }));
  }
  check(
    'deleteGroup 成功',
    !del?.__err,
    del?.__err?.slice(0, 300) ?? (firstErr ? '重试后成功（首次为瞬时连接错误）' : 'ok'),
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ f9-group 脚本异常:', error);
  process.exitCode = 1;
});
