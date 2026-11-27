/**
 * L2 服务集成 —— StreamEventManager 打真 Redis Stream。
 *
 * 为什么这一层非要有：SSE 的**断线续传**语义只在真 Redis 上成立。
 * L1 的 InMemory 实现是一个数组，`lastEventId` 怎么传都能"对"；
 * L3 从 HTTP 打进来只能看到最终收到的事件流，无法把「从某个 ID 之后继续读」
 * 这条路径单独隔离出来 —— 而这正是前端重连时唯一依赖的行为。
 *
 * 另外两条也只有这一层能验：`XADD MAXLEN ~` 的近似裁剪是否真的在裁，
 * 以及 stream key 是否带 TTL（否则进程崩溃导致 cleanup 没跑时会永久堆积）。
 *
 * 前置：真 Redis（REDIS_URL）。本文件不需要 PostgreSQL。
 * 运行：bunx vitest run --config vitest.local.config.mts tests/local/streamEventManager.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StreamEventManager } from '@/server/modules/AgentRuntime/StreamEventManager';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

const OP = `agt_l2_stream_${Date.now()}`;
const STREAM_KEY = (op: string) => `agent_runtime_stream:${op}`;

const publish = (mgr: StreamEventManager, op: string, i: number) =>
  mgr.publishStreamEvent(op, {
    data: { seq: i },
    stepIndex: i,
    type: 'llm_stream',
  } as any);

describe('StreamEventManager（真 Redis Stream）', () => {
  let mgr: StreamEventManager;

  beforeAll(() => {
    if (!getAgentRuntimeRedisClient()) {
      throw new Error('需要真 Redis：请设置 REDIS_URL 且不要设 DISABLE_REDIS');
    }
    mgr = new StreamEventManager();
  });

  afterAll(async () => {
    const client = getAgentRuntimeRedisClient();
    if (!client) return;
    // 只清本用例造的键，绝不 FLUSHALL —— 本机 Redis 是共享实例
    const keys = await client.keys(`*${OP}*`);
    if (keys.length) await client.del(...keys);
  });

  it('发布的事件可经 getStreamHistory 原样读回', async () => {
    const op = `${OP}_history`;
    for (let i = 0; i < 5; i++) await publish(mgr, op, i);

    const history = await mgr.getStreamHistory(op, 100);

    expect(history).toHaveLength(5);

    /*
     * ⚠️ 顺序是**最新在前**，不是时间正序。
     *
     * 实现用 `XREVRANGE '+' '-' COUNT n` —— 这是有意的：要取「最近 n 条」就必须倒序取，
     * 正序 `XRANGE` 加 COUNT 会取到**最旧**的 n 条。方法名叫 history 容易让人以为是
     * 时间正序，调用方若直接渲染就会得到倒着的时间线。这里把该约定钉住。
     */
    expect(history.map((e) => e.stepIndex)).toEqual([4, 3, 2, 1, 0]);
    // data 经 JSON 往返，结构不应走样
    expect(history[2].data).toMatchObject({ seq: 2 });
    expect(history[0].operationId).toBe(op);
  });

  it('从 lastEventId 续读只拿到更新的事件（SSE 重连路径）', async () => {
    const op = `${OP}_resume`;
    const client = getAgentRuntimeRedisClient()!;

    for (let i = 0; i < 3; i++) await publish(mgr, op, i);

    // 取第 2 条的真实 Redis Stream ID 作为「客户端已收到的位置」
    const raw = (await client.xrange(STREAM_KEY(op), '-', '+')) as [string, string[]][];
    const lastSeenId = raw[1][0];

    for (let i = 3; i < 6; i++) await publish(mgr, op, i);

    const controller = new AbortController();
    const received: number[] = [];

    const sub = mgr.subscribeStreamEvents(
      op,
      lastSeenId,
      (events) => {
        received.push(...events.map((e) => e.stepIndex));
        // 收齐 4 条（第 3 条起）即可停：0/1 属于「已收到」不该再来
        if (received.length >= 4) controller.abort();
      },
      controller.signal,
    );

    await Promise.race([sub, new Promise((r) => setTimeout(r, 5000))]);
    controller.abort();

    // 关键断言：已经读过的 0、1 不能重复投递，否则前端重连会看到重复内容
    expect(received).not.toContain(0);
    expect(received).not.toContain(1);
    expect(received).toEqual(expect.arrayContaining([2, 3, 4, 5]));
  });

  it('XADD MAXLEN ~ 确实在裁剪，流不会无界增长', async () => {
    const op = `${OP}_maxlen`;
    const client = getAgentRuntimeRedisClient()!;

    // 上限是 1000，发 1500 条以越过阈值
    for (let i = 0; i < 1500; i++) await publish(mgr, op, i);

    const len = await client.xlen(STREAM_KEY(op));

    /*
     * `MAXLEN ~` 是**近似**裁剪：Redis 按 radix 树节点边界裁，不保证精确等于 1000，
     * 所以这里不能断言 `=== 1000`（那会变成随 Redis 版本抖动的脆弱用例）。
     * 能稳定断言的是两件事：确实裁了（远小于 1500），且没有裁过头（不少于 1000）。
     */
    expect(len).toBeLessThan(1500);
    expect(len).toBeGreaterThanOrEqual(1000);
  });

  it('stream key 带 2h TTL —— cleanup 没跑到时也不会永久堆积', async () => {
    const op = `${OP}_ttl`;
    await publish(mgr, op, 0);

    const client = getAgentRuntimeRedisClient()!;
    const ttl = await client.ttl(STREAM_KEY(op));

    // -1 表示没有过期时间：那样一旦进程崩溃导致 cleanupOperation 没执行，
    // 这些流会永久留在 Redis 里。
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2 * 60 * 60);
  });

  it('cleanupOperation 删除整条流', async () => {
    const op = `${OP}_cleanup`;
    await publish(mgr, op, 0);
    expect(await mgr.getStreamHistory(op, 10)).toHaveLength(1);

    await mgr.cleanupOperation(op);

    const client = getAgentRuntimeRedisClient()!;
    expect(await client.exists(STREAM_KEY(op))).toBe(0);
    expect(await mgr.getStreamHistory(op, 10)).toHaveLength(0);
  });
});
