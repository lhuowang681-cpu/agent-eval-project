import { type LobeToolManifest } from '@lobechat/context-engine';
import { type LobeChatDatabase } from '@lobechat/database';
import { type ChatToolPayload } from '@lobechat/types';

export interface ToolExecutionContext {
  /**
   * Names of skills already activated earlier in this conversation
   * (accumulated in AgentState.activatedStepSkills). Used by lobe-skills'
   * activateSkill to short-circuit repeat activations of the same skill.
   */
  activatedSkillNames?: string[];
  /** Target device ID for device proxy tool calls */
  activeDeviceId?: string;
  /** Local agent ID for usage tracking */
  agentId?: string;
  /**
   * Whether this tool call is executing inside an isolated sub-agent run
   * (dispatched via callSubAgent). Used to reject nested sub-agent dispatch.
   */
  isSubAgent?: boolean;
  /** Memory tool permission from agent chat config */
  memoryToolPermission?: 'read-only' | 'read-write';
  /** The tool-call's anchor message ID (used e.g. by analyzeVisualMedia to locate nearby visual files) */
  messageId?: string;
  /** The current operation's id (for callSubAgent's parent-resume bridge) */
  operationId?: string;
  /** The parent operation's id, set when this operation is itself a sub-agent run */
  parentOperationId?: string;
  /** Server database for TripYoYo Skills execution */
  serverDB?: LobeChatDatabase;
  /**
   * The tool call's id (`ChatToolPayload.id`) — used by deferred/async
   * executors (e.g. callSubAgent) to tag the placeholder tool message they
   * create themselves, so it lines up with `pendingToolsCalling`/the LLM's
   * original tool_call_id when the bridge later backfills it.
   */
  toolCallId?: string;
  toolManifestMap: Record<string, LobeToolManifest>;
  /**
   * Maximum length for tool execution result content (in characters)
   * @default 6000
   */
  toolResultMaxLength?: number;
  /** Topic ID for sandbox session management */
  topicId?: string;
  userId?: string;
  /**
   * Device-bound working directory for Local System execution. Hidden from the model
   * manifest and injected into tool arguments by server runtimes.
   */
  workingDirectory?: string;
}

export interface ToolExecutionResult {
  content: string;
  /**
   * See `BuiltinToolResult.deferred` — set when a server tool executor
   * forked an async sub-operation instead of resolving synchronously.
   */
  deferred?: boolean;
  error?: any;
  state?: Record<string, any>;
  success: boolean;
}

export interface ToolExecutionResultResponse extends ToolExecutionResult {
  executionTime: number;
}

export interface IToolExecutor {
  execute: (
    payload: ChatToolPayload,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>;
}
