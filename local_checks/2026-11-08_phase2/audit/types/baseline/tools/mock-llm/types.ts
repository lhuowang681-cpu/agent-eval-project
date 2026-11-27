/**
 * Scenario types for the offline Mock LLM server.
 *
 * A scenario is an ordered list of turns. Each incoming /v1/chat/completions request
 * consumes the next turn for its conversation, so a multi-step agent run walks through
 * the turns deterministically: turn 0 emits tool calls, turn 1 sees the tool results and
 * emits the final answer, and so on.
 */

export interface MockToolCall {
  /** Tool identifier as the agent registered it, e.g. `lobe-web-browsing____search`. */
  name: string;
  /** Arguments object — serialised to a JSON string in the OpenAI payload. */
  arguments: Record<string, unknown>;
  id?: string;
}

export interface MockUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** Cache/multimodal breakdown, to exercise UsageCounter.mergeModelUsage. */
  prompt_tokens_details?: {
    cached_tokens?: number;
    text_tokens?: number;
    image_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
}

export interface MockTurn {
  /** Assistant text. Ignored when `toolCalls` is set and `content` is omitted. */
  content?: string;
  /** Reasoning / chain-of-thought text, emitted as `reasoning_content` deltas. */
  reasoning?: string;
  /** Tool calls this turn should emit. */
  toolCalls?: MockToolCall[];
  /** Override the server default first-token latency for this turn (ms). */
  firstTokenDelayMs?: number;
  /** Override the server default output rate for this turn (tokens/sec). */
  tokensPerSecond?: number;
  /** Usage to report. Defaults are derived from content length when omitted. */
  usage?: MockUsage;
  /** finish_reason to report. Defaults to `tool_calls` when toolCalls is set, else `stop`. */
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  /**
   * Inject a failure instead of a normal response.
   *  - `http`   : respond with `status` and an OpenAI-shaped error body
   *  - `stream` : start streaming, then abort the connection mid-flight
   *  - `timeout`: hold the connection open without writing anything
   */
  error?: {
    kind: 'http' | 'stream' | 'timeout';
    status?: number;
    message?: string;
    /** For `stream`: abort after this many content chunks. */
    afterChunks?: number;
    /** For `timeout`: hold for this long (ms) before closing. */
    holdMs?: number;
  };
}

export interface MockScenario {
  name: string;
  description?: string;
  turns: MockTurn[];
  /** Repeat the last turn once turns are exhausted (default true, so runs terminate). */
  repeatLast?: boolean;
}

export interface MockServerConfig {
  port: number;
  /** Default first-token latency in ms. */
  firstTokenDelayMs: number;
  /** Default output rate in tokens/sec. 0 = emit everything at once. */
  tokensPerSecond: number;
  /** Embedding vector dimension. 1536 matches text-embedding-3-small. */
  embeddingDimensions: number;
  /** Active scenario name. */
  scenario: string;
}
