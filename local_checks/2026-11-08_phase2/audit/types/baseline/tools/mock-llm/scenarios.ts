/**
 * Built-in scenarios for the offline Mock LLM server.
 *
 * These are deliberately shaped to hit the branches that are hard to trigger against a
 * real provider: forced tool calls, human-approval gates, context compression, and error
 * paths. Feature-point ids refer to docs/analysis/03-features.md.
 */
import type { MockScenario } from './types';

/** ~4 chars per token is close enough for deterministic fake usage. */
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const usageFor = (prompt: string, completion: string) => ({
  completion_tokens: estimateTokens(completion),
  prompt_tokens: estimateTokens(prompt),
  total_tokens: estimateTokens(prompt) + estimateTokens(completion),
});

export const scenarios: Record<string, MockScenario> = {
  /** F2 / F3 — plain single-turn answer, no tools. The default smoke path. */
  'simple': {
    description: '单轮纯文本回答，不调用任何工具',
    name: 'simple',
    turns: [
      {
        content:
          '这是来自本地 Mock LLM 的回答。当前请求没有触发任何工具调用，用于验证最短的 agent 闭环：createOperation → call_llm → finish。',
        reasoning: '用户只是打招呼，不需要工具，直接回答即可。',
        ...usageFor('mock prompt', 'mock answer'),
      },
    ],
  },

  /** F4.1 / F4.8 — one tool call, then a final answer that consumes the result. */
  'single-tool': {
    description: '一轮工具调用 + 一轮总结（验证 tool_result 回灌）',
    name: 'single-tool',
    turns: [
      {
        reasoning: '需要先算一下再回答。',
        toolCalls: [
          { arguments: { expression: '2 + 2' }, name: 'lobe-calculator____calculate' },
        ],
      },
      { content: '计算结果是 4。' },
    ],
  },

  /** F4.8 — a tool that does not exist, to check the error is fed back rather than fatal. */
  'bad-tool': {
    description: '调用不存在的工具（验证错误回灌而非中断循环）',
    name: 'bad-tool',
    turns: [
      {
        toolCalls: [
          { arguments: { anything: 1 }, name: 'lobe-nonexistent____doesNotExist' },
        ],
      },
      { content: '收到工具错误，已改用其它方式回答。' },
    ],
  },

  /** F4.2 — three tool calls in one batch, to check p-map parallelism. */
  'parallel-tools': {
    description: '单轮并行三个工具调用（验证 call_tools_batch 并行度）',
    name: 'parallel-tools',
    turns: [
      {
        toolCalls: [
          { arguments: { expression: '1 + 1' }, name: 'lobe-calculator____calculate' },
          { arguments: { expression: '2 * 3' }, name: 'lobe-calculator____calculate' },
          { arguments: { expression: '10 / 2' }, name: 'lobe-calculator____calculate' },
        ],
      },
      { content: '三个计算都完成了：2、6、5。' },
    ],
  },

  /**
   * F6.1–F6.3 — a tool the manifest marks `humanIntervention: 'always'`.
   *
   * `lobe-agent____clearTodos` is the reliable trigger: it is a *static* 'always'
   * policy (manifest.ts:139) and lobe-agent sits in `alwaysOnToolIds`, so it is
   * enabled regardless of user tool selection. Note that local-system's tools use
   * a `dynamic` pathScopeAudit policy instead, which resolves to 'never' for paths
   * inside scope — so they are NOT a dependable approval trigger.
   */
  'human-approval': {
    description: '调用静态 always 审批策略的工具（验证 HIL 拦截与放行）',
    name: 'human-approval',
    turns: [
      {
        reasoning: '要清空待办，这个操作需要用户确认。',
        toolCalls: [{ arguments: { clearAll: true }, name: 'lobe-agent____clearTodos' }],
      },
      { content: '待办已清空。' },
    ],
  },

  /** F6.7 — one免审 tool plus one requiring approval in the same turn. */
  'mixed-approval': {
    description: '同一轮里混合免审工具与需审批工具（验证拆分执行）',
    name: 'mixed-approval',
    turns: [
      {
        toolCalls: [
          { arguments: { expression: '1 + 1' }, name: 'lobe-calculator____calculate' },
          { arguments: { clearAll: true }, name: 'lobe-agent____clearTodos' },
        ],
      },
      { content: '两个操作都处理完了。' },
    ],
  },

  /** F7.13 — very long output, to push the context window past the compression threshold. */
  'long-context': {
    description: '超长输出，用于触发上下文压缩（compress_context）',
    name: 'long-context',
    turns: [
      {
        content: Array.from(
          { length: 400 },
          (_, i) =>
            `第 ${i + 1} 段：这是用于把上下文推过压缩阈值的填充文本，内容本身没有意义，只关心 token 数量。`,
        ).join('\n'),
        usage: {
          completion_tokens: 24_000,
          prompt_tokens: 120_000,
          total_tokens: 144_000,
        },
      },
      { content: '压缩后的续写。' },
    ],
  },

  /** F10.3 — usage payload exercising every branch of UsageCounter.mergeModelUsage. */
  'usage-rich': {
    description: '返回含 cache / image / reasoning 明细的 usage（验证 usage 归一化）',
    name: 'usage-rich',
    turns: [
      {
        content: '带完整 usage 明细的回答。',
        reasoning: '思考过程也会计入 reasoning_tokens。',
        usage: {
          completion_tokens: 200,
          completion_tokens_details: { reasoning_tokens: 80 },
          prompt_tokens: 1000,
          prompt_tokens_details: { cached_tokens: 600, image_tokens: 150, text_tokens: 250 },
          total_tokens: 1200,
        },
      },
    ],
  },

  /** F4.8 / F10.5 — HTTP 500 from the provider. */
  'error-http': {
    description: '第一轮直接返回 500（验证 provider 错误归一化）',
    name: 'error-http',
    turns: [
      { error: { kind: 'http', message: 'mock upstream failure', status: 500 } },
    ],
  },

  /** F10.5 — 429, to check rate-limit handling. */
  'error-rate-limit': {
    description: '返回 429（验证限流错误处理）',
    name: 'error-rate-limit',
    turns: [
      { error: { kind: 'http', message: 'mock rate limit exceeded', status: 429 } },
    ],
  },

  /** F3.7 / F4.8 — stream that dies halfway through. */
  'error-stream-abort': {
    description: '流式输出中途断开（验证流中断处理与部分内容落库）',
    name: 'error-stream-abort',
    turns: [
      {
        content:
          '这段回答会在输出到一半的时候连接中断，用于验证客户端与服务端对流中断的处理是否一致。',
        error: { afterChunks: 5, kind: 'stream', message: 'mock stream aborted' },
      },
    ],
  },

  /** F2.8 — never stops calling tools, so maxSteps/forceFinish must kick in. */
  'infinite-tools': {
    description: '永远返回工具调用（验证 maxSteps 超限后的 forceFinish 收尾）',
    name: 'infinite-tools',
    repeatLast: true,
    turns: [
      {
        toolCalls: [
          { arguments: { expression: '1 + 1' }, name: 'lobe-calculator____calculate' },
        ],
      },
    ],
  },

  /**
   * Bounded multi-turn growth, for measuring state write amplification.
   *
   * Unlike `infinite-tools` this terminates: N tool turns then a final answer, so the
   * per-step state size can be sampled across a known number of steps without the run
   * escaping (see PLAN.md appendix B — nothing caps a runaway loop).
   * Each turn carries a chunk of filler so the message array grows measurably.
   */
  'growth': {
    description: '有界多轮增长，用于测量状态写放大',
    name: 'growth',
    repeatLast: false,
    turns: [
      ...Array.from({ length: 12 }, (_, i) => ({
        content: `第 ${i + 1} 轮的说明文字。` + '填充内容用于让消息数组稳定增长。'.repeat(20),
        toolCalls: [
          { arguments: { expression: `${i + 1} + ${i + 1}` }, name: 'lobe-calculator____calculate' },
        ],
      })),
      { content: '增长测试结束。' },
    ],
  },

  /** F8.5 — dispatch a sub-agent, exercising the waiting_for_async_tool bridge. */
  'sub-agent': {
    description: '派发子 agent（验证 waiting_for_async_tool 挂起与桥接唤醒）',
    name: 'sub-agent',
    turns: [
      {
        toolCalls: [
          {
            arguments: { instruction: '统计一下当前目录有多少文件', title: 'mock 子任务' },
            name: 'lobe-agent____callSubAgent',
          },
        ],
      },
      { content: '子任务已完成，结果已汇总。' },
    ],
  },

  /**
   * 探针场景：强制模型产出 `execTask`。
   *
   * PLAN.md 附录 A.3 有一条基于静态阅读的推断 ——「`exec_task` / `exec_tasks` /
   * `exec_client_task(s)` 四个指令只在客户端 executor 中实现，服务端 `RuntimeExecutors`
   * 没有对应项，若服务端 Brain 产出这些指令，`runtime.step()` 会抛
   * `No executor found for instruction type`」。这个场景就是用来把它证实或证伪的。
   */
  'exec-task': {
    description: '强制返回 execTask（验证服务端是否缺 exec_task executor，附录 A.3）',
    name: 'exec-task',
    turns: [
      {
        toolCalls: [
          {
            arguments: { instruction: '在后台跑一个任务', title: 'exec task 探针' },
            name: 'lobe-agent____execTask',
          },
        ],
      },
      { content: '任务已派发。' },
    ],
  },
};

export const defaultScenario = 'simple';

export const listScenarios = () =>
  Object.values(scenarios).map((s) => ({
    description: s.description,
    name: s.name,
    turns: s.turns.length,
  }));
