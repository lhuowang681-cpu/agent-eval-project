/**
 * L2 服务集成 —— 中断标记（打真 Redis）。
 *
 * 这一层守的是**附录 B-2 修复赖以成立的前提**。那条缺陷的形态是：
 * `interruptTask` 返回成功，agent 却照常从 372 步涨到 564 步，最后只能杀进程。
 *
 * 根因是丢失更新 —— 中断只写进 `AgentState.status`，而正在执行的那一步在开始时
 * 已把 state 读进内存，结束时用自己那份**整体覆盖**写回，落在中间的中断被冲掉。
 * 修复是把中断标记与 state **分开存放**，只被 set/read/clear、不参与状态覆盖。
 *
 * 「分开存放」这件事在 L1 mock 层是假的（内存对象随便怎么写都不冲突），
 * 在 L3 HTTP 层又看不见（只能观察到最终步数，无法区分是修好了还是恰好没撞上窗口）。
 * 只有在这一层用真 Redis + 真覆盖写，才能把它钉死。
 *
 * 前置：真 Redis（REDIS_URL）。本文件不需要 PostgreSQL。
 * 运行：bunx vitest run --config vitest.local.config.mts tests/local/interruptFlag.integration.test.ts
 */
import type { AgentState } from '@lobechat/agent-runtime';
import { UsageCounter } from '@lobechat/agent-runtime';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentStateManager } from '@/server/modules/AgentRuntime/AgentStateManager';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const OP = `agt_l2_interrupt_${Date.now()}`;

const makeState = (over: Partial<AgentState> = {}): AgentState =>
  ({
    cost: UsageCounter.createDefaultCost(),
    messages: [],
    status: 'running',
    stepCount: 0,
    usage: {},
    ...over,
  }) as unknown as AgentState;

describe('中断标记（真 Redis）', () => {
  let mgr: AgentStateManager;

  beforeAll(() => {
    if (!getAgentRuntimeRedisClient()) {
      throw new Error('需要真 Redis：请设置 REDIS_URL 且不要设 DISABLE_REDIS');
    }
    mgr = new AgentStateManager();
  });

  afterAll(async () => {
    const client = getAgentRuntimeRedisClient();
    if (!client) return;
    // 只清本用例造的键，绝不 FLUSHALL —— 本机 Redis 是共享实例
    const keys = await client.keys(`*${OP}*`);
    if (keys.length) await client.del(...keys);
  });

  it('标记不被 state 的整体覆盖写冲掉（B-2 的核心）', async () => {
    const op = `${OP}_overwrite`;
    await mgr.saveAgentState(op, makeState({ stepCount: 1 }));

    await mgr.markInterrupted(op);
    expect(await mgr.isInterrupted(op)).toBe(true);

    // 模拟「正在跑的那一步」用自己内存里的旧 state 整体覆盖写回 ——
    // 注意这份 state 完全不含任何中断信息，正是丢失更新的形态。
    await mgr.saveAgentState(op, makeState({ status: 'running', stepCount: 2 }));

    // 修复前：中断信息随 state 一起被冲掉；修复后：标记独立存放，纹丝不动
    expect(await mgr.isInterrupted(op)).toBe(true);
  });

  it('跨实例可见 —— queue 模式下每步可能落在不同进程', async () => {
    const op = `${OP}_cross`;

    // 两个互相独立的 manager 实例，模拟两个进程
    const writer = new AgentStateManager();
    const reader = new AgentStateManager();

    expect(await reader.isInterrupted(op)).toBe(false);
    await writer.markInterrupted(op);

    // 若标记存在进程内存里（而非 Redis），这里会读到 false —— 那正是
    // queue 模式下「中断了但下一步照跑」的成因
    expect(await reader.isInterrupted(op)).toBe(true);
  });

  it('带 TTL，不会在 Redis 里堆积', async () => {
    const op = `${OP}_ttl`;
    await mgr.markInterrupted(op);

    const client = getAgentRuntimeRedisClient()!;
    const keys = await client.keys(`*${op}*`);
    expect(keys.length).toBeGreaterThan(0);

    const ttl = await client.ttl(keys[0]);
    // 与 state 一致的 2h；给足容差，只断言「有限且量级正确」
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2 * 60 * 60);
  });

  it('clearInterrupt 可清除，支持重新调度', async () => {
    const op = `${OP}_clear`;
    await mgr.markInterrupted(op);
    expect(await mgr.isInterrupted(op)).toBe(true);

    await mgr.clearInterrupt(op);
    expect(await mgr.isInterrupted(op)).toBe(false);
  });

  it('写标记失败必须抛出 —— 不能 fail-open 谎报「中断成功」', async () => {
    const op = `${OP}_write_fail`;
    const client = getAgentRuntimeRedisClient()!;

    const spy = vi.spyOn(client, 'setex').mockRejectedValueOnce(new Error('boom'));

    // 这里若被吞成静默成功，用户会看到「已中断」而 agent 继续烧钱 ——
    // 正是 B-2 的用户可见症状。
    await expect(mgr.markInterrupted(op)).rejects.toThrow();

    spy.mockRestore();
  });

  it('读标记失败按「未中断」处理 —— 不因 Redis 抖动误杀正常运行', async () => {
    const op = `${OP}_read_fail`;
    const client = getAgentRuntimeRedisClient()!;

    await mgr.markInterrupted(op);

    const spy = vi.spyOn(client, 'exists').mockRejectedValueOnce(new Error('boom'));

    // 与写路径相反：读失败宁可多跑一步，真正的兜底是硬步数闸。
    // 这条与上一条构成一对 —— 同一个模块里两个方向的失败策略是**故意不同**的。
    await expect(mgr.isInterrupted(op)).resolves.toBe(false);

    spy.mockRestore();

    // 抖动过去后应恢复读到真实值，证明上面返回 false 只是降级、没有破坏状态
    expect(await mgr.isInterrupted(op)).toBe(true);
  });
});
