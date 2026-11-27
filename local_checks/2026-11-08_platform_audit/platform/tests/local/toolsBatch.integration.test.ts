/**
 * L2 服务集成 —— 批量工具执行（真 PostgreSQL + 真 Redis）。
 *
 * 覆盖 plan §5.2 里的两项：**批量工具并行**与**工具失败回灌**。
 *
 * 为什么放这一层：
 *   · 并行性只能用**墙钟时间**证明 —— 三个各 300ms 的工具若串行是 ~900ms、
 *     并行是 ~300ms。L1 全 mock 时时间是假的；L3 从 HTTP 打进来，网络与调度
 *     抖动会淹没这个差值。
 *   · 失败回灌要看**落库的工具消息**：`resolveToolMessageContent` 的注释写着
 *     「工具消息绝不能以空内容落库，否则模型读成『成功但无输出』」——
 *     这条只有对着真数据库才验得了。
 *
 * 工具边界（`toolExecutionService`）用可控假体：它正是本用例要变化的**输入**
 * （延迟、成功/失败），不是被测对象。其余依赖全部用真的。
 *
 * 前置：真 PostgreSQL（DATABASE_URL）+ 真 Redis（REDIS_URL）。
 * 运行：bunx vitest run --config vitest.local.config.mts tests/local/toolsBatch.integration.test.ts
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MessageModel } from '@/database/models/message';
import { agents, sessions, topics } from '@/database/schemas';
import { StreamEventManager } from '@/server/modules/AgentRuntime/StreamEventManager';
import { createRuntimeExecutors } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { getAgentRuntimeRedisClient } from '@/server/modules/AgentRuntime/redis';

import { closeRealDB, getRealDB } from './realDb';

const USER_ID = 'offline-dev-user';
const SUFFIX = Date.now();
const AGENT_ID = `agt_l2_batch_${SUFFIX}`;
const SESSION_ID = `ssn_l2_batch_${SUFFIX}`;
const TOPIC_ID = `tpc_l2_batch_${SUFFIX}`;
const OP = `agt_l2_batch_op_${SUFFIX}`;

const TOOL_LATENCY_MS = 300;

/** 构造一个工具调用 payload */
const toolCall = (id: string, apiName: string) => ({
  apiName,
  arguments: '{}',
  id,
  identifier: 'l2-fake-tool',
  type: 'default' as const,
});

const makeState = (over: Record<string, unknown> = {}) =>
  ({
    messages: [],
    metadata: { agentId: AGENT_ID, topicId: TOPIC_ID, userId: USER_ID },
    status: 'running',
    stepCount: 0,
    toolManifestMap: { 'l2-fake-tool': { api: [], identifier: 'l2-fake-tool' } },
    ...over,
  }) as any;

