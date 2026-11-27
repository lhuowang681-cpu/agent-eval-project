import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import { buildExecTaskResult, buildExecTasksResult } from '../execTasksRuntime';
import { LobeAgentIdentifier } from '../manifest';
import {
  type PlanDocument,
  PlanExecutionRuntime,
  type PlanRuntimeContext,
  type PlanRuntimeService,
} from '../PlanRuntime';
import type {
  AnalyzeVisualMediaParams,
  CallSubAgentParams,
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  ExecTaskParams,
  ExecTasksParams,
  UpdatePlanParams,
  UpdateTodosParams,
} from '../types';
import { LobeAgentApiName } from '../types';
import { getTodosFromContext } from './helper';

const PLAN_DOC_TYPE = 'agent/plan';

/**
 * Normalize a document payload returned by notebookService / useNotebookStore
 * into the `PlanDocument` shape expected by PlanExecutionRuntime.
 */
const normalizePlanDoc = (doc: {
  content?: string | null;
  createdAt: Date | string;
  description?: string | null;
  id: string;
  metadata?: Record<string, any> | null;
  title?: string | null;
  updatedAt: Date | string;
}): PlanDocument => ({
  content: doc.content ?? null,
  createdAt: typeof doc.createdAt === 'string' ? new Date(doc.createdAt) : doc.createdAt,
  description: doc.description ?? null,
  id: doc.id,
  metadata: doc.metadata ?? null,
  title: doc.title ?? null,
  updatedAt: typeof doc.updatedAt === 'string' ? new Date(doc.updatedAt) : doc.updatedAt,
});

/**
 * Client-side implementation of the Plan runtime service.
 * Routes user-facing plan CRUD through useNotebookStore (so SWR caches refresh),
 * and keeps silent metadata writes (todos sync) on the raw notebookService.
 */
const clientPlanService: PlanRuntimeService = {
  createPlan: async ({ topicId, goal, description, content }) => {
    const doc = await useNotebookStore.getState().createDocument({
      content,
      description,
      title: goal,
      topicId,
      type: PLAN_DOC_TYPE,
    });
    return normalizePlanDoc(doc);
  },

  findPlanById: async (id) => {
    const doc = await notebookService.getDocument(id);
    return doc ? normalizePlanDoc(doc) : null;
  },

  findPlanByTopic: async (topicId) => {
    const result = await notebookService.listDocuments({ topicId, type: PLAN_DOC_TYPE });
    const first = result.data[0];
    return first ? normalizePlanDoc(first) : null;
  },

  updatePlan: async (id, { goal, description, content }, topicId) => {
    const doc = await useNotebookStore
      .getState()
      .updateDocument({ content, description, id, title: goal }, topicId ?? '');
    if (!doc) throw new Error(`Plan not found after update: ${id}`);
    return normalizePlanDoc(doc);
  },

  updatePlanMetadata: async (id, metadata) => {
    await notebookService.updateDocument({ id, metadata });
  },
};

const toPlanRuntimeContext = (ctx: BuiltinToolContext): PlanRuntimeContext => ({
  currentTodos: getTodosFromContext(ctx),
  messageId: ctx.messageId,
  signal: ctx.signal,
  topicId: ctx.topicId ?? undefined,
});

const LobeAgentApiNameEnum = {
  analyzeVisualMedia: LobeAgentApiName.analyzeVisualMedia,
  callSubAgent: LobeAgentApiName.callSubAgent,
  clearTodos: LobeAgentApiName.clearTodos,
  createPlan: LobeAgentApiName.createPlan,
  createTodos: LobeAgentApiName.createTodos,
  execTask: LobeAgentApiName.execTask,
  execTasks: LobeAgentApiName.execTasks,
  updatePlan: LobeAgentApiName.updatePlan,
  updateTodos: LobeAgentApiName.updateTodos,
} as const;

/**
 * Lobe Agent Tool Executor
 */
class LobeAgentExecutor extends BaseExecutor<typeof LobeAgentApiNameEnum> {
  readonly identifier = LobeAgentIdentifier;
  protected readonly apiEnum = LobeAgentApiNameEnum;

  private planRuntime = new PlanExecutionRuntime(clientPlanService);

  // ==================== Todo APIs ====================

  createTodos = (params: CreateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.createTodos(params, toPlanRuntimeContext(ctx));

  updateTodos = (params: UpdateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.updateTodos(params, toPlanRuntimeContext(ctx));

  clearTodos = (params: ClearTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.clearTodos(params, toPlanRuntimeContext(ctx));

  // ==================== Plan APIs ====================

  createPlan = (params: CreatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.createPlan(params, toPlanRuntimeContext(ctx));

  updatePlan = (params: UpdatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.updatePlan(params, toPlanRuntimeContext(ctx));

  // ==================== Async Tasks API ====================

  /**
   * Trigger a single async task. Pure — no I/O — so the same logic is reused
   * by the server runtime (`serverRuntimes/lobeAgent.ts`).
   */
  execTask = async (params: ExecTaskParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    buildExecTaskResult(params, ctx.messageId);

  /**
   * Trigger one or more async tasks. Pure — no I/O — so the same logic is
   * reused by the server runtime (`serverRuntimes/lobeAgent.ts`).
   */
  execTasks = async (
    params: ExecTasksParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => buildExecTasksResult(params, ctx.messageId);

  // ==================== Sub-Agent API ====================

  /**
   * Dispatch a single sub-agent and synchronously await its completion.
   * Delegates to the app-internal implementation (dynamic import — it needs
   * `@/services/aiAgent`/`@/utils/sleep`, and this keeps the package's own
   * module graph light for callers that never invoke this API).
   */
  callSubAgent = async (
    params: CallSubAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { callSubAgent } = await import('@/services/chat/callSubAgent');
    return callSubAgent(params, ctx);
  };

  // ==================== Visual Media API ====================

  /**
   * Analyze image/video content. Delegates to the app-internal
   * implementation (dynamic import — same rationale as `callSubAgent`).
   */
  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { analyzeVisualMedia } = await import('@/services/chat/analyzeVisualMedia');
    return analyzeVisualMedia(params, { messageId: ctx.messageId, signal: ctx.signal });
  };
}

// Export the executor instance for registration
export const lobeAgentExecutor = new LobeAgentExecutor();
