/**
 * L2 服务集成 —— AgentStateManager 打真 Redis。
 *
 * 为什么需要 L2 这一层（05-functional-report 里它一直是 ⬜）：
 * L1 用 mock，L3 从 HTTP 打进去。中间有一类断言两边都够不着 ——
 * 典型就是**附录 A.1 的 `tryClaimStep` fail-open**：
 *
 *   HTTP 层构造不出来。Redis 全挂时请求止步于 `getOperationMetadata`（同样依赖 Redis），
 *   401 直接返回，`executeStep` 根本没被调到，fail-open 分支走不到
 *   （已在 tools/api-test/redis-failure.ts 实测确认）。
 *
 *   而 fail-open 的真实语义是「**元数据读取成功、恰好锁操作失败**」这种**局部/瞬时**错误 ——
 *   只有在这一层单独让 `redis.set` 抛错才能构造出来。
 *
 * 前置：真 Redis（REDIS_URL）。本文件不需要 PostgreSQL。
 * 运行：bunx vitest run --config vitest.local.config.mts tests/local/agentStateManager.integration.test.ts
 */
import type { AgentState } from '@lobechat/agent-runtime';
import { UsageCounter } from '@lobechat/agent-runtime';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentStateManager } from '@/server/modules/AgentRuntime/AgentStateManager';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const OP = `agt_l2_${Date.now()}`;

const makeState = (over: Partial<AgentState> = {}): AgentState =>
  ({
    // `AgentState.cost` 是 Cost 对象而非数字，写 0 会有类型错误（曾在基线里挂着）
    cost: UsageCounter.createDefaultCost(),
    messages: [],
    status: 'running',
    stepCount: 0,
    usage: {},
    ...over,
  }) as unknown as AgentState;

describe('AgentStateManager（真 Redis）', () => {
  let mgr: AgentStateManager;

  beforeAll(() => {
    const client = getAgentRuntimeRedisClient();
    if (!client) throw new Error('需要真 Redis：请设置 REDIS_URL 且不要设 DISABLE_REDIS');
    mgr = new AgentStateManager();
  });

  afterAll(async () => {
    const client = getAgentRuntimeRedisClient();
    if (!client) return; // beforeAll 已经失败过了，别再抛第二个错盖住真正的原因
    // 只清本用例造的键，绝不 FLUSHALL —— 本机 Redis 是共享实例（库里另有 rq:* 属其它应用）
    const keys = await client.keys(`*${OP}*`);
    if (keys.length) await client.del(...keys);
    await client.quit().catch(() => {});
  });

  describe('步锁', () => {
    it('同一 (operationId, stepIndex) 并发只有一个能拿到锁', async () => {
      const results = await Promise.all([mgr.tryClaimStep(OP, 0, 35), mgr.tryClaimStep(OP, 0, 35)]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('释放后可以重新认领', async () => {
      await mgr.releaseStepLock(OP, 0);
      await expect(mgr.tryClaimStep(OP, 0, 35)).resolves.toBe(true);
      await mgr.releaseStepLock(OP, 0);
    });

    it('不同 stepIndex 互不阻塞', async () => {
      const [a, b] = await Promise.all([mgr.tryClaimStep(OP, 1, 35), mgr.tryClaimStep(OP, 2, 35)]);
      expect(a).toBe(true);
      expect(b).toBe(true);
      await mgr.releaseStepLock(OP, 1);
      await mgr.releaseStepLock(OP, 2);
    });

    it('锁带 TTL（避免持有者崩溃后永久占用）', async () => {
      await mgr.tryClaimStep(OP, 3, 35);
      const client = getAgentRuntimeRedisClient()!;
      const ttl = await client.ttl(`agent_runtime_step_lock:${OP}:3`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(35);
      await mgr.releaseStepLock(OP, 3);
    });

    /**
     * 附录 A.1 那条 🟡 的判定 —— 本用例是它唯一可行的构造方式。
     *
     * `AgentStateManager.tryClaimStep` 的 catch 分支注释写着
     * "Fail-open: on Redis error, allow execution to proceed" 并 `return true`。
     * 让 redis.set 抛错，即可验证：**Redis 出错时锁形同虚设，两个并发都会放行**。
     */
    it('🐛 Redis 报错时 fail-open —— 两个并发都拿到锁（附录 A.1）', async () => {
      const client = getAgentRuntimeRedisClient()!;
      const spy = vi.spyOn(client, 'set').mockRejectedValue(new Error('ECONNRESET (模拟瞬时故障)'));

      try {
        const results = await Promise.all([
          mgr.tryClaimStep(OP, 9, 35),
          mgr.tryClaimStep(OP, 9, 35),
        ]);

        // 两个都为 true = fail-open 成立 = 重入保护在 Redis 抖动期间完全失效
        expect(results).toEqual([true, true]);
      } finally {
        spy.mockRestore();
      }
    });

    it('对照：Redis 正常时同一步的第二次认领会被拒', async () => {
      await mgr.tryClaimStep(OP, 10, 35);
      await expect(mgr.tryClaimStep(OP, 10, 35)).resolves.toBe(false);
      await mgr.releaseStepLock(OP, 10);
    });
  });

  describe('state 存取与 TTL', () => {
    it('保存后可原样读回', async () => {
      // cost 是 Cost 对象而非数字；用 total 承载金额，与运行时实际形状一致
      const cost = { ...UsageCounter.createDefaultCost(), total: 1.25 };
      const state = makeState({ cost, stepCount: 7 });
      await mgr.saveAgentState(OP, state);
      const loaded = await mgr.loadAgentState(OP);
      expect(loaded?.stepCount).toBe(7);
      expect(loaded?.cost?.total).toBe(1.25);
    });

    it('state 带 2h TTL（DEFAULT_TTL = 2*3600）', async () => {
      await mgr.saveAgentState(OP, makeState());
      const client = getAgentRuntimeRedisClient()!;
      const ttl = await client.ttl(`agent_runtime_state:${OP}`);
      expect(ttl).toBeGreaterThan(7000);
      expect(ttl).toBeLessThanOrEqual(7200);
    });

    it('不存在的 operation 返回 null 而不是抛错', async () => {
      await expect(mgr.loadAgentState('agt_definitely_not_exist')).resolves.toBeNull();
    });
  });
});
