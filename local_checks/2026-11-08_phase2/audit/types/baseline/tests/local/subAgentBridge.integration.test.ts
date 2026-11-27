/**
 * L2 服务集成 —— 子 agent 桥接的 CAS 唤醒（打真 PostgreSQL）。
 *
 * 场景：父 operation 派出子任务后挂起在 `waiting_for_async_tool`，
 * 由子任务完成时把它唤醒。问题在于**可能有多个完成者同时来唤醒**：
 * 并行的多个子任务、QStash 的重投、以及有界重试 `maybeScheduleAsyncToolVerify`
 * ——它们都会走到 `tryResumeFromAsyncTool`。
 *
 * 唤醒必须**恰好发生一次**：赢家继续调度下一步，输家安静退出。
 * 若多个都赢，父 operation 会被重复调度，同一步跑多遍。
 *
 * 这条只有 L2 能验：
 *   · L1 mock 里 `update ... where status = 'waiting_for_async_tool'` 是假的，
 *     并发语义全靠 mock 自己编，验不出真正的原子性；
 *   · L3 从 HTTP 打进来构造不出「两个完成者精确同时到达」的时序。
 * 它依赖的是**数据库行级锁**：条件更新 + RETURNING，只有一个事务能匹配到那一行。
 *
 * 前置：真 PostgreSQL（DATABASE_URL）。本文件不需要 Redis。
 * 运行：bunx vitest run --config vitest.local.config.mts tests/local/subAgentBridge.integration.test.ts
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { agentOperations } from '@/database/schemas';

import { closeRealDB, getRealDB } from './realDb';

const USER_ID = 'offline-dev-user';
const OP_PREFIX = `agt_l2_bridge_${Date.now()}`;

describe('子 agent 桥接 CAS 唤醒（真 PostgreSQL）', () => {
  let db: ReturnType<typeof getRealDB>;
  let model: AgentOperationModel;
  const created: string[] = [];

  const seedParked = async (suffix: string): Promise<string> => {
    const id = `${OP_PREFIX}_${suffix}`;
    await db.insert(agentOperations).values({
      id,
      status: 'waiting_for_async_tool',
      userId: USER_ID,
    } as any);
    created.push(id);
    return id;
  };

  beforeAll(() => {
    db = getRealDB();
    model = new AgentOperationModel(db as any, USER_ID);
  });

  afterAll(async () => {
    // 只清本用例造的行
    for (const id of created) {
      await db.delete(agentOperations).where(eq(agentOperations.id, id));
    }
    await closeRealDB();
  });

  it('并发唤醒恰好一个成功', async () => {
    const id = await seedParked('concurrent');

    // 6 个完成者同时抢同一个父 operation
    const results = await Promise.all(
      Array.from({ length: 6 }, () => model.tryResumeFromAsyncTool(id)),
    );

    const winners = results.filter(Boolean).length;

    // 多于 1 → 父 operation 会被重复调度，同一步跑多遍
    // 少于 1 → 父 operation 永远醒不过来，卡死在 waiting_for_async_tool
    expect(winners).toBe(1);

    const [row] = await db.select().from(agentOperations).where(eq(agentOperations.id, id));
    expect(row.status).toBe('running');
  });

  it('已经不在 waiting_for_async_tool 的父不会被再次唤醒', async () => {
    const id = await seedParked('already_running');
    expect(await model.tryResumeFromAsyncTool(id)).toBe(true);

    // 第二次（典型来源：QStash 重投，或有界重试兜底跑了一轮）必须落空
    expect(await model.tryResumeFromAsyncTool(id)).toBe(false);
  });

  it('跨用户不可唤醒 —— CAS 条件里带 userId', async () => {
    const id = await seedParked('cross_user');

    const otherUser = new AgentOperationModel(db, 'some-other-user');
    expect(await otherUser.tryResumeFromAsyncTool(id)).toBe(false);

    // owner 仍然能正常唤醒，证明上面失败是租户隔离、不是行本身有问题
    expect(await model.tryResumeFromAsyncTool(id)).toBe(true);
  });

  it('不存在的 operation 返回 false 而非抛错', async () => {
    expect(await model.tryResumeFromAsyncTool(`${OP_PREFIX}_nonexistent`)).toBe(false);
  });
});
