import {
  type AnalyzeVisualMediaParams,
  buildExecTaskResult,
  buildExecTasksResult,
  type CallSubAgentParams,
  type ExecTaskParams,
  type ExecTasksParams,
  LobeAgentIdentifier,
  PlanExecutionRuntime,
} from '@lobechat/builtin-tool-lobe-agent';
import { type LobeChatDatabase } from '@lobechat/database';
import { type BuiltinToolResult } from '@lobechat/types';

import { MessageModel } from '@/database/models/message';

import { type ToolExecutionContext } from '../types';
import { createServerPlanRuntimeService } from './lobeAgentPlanRuntime';
import { type ServerRuntimeRegistration } from './types';

const buildError = (content: string, code: string): BuiltinToolResult => ({
  content,
  error: { message: content, type: code },
  success: false,
});

/**
 * Server-side `lobe-agent` runtime: Plan/Todo APIs are delegated to the
 * shared `PlanExecutionRuntime`, backed by a DB-backed `PlanRuntimeService`
 * (see `lobeAgentPlanRuntime.ts`). `execTask`/`execTasks` are pure trigger
 * builders with no storage dependency, so the same logic used by the client
 * executor is reused as-is. `analyzeVisualMedia` delegates to
 * `lobeAgentVisualMedia.ts`. `callSubAgent` forks an async sub-operation
 * (headless/gateway parents only — see C3 design notes).
 */
class LobeAgentServerExecutionRuntime {
  private planRuntime: PlanExecutionRuntime;
  private serverDB: LobeChatDatabase;
  private userId: string;

  constructor(planRuntime: PlanExecutionRuntime, serverDB: LobeChatDatabase, userId: string) {
    this.planRuntime = planRuntime;
    this.serverDB = serverDB;
    this.userId = userId;
  }

  createPlan = (params: any, ctx: { topicId?: string }) =>
    this.planRuntime.createPlan(params, { topicId: ctx?.topicId });

  updatePlan = (params: any, ctx: { topicId?: string }) =>
    this.planRuntime.updatePlan(params, { topicId: ctx?.topicId });

  createTodos = (params: any, ctx: { topicId?: string }) =>
    this.planRuntime.createTodos(params, { topicId: ctx?.topicId });

  updateTodos = (params: any, ctx: { topicId?: string }) =>
    this.planRuntime.updateTodos(params, { topicId: ctx?.topicId });

  clearTodos = (params: any, ctx: { topicId?: string }) =>
    this.planRuntime.clearTodos(params, { topicId: ctx?.topicId });

  execTask = async (params: ExecTaskParams): Promise<BuiltinToolResult> =>
    buildExecTaskResult(params);

  execTasks = async (params: ExecTasksParams): Promise<BuiltinToolResult> =>
    buildExecTasksResult(params);

  /**
   * Dynamic import: pulls in `initModelRuntimeFromDB`'s heavy ModelRuntime
   * dependency chain, which shouldn't load just from importing this module.
   */
  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinToolResult> => {
    const { analyzeVisualMedia } = await import('./lobeAgentVisualMedia');
    return analyzeVisualMedia(params, {
      messageId: ctx.messageId,
      serverDB: this.serverDB,
      topicId: ctx.topicId,
      userId: this.userId,
    });
  };

  /**
   * Fork a sub-agent as an independent async operation (headless/gateway
   * parents only — see C3 design notes). Returns a `deferred` result
   * instead of a synchronous tool_result: the agent runtime parks the
   * parent op (`waiting_for_async_tool`) until the sub-op finishes, at
   * which point the completion bridge backfills the placeholder tool
   * message and resumes the parent.
   */
  callSubAgent = async (
    params: CallSubAgentParams,
    ctx: ToolExecutionContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.isSubAgent) {
      return buildError(
        'Sub-agent calls cannot be triggered from within another sub-agent.',
        'NESTED_SUB_AGENT_NOT_ALLOWED',
      );
    }

    const { description, instruction, timeout } = params;
    if (!description?.trim() || !instruction?.trim()) {
      return buildError('`description` and `instruction` are required.', 'INVALID_ARGUMENTS');
    }

    if (!ctx.agentId || !ctx.topicId || !ctx.messageId || !ctx.operationId || !ctx.toolCallId) {
      return buildError(
        'Sub-agent execution is not available in this runtime (missing agent/topic/message/operation context).',
        'SUB_AGENT_CONTEXT_UNAVAILABLE',
      );
    }

    const messageModel = new MessageModel(this.serverDB, this.userId);

    // Create the placeholder BEFORE forking the child — its id doubles as
    // the Thread's sourceMessageId and the bridge's toolMessageId.
    const toolMessage = await messageModel.create({
      agentId: ctx.agentId,
      content: '',
      parentId: ctx.messageId,
      plugin: {
        apiName: 'callSubAgent',
        arguments: JSON.stringify(params),
        identifier: LobeAgentIdentifier,
        type: 'default',
      },
      pluginState: { status: 'pending' },
      role: 'tool',
      tool_call_id: ctx.toolCallId,
      topicId: ctx.topicId,
    });

    // Dynamic import: AiAgentService pulls a heavy transitive dependency
    // graph (ModelRuntime/AgentRuntimeService/etc.) that shouldn't load
    // just from importing this server-runtime module.
    const { AiAgentService } = await import('@/server/services/aiAgent');
    const aiAgentService = new AiAgentService(this.serverDB, this.userId);

    const result = await aiAgentService.execVirtualSubAgent({
      agentId: ctx.agentId,
      instruction,
      parentMessageId: toolMessage.id,
      parentOperationId: ctx.operationId,
      timeout,
      title: description,
      topicId: ctx.topicId,
    });

    if (!result.success) {
      // Child failed to start — clean up the placeholder so the parent is
      // never wrongly parked waiting for a bridge that will never fire.
      await messageModel.deleteMessage(toolMessage.id);
      return buildError(
        result.error ? `Sub-agent failed to start: ${result.error}` : 'Sub-agent failed to start.',
        'SUB_AGENT_START_FAILED',
      );
    }

    return {
      content: '',
      deferred: true,
      state: {
        status: 'pending',
        subOperationId: result.operationId,
        threadId: result.threadId,
        toolMessageId: toolMessage.id,
      },
      success: true,
    };
  };
}

export const lobeAgentRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId || !context.serverDB) {
      throw new Error('userId and serverDB are required for lobe-agent execution');
    }

    const planRuntime = new PlanExecutionRuntime(
      createServerPlanRuntimeService(context.serverDB, context.userId),
    );

    return new LobeAgentServerExecutionRuntime(planRuntime, context.serverDB, context.userId);
  },
  identifier: LobeAgentIdentifier,
};