describe('批量工具执行（真 PG + 真 Redis）', () => {
  let db: ReturnType<typeof getRealDB>;
  let messageModel: MessageModel;
  let streamManager: StreamEventManager;

  /** 可控工具边界：按 apiName 决定成功/失败，并注入固定延迟 */
  const makeToolService = () =>
    ({
      executeTool: async (payload: any) => {
        await new Promise((r) => setTimeout(r, TOOL_LATENCY_MS));
        if (payload.apiName.startsWith('fail')) {
          return {
            content: '',
            error: { message: `${payload.apiName} exploded`, type: 'ToolExecutionError' },
            executionTime: TOOL_LATENCY_MS,
            success: false,
          };
        }
        return {
          content: `ok:${payload.apiName}`,
          executionTime: TOOL_LATENCY_MS,
          success: true,
        };
      },
    }) as any;

  const buildExecutors = () =>
    createRuntimeExecutors({
      messageModel,
      operationId: OP,
      serverDB: db as any,
      stepIndex: 0,
      streamManager,
      toolExecutionService: makeToolService(),
      topicId: TOPIC_ID,
      userId: USER_ID,
    });

  beforeAll(async () => {
    if (!getAgentRuntimeRedisClient()) throw new Error('需要真 Redis：请设置 REDIS_URL');

    db = getRealDB();
    messageModel = new MessageModel(db as any, USER_ID);
    streamManager = new StreamEventManager();

    // 建最小外键依赖链：agent → session → topic
    await db.insert(agents).values({ id: AGENT_ID, userId: USER_ID } as any);
    await db.insert(sessions).values({ id: SESSION_ID, userId: USER_ID } as any);
    await db
      .insert(topics)
      .values({ id: TOPIC_ID, sessionId: SESSION_ID, title: 'L2 batch', userId: USER_ID } as any);
  });

  afterAll(async () => {
    // 只清本用例造的数据；messages 由 topic 级联删除
    await db.delete(topics).where(eq(topics.id, TOPIC_ID));
    await db.delete(sessions).where(eq(sessions.id, SESSION_ID));
    await db.delete(agents).where(eq(agents.id, AGENT_ID));

    const client = getAgentRuntimeRedisClient();
    if (client) {
      const keys = await client.keys(`*${OP}*`);
      if (keys.length) await client.del(...keys);
    }
    await closeRealDB();
  });

  it('三个工具并发执行 —— 墙钟时间接近单个耗时而非三倍', async () => {
    const executors = buildExecutors();
    const parent = await messageModel.create({
      agentId: AGENT_ID,
      content: 'batch parent',
      role: 'assistant',
      sessionId: SESSION_ID,
      topicId: TOPIC_ID,
    } as any);

    const started = Date.now();
    const result = await executors.call_tools_batch!(
      {
        payload: {
          parentMessageId: parent.id,
          toolsCalling: [toolCall('t1', 'alpha'), toolCall('t2', 'beta'), toolCall('t3', 'gamma')],
        },
        type: 'call_tools_batch',
      } as any,
      makeState(),
      {} as any,
    );
    const elapsed = Date.now() - started;

    /*
     * 串行会是 3×300=900ms 起。留足余量取 700ms 作为判据：
     * 既能稳定区分串行/并行，又不会因为本机数据库写入抖动而假失败。
     */
    expect(elapsed).toBeLessThan(700);
    expect(result.events.filter((e: any) => e.type === 'tool_result')).toHaveLength(3);
  });

  it('单个工具失败不影响同批其它工具（失败隔离）', async () => {
    const executors = buildExecutors();
    const parent = await messageModel.create({
      agentId: AGENT_ID,
      content: 'batch with failure',
      role: 'assistant',
      sessionId: SESSION_ID,
      topicId: TOPIC_ID,
    } as any);

    const result = await executors.call_tools_batch!(
      {
        payload: {
          parentMessageId: parent.id,
          toolsCalling: [toolCall('f1', 'fail-one'), toolCall('s1', 'succeed-one')],
        },
        type: 'call_tools_batch',
      } as any,
      makeState(),
      {} as any,
    );

    const toolResults = result.events.filter((e: any) => e.type === 'tool_result');
    // 失败的那个不能让整批短路 —— 两个都要有结果
    expect(toolResults).toHaveLength(2);
    expect(toolResults.some((e: any) => e.result?.success === false)).toBe(true);
    expect(toolResults.some((e: any) => e.result?.success === true)).toBe(true);
  });

  it('失败被回灌成非空的工具消息 —— 否则模型读成「成功但无输出」', async () => {
    const executors = buildExecutors();
    const parent = await messageModel.create({
      agentId: AGENT_ID,
      content: 'failure feedback',
      role: 'assistant',
      sessionId: SESSION_ID,
      topicId: TOPIC_ID,
    } as any);

    await executors.call_tools_batch!(
      {
        payload: { parentMessageId: parent.id, toolsCalling: [toolCall('f2', 'fail-solo')] },
        type: 'call_tools_batch',
      } as any,
      makeState(),
      {} as any,
    );

    const messages = await messageModel.query({ topicId: TOPIC_ID });
    const toolMessages = messages.filter((m: any) => m.role === 'tool');

    expect(toolMessages.length).toBeGreaterThan(0);

    /*
     * 关键断言：工具失败时落库的内容**必须非空**，且要携带错误信息。
     * `resolveToolMessageContent` 存在的全部理由就是这个 ——
     * 空内容会被模型当成「工具跑成功了，只是没返回东西」，
     * 于是它不会重试、也不会向用户报错，静默走错路。
     */
    const failMessage = toolMessages.at(-1) as any;
    expect(failMessage.content).toBeTruthy();
    expect(String(failMessage.content).length).toBeGreaterThan(0);
    expect(String(failMessage.content)).toContain('exploded');
  });

  /**
   * 上下文压缩（plan §5.2 第三项）。
   *
   * ⚠️ 覆盖范围有边界：真正的**摘要生成要调 LLM**，那属 L3（mock provider）。
   * 这一层验的是它的**守卫路径** —— 缺少 topicId / userId 时必须安全跳过并
   * 原样带回消息，而不是丢消息或抛错。这条路径在真实部署里并不罕见
   * （子 agent、评测任务等场景 metadata 不全），一旦丢消息就是静默的上下文损坏。
   */
  describe('上下文压缩的守卫路径', () => {
    const buildExecutorsWithout = (omit: 'topicId' | 'userId') =>
      createRuntimeExecutors({
        messageModel,
        operationId: OP,
        serverDB: db as any,
        stepIndex: 0,
        streamManager,
        toolExecutionService: makeToolService(),
        topicId: omit === 'topicId' ? undefined : TOPIC_ID,
        userId: omit === 'userId' ? undefined : USER_ID,
      });

    const runCompress = async (executors: any, stateOver: Record<string, unknown>) => {
      const messages = [
        { content: 'u1', id: 'm1', role: 'user' },
        { content: 'a1', id: 'm2', role: 'assistant' },
        { content: 'u2', id: 'm3', role: 'user' },
      ];
      return executors.compress_context!(
        { payload: { currentTokenCount: 999_999, messages }, type: 'compress_context' } as any,
        makeState({ messages, ...stateOver }),
        {} as any,
      );
    };

    it('缺 userId 时跳过压缩，且消息原样带回（不能丢上下文）', async () => {
      const result = await runCompress(buildExecutorsWithout('userId'), {});
      const payload = result.nextContext?.payload as any;

      expect(payload?.skipped).toBe(true);
      // 跳过不等于丢弃：三条消息必须完整回到下一轮
      expect(payload?.compressedMessages).toHaveLength(3);
      expect(payload.compressedMessages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3']);
    });

    it('缺 topicId 时同样安全跳过', async () => {
      const result = await runCompress(buildExecutorsWithout('topicId'), {
        metadata: { agentId: AGENT_ID, userId: USER_ID },
      });
      const payload = result.nextContext?.payload as any;

      expect(payload?.skipped).toBe(true);
      expect(payload?.compressedMessages).toHaveLength(3);
    });

    it('跳过时进入 compression_result 阶段，状态机不中断', async () => {
      const result = await runCompress(buildExecutorsWithout('userId'), {});

      // 若这里没给出 nextContext，运行时会停在原地 —— 压缩失败变成挂死
      expect(result.nextContext?.phase).toBe('compression_result');
      expect(result.newState.status).not.toBe('error');
    });
  });
});
