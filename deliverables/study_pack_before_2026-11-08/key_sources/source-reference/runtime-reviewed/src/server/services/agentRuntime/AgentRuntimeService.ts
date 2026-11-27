import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { AgentRuntime, findInMessages, GeneralChatAgent, UsageCounter } from '@lobechat/agent-runtime';
import type { ISnapshotStore } from '@lobechat/agent-tracing';
import { builtinTools } from '@lobechat/builtin-tools';
import { dynamicInterventionAudits } from '@lobechat/builtin-tools/dynamicInterventionAudits';
import {
  AgentRuntimeErrorType,
  ChatErrorType,
  type ChatMessageError,
  type ChatToolPayload,
} from '@lobechat/types';
import debug from 'debug';
import { eq, inArray } from 'drizzle-orm';
import urlJoin from 'url-join';

import { AgentModel } from '@/database/models/agent';
import { AgentOperationModel } from '@/database/models/agentOperation';
import { DeviceModel } from '@/database/models/device';
import { MessageModel } from '@/database/models/message';
import { messagePlugins, messages } from '@/database/schemas';
import { type LobeChatDatabase } from '@/database/type';
import { appEnv } from '@/envs/app';
import {
  resolveAgentWorkingDirectory,
  scratchWorkingDirectory,
} from '@/helpers/agentWorkingDirectory';
import { type AgentRuntimeCoordinatorOptions } from '@/server/modules/AgentRuntime';
import { AgentRuntimeCoordinator, createStreamEventManager } from '@/server/modules/AgentRuntime';
import { type RuntimeExecutorContext } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { createRuntimeExecutors } from '@/server/modules/AgentRuntime/RuntimeExecutors';
import { type IStreamEventManager } from '@/server/modules/AgentRuntime/types';
import { scheduleMarketUsageReport } from '@/server/routers/tools/_helpers/scheduleMarketUsageReport';
import { FileService } from '@/server/services/file';
import {
  ensureTopicSandboxFiles,
  renewTopicSandboxSession,
} from '@/server/services/market/openSandbox';
import { mcpService } from '@/server/services/mcp';
import { PluginGatewayService } from '@/server/services/pluginGateway';
import { QueueService } from '@/server/services/queue';
import { LocalQueueServiceImpl } from '@/server/services/queue/impls';
import { ToolExecutionService } from '@/server/services/toolExecution';
import { BuiltinToolsExecutor } from '@/server/services/toolExecution/builtin';

import { hookDispatcher } from './hooks';
import {
  type AgentExecutionParams,
  type AgentExecutionResult,
  type OperationCreationParams,
  type OperationCreationResult,
  type OperationStatusResult,
  type PendingInterventionsResult,
  type StartExecutionParams,
  type StartExecutionResult,
  type StepCompletionReason,
  type StepLifecycleCallbacks,
  type StepPresentationData,
  type SubAgentBridgeParams,
} from './types';

const log = debug('lobe-server:agent-runtime-service');

// Bounded exponential backoff for the async-tool barrier re-check: 15s, 30s,
// 60s, 120s, 240s (capped), 5 attempts total (~7.75min) before giving up —
// this only covers transient races (e.g. the resume message arrived before
// the last tool's backfill committed); a genuinely dead child is instead
// caught by the separate dead-operation watchdog sweep.
const ASYNC_TOOL_VERIFY_DELAY_MS = 15_000;
const ASYNC_TOOL_VERIFY_MAX_ATTEMPTS = 5;
const ASYNC_TOOL_VERIFY_MAX_DELAY_MS = 240_000;

/**
 * 服务端 operation 的收敛兜底。
 *
 * 背景：`runtime.step()` 的收敛保护写作 `if (newState.maxSteps && ...)`，
 * `shouldContinueExecution` 的成本熔断写作 `if (state.costLimit && ...)` ——
 * 两者在字段缺省时都整条短路。而经 `aiAgent.createOperation` 这条路创建的 operation
 * 此前两个字段都不会被设置，于是**只要模型持续返回 tool_calls，循环就无限跑下去，
 * 没有任何一层兜底**（实测 1 分钟 173 万 tokens、5.9 步/秒线性增长，最终只能杀进程）。
 *
 * 客户端运行时本来就是写死上限的（`streamingExecutor.ts` 传 `agentConfig.maxSteps = 1000`），
 * 服务端对齐该数量级；成本上限取一个足以覆盖正常长对话、又能在失控时及时截断的值。
 * 调用方仍可显式传入更严格的值来收紧。
 */
const DEFAULT_MAX_STEPS = 1000;

/**
 * 硬闸相对 maxSteps 的余量。
 * forceFinish 需要几步才能走完「剥工具 → 再问一次 → 拿到最终文本 → finish」，
 * 给它这点空间；超过就说明模型不配合，无条件停。
 */
const MAX_STEPS_GRACE = 5;

const DEFAULT_COST_LIMIT = {
  currency: 'USD',
  maxTotalCost: 10,
  onExceeded: 'stop',
} as const;

/** 工具全名分隔符，与 ToolNameResolver 的 PLUGIN_SCHEMA_SEPARATOR 保持一致。 */
const TOOL_NAME_SEPARATOR = '____';

/**
 * 用内置工具注册表补全调用方没给的 manifest。
 *
 * 为什么必须在服务端做：审批策略只从 `state.toolManifestMap` 读，
 * 而工具执行不看 manifest —— 两者一旦脱节，就是「工具能跑、审批不生效」。
 * 调用方（含前端、bot 集成、OpenResponses）很容易漏传，schema 默认值又是 `{}`，
 * 所以不能指望调用方，必须由服务端按实际启用的工具反查补齐。
 *
 * 只补 builtin：plugin / mcp / klavis 的 manifest 来自各自的安装记录，
 * 不在这个注册表里，仍以调用方传入的为准。
 */
const backfillBuiltinManifests = (
  provided: Record<string, any> | undefined,
  tools: any[] | undefined,
): Record<string, any> => {
  const manifestMap: Record<string, any> = { ...(provided ?? {}) };

  // 从 tools 的函数全名里解出 identifier（`identifier____apiName`）
  const identifiers = new Set<string>();
  for (const tool of tools ?? []) {
    const fullName = tool?.function?.name;
    if (typeof fullName !== 'string') continue;
    const [identifier] = fullName.split(TOOL_NAME_SEPARATOR);
    if (identifier) identifiers.add(identifier);
  }

  for (const identifier of identifiers) {
    if (manifestMap[identifier]) continue; // 调用方已给，尊重之
    const builtin = builtinTools.find((t) => t.identifier === identifier);
    if (builtin?.manifest) {
      manifestMap[identifier] = builtin.manifest;
      log('Backfilled builtin manifest for %s', identifier);
    }
  }

  return manifestMap;
};

const asyncToolVerifyDelayMs = (attempt: number): number =>
  Math.min(
    ASYNC_TOOL_VERIFY_DELAY_MS * 2 ** (Math.max(1, attempt) - 1),
    ASYNC_TOOL_VERIFY_MAX_DELAY_MS,
  );

/**
 * Formats an error into ChatMessageError structure
 * Handles various error formats from LLM execution and other sources
 */
function formatErrorForState(error: unknown): ChatMessageError {
  // Handle ChatCompletionErrorPayload format from LLM errors
  // e.g., { errorType: 'InvalidProviderAPIKey', error: { ... }, provider: 'openai' }
  if (error && typeof error === 'object' && 'errorType' in error) {
    const payload = error as {
      error?: unknown;
      errorType: ChatMessageError['type'];
      message?: string;
    };
    return {
      body: payload.error || error,
      message: payload.message || String(payload.errorType),
      type: payload.errorType,
    };
  }

  // Handle standard Error objects
  if (error instanceof Error) {
    return {
      body: { name: error.name },
      message: error.message,
      type: ChatErrorType.InternalServerError,
    };
  }

  // Fallback for unknown error types
  return {
    body: error,
    message: String(error),
    type: AgentRuntimeErrorType.AgentRuntimeError,
  };
}

export interface AgentRuntimeServiceOptions {
  /**
   * Coordinator configuration options
   * Allows injection of custom stateManager and streamEventManager
   */
  coordinatorOptions?: AgentRuntimeCoordinatorOptions;
  /**
   * Custom QueueService
   * Set to null to disable queue scheduling (for synchronous execution tests)
   */
  queueService?: QueueService | null;
  /**
   * Optional snapshot store for persisting agent execution traces.
   * When provided, execution snapshots are recorded on every step and finalized on completion.
   * In dev mode without this option, falls back to FileSnapshotStore automatically.
   */
  snapshotStore?: ISnapshotStore;
  /**
   * Custom StreamEventManager
   * Defaults to Redis-based StreamEventManager
   * Can pass InMemoryStreamEventManager in test environments
   */
  streamEventManager?: IStreamEventManager;
}

/**
 * Agent Runtime Service
 * Encapsulates Agent execution logic and provides a unified service interface
 *
 * Supports dependency injection for testing with in-memory implementations:
 * ```ts
 * // Production environment (uses Redis by default)
 * const service = new AgentRuntimeService(db, userId);
 *
 * // Test environment
 * const service = new AgentRuntimeService(db, userId, {
 *   streamEventManager: new InMemoryStreamEventManager(),
 *   queueService: null, // Disable queue, use executeSync
 * });
 * ```
 */
export class AgentRuntimeService {
  private coordinator: AgentRuntimeCoordinator;
  private streamManager: IStreamEventManager;
  private queueService: QueueService | null;
  private snapshotStore: ISnapshotStore | null;
  private toolExecutionService: ToolExecutionService;
  /**
   * Step lifecycle callback registry
   * key: operationId, value: callbacks
   */
  private stepCallbacks: Map<string, StepLifecycleCallbacks> = new Map();
  /**
   * 本进程内正在执行的 AgentRuntime 实例，按 operationId 索引。
   *
   * 用途只有一个：`interruptOperation` 能就地 abort 掉正在跑的那一步
   * （典型是一次几十秒的 LLM 流式调用），而不必等它自然结束。
   * 跨进程的中断由持久化中断标记负责 —— 这里只是让同进程的中断更及时。
   */
  private activeRuntimes: Map<string, AgentRuntime> = new Map();
  private get baseURL() {
    const baseUrl = process.env.AGENT_RUNTIME_BASE_URL || appEnv.APP_URL || 'http://localhost:3010';

    return urlJoin(baseUrl, '/api/agent');
  }
  private serverDB: LobeChatDatabase;
  private userId: string;
  private messageModel: MessageModel;

  constructor(db: LobeChatDatabase, userId: string, options?: AgentRuntimeServiceOptions) {
    // Use factory function to auto-select Redis or InMemory implementation
    this.streamManager =
      options?.streamEventManager ??
      options?.coordinatorOptions?.streamEventManager ??
      createStreamEventManager();
    this.coordinator = new AgentRuntimeCoordinator({
      ...options?.coordinatorOptions,
      streamEventManager: this.streamManager,
    });
    this.queueService =
      options?.queueService === null ? null : (options?.queueService ?? new QueueService());
    this.snapshotStore = options?.snapshotStore ?? this.createDefaultSnapshotStore();
    this.serverDB = db;
    this.userId = userId;
    this.messageModel = new MessageModel(db, this.userId);

    // Initialize ToolExecutionService with dependencies
    const pluginGatewayService = new PluginGatewayService();
    const builtinToolsExecutor = new BuiltinToolsExecutor(db, userId);

    this.toolExecutionService = new ToolExecutionService({
      builtinToolsExecutor,
      mcpService,
      pluginGatewayService,
    });

    // Setup local execution callback for LocalQueueServiceImpl
    this.setupLocalExecutionCallback();
  }

  /**
   * Setup execution callback for LocalQueueServiceImpl
   * This breaks the circular dependency by using callback injection
   */
  private setupLocalExecutionCallback(): void {
    if (!this.queueService) return;

    const impl = this.queueService.getImpl();
    if (impl instanceof LocalQueueServiceImpl) {
      log('Setting up local execution callback');
      impl.setExecutionCallback(async (operationId, stepIndex, context, payload) => {
        log('[%s][%d] Local step executing...', operationId, stepIndex);
        await this.executeStep({
          // 人在环回填数据装在 payload 里；不透传的话审批结果就丢了，
          // 步骤会按「无干预」重跑，pendingToolsCalling 永不清除（附录 C-2）。
          approvedToolCall: payload?.approvedToolCall,
          context,
          humanInput: payload?.humanInput,
          operationId,
          rejectionReason: payload?.rejectionReason,
          stepIndex,
        });
      });
    }
  }

  // ==================== Step Lifecycle Callbacks ====================

  /**
   * Register step lifecycle callbacks
   * @param operationId - Operation ID
   * @param callbacks - Callback function collection
   */
  registerStepCallbacks(operationId: string, callbacks: StepLifecycleCallbacks): void {
    this.stepCallbacks.set(operationId, callbacks);
    log('[%s] Registered step callbacks', operationId);
  }

  /**
   * Remove step lifecycle callbacks
   * @param operationId - Operation ID
   */
  unregisterStepCallbacks(operationId: string): void {
    this.stepCallbacks.delete(operationId);
    log('[%s] Unregistered step callbacks', operationId);
  }

  /**
   * Get step lifecycle callbacks
   * @param operationId - Operation ID
   */
  getStepCallbacks(operationId: string): StepLifecycleCallbacks | undefined {
    return this.stepCallbacks.get(operationId);
  }

  // ==================== Operation Interruption ====================

  /**
   * Interrupt a running agent operation by setting its state to 'interrupted'.
   * The agent will stop at the next step boundary (cannot abort an in-flight LLM call).
   * Works with both Redis and InMemory state managers via the coordinator abstraction.
   *
   * @returns true if the operation was interrupted, false if already in a terminal state or not found
   */
  async interruptOperation(operationId: string): Promise<boolean> {
    const state = await this.coordinator.loadAgentState(operationId);
    if (!state) return false;

    if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
      return false;
    }

    // 顺序要紧：**先**打持久化中断标记，再写 status。
    //
    // 只写 status 是原来的做法，它有个丢失更新窗口 —— 正在执行的步骤在开始时已经把
    // state 读进内存，结束时用自己那份整体覆盖写回，落在这中间的中断就被冲掉了。
    // 实测 agent 以约 6 步/秒推进，该窗口频繁命中，表现为 `interruptTask` 返回成功、
    // 步数却从 372 一路涨到 564，最终只能杀进程（附录 B-2）。
    //
    // 中断标记与 state 分开存放，只被 set/read/clear，不参与状态覆盖，
    // 并且跨进程可见（queue 模式下每一步都是独立 HTTP 请求，可能落在不同实例）。
    await this.coordinator.markInterrupted(operationId);

    await this.coordinator.saveAgentState(operationId, {
      ...state,
      // 记录中断上下文，让「为什么停了」在状态里可查 ——
      // 否则只看到一个 interrupted，分不清是用户点的、还是别的原因。
      interruption: {
        // 用户主动中断按**不可恢复**记：本方法同时打了持久化中断标记，
        // `shouldContinueExecution` 会据此拒绝继续调度；若这里写 true，
        // 就会出现「状态说能恢复、实际永远不会被恢复」的自相矛盾。
        canResume: false,
        interruptedAt: new Date().toISOString(),
        reason: 'user_requested',
        stepCount: state.stepCount,
      },
      lastModified: new Date().toISOString(),
      status: 'interrupted',
    });

    // 就地中止本进程内正在执行的那一步（如果恰好在这里跑）。
    // 拿不到实例也无妨 —— 标记已经落下，下一个检查点会停；这里只是让中断更及时，
    // 免得等一次几十秒的 LLM 流式调用自然结束。
    try {
      this.activeRuntimes.get(operationId)?.getAbortController()?.abort();
    } catch (error) {
      log('[%s] abort in-flight step failed (non-fatal): %O', operationId, error);
    }

    log('[%s] Operation interrupted', operationId);
    return true;
  }

  // ==================== Operation Management ====================

  /**
   * Create a new Agent operation
   */
  async createOperation(params: OperationCreationParams): Promise<OperationCreationResult> {
    const {
      activeDeviceId,
      operationId,
      initialContext,
      agentConfig,
      modelRuntimeConfig,
      userId,
      autoStart = true,
      stream,
      initialMessages = [],
      appContext,
      toolSet,
      stepCallbacks,
      hooks,
      userInterventionConfig,
      completionWebhook,
      stepWebhook,
      webhookDelivery,
      discordContext,
      evalContext,
      maxSteps,
      costLimit,
      userMemory,
      deviceSystemInfo,
      skillMetas,
      userTimezone,
    } = params;

    // 收敛兜底：runtime.step() 的 maxSteps 检查是 `if (newState.maxSteps && ...)`，
    // maxSteps 为 undefined 时整条短路，forceFinish 永远不会触发 —— 只要模型持续返回
    // tool_calls，循环就无限跑下去（实测 1 分钟 173 万 tokens、5.9 步/秒线性增长）。
    // 客户端运行时是写死上限的（streamingExecutor.ts 传 agentConfig.maxSteps = 1000），
    // 服务端这条路此前没有对应默认值，因此在这里兜底而不是指望调用方传。
    const effectiveMaxSteps = maxSteps ?? DEFAULT_MAX_STEPS;
    const effectiveCostLimit = costLimit ?? DEFAULT_COST_LIMIT;

    // 服务端补全 manifest —— 不能信任调用方传了什么。
    //
    // `GeneralChatAgent.getToolInterventionConfig` 从 `state.toolManifestMap[identifier]`
    // 读审批策略，缺 manifest 就返回 undefined = 无策略 = 放行；
    // 而**工具执行并不依赖 manifest**（RuntimeExecutors 能独立解析并执行 builtin 工具）。
    // 于是「省略 toolManifestMap」等于「工具照常执行 + 所有审批门禁静默失效」，
    // 且 CreateAgentOperationSchema 里该字段默认值就是 `{}` —— 这是默认行为而非异常配置
    // （附录 C-1 的 A/B 对照实测：不传 manifest → 待审 0 个、工具直接执行）。
    const operationToolSet = {
      ...toolSet,
      manifestMap: backfillBuiltinManifests(toolSet.manifestMap, toolSet.tools),
    };

    try {
      const memories = userMemory?.memories;
      let deviceDefaultCwd: string | undefined;
      if (activeDeviceId) {
        try {
          deviceDefaultCwd =
            (await new DeviceModel(this.serverDB, this.userId).findByDeviceId(activeDeviceId))
              ?.defaultCwd ?? undefined;
        } catch (error) {
          log('[%s] Failed to resolve device default cwd: %O', operationId, error);
        }
      }
      const deviceFallbackCwd = scratchWorkingDirectory(deviceSystemInfo?.desktopPath);

      log(
        '[%s] Creating new operation (autoStart: %s) with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d, memory=%s',
        operationId,
        autoStart,
        agentConfig?.model,
        agentConfig?.provider,
        operationToolSet.tools?.length ?? 0,
        initialMessages.length,
        operationToolSet.manifestMap ? Object.keys(operationToolSet.manifestMap).length : 0,
        memories
          ? `{contexts:${memories.contexts?.length ?? 0},experiences:${memories.experiences?.length ?? 0},preferences:${memories.preferences?.length ?? 0},identities:${memories.identities?.length ?? 0},activities:${memories.activities?.length ?? 0},persona:${memories.persona ? 'yes' : 'no'}}`
          : 'none',
      );

      // Initialize operation state - create state before saving
      const initialState = {
        // `AgentState.cost` 类型上是必填，但这里原先没给，导致整轮运行它可能一直
        // 是 undefined（`UsageCounter` 只在模型上报单次成本时才创建）。
        // 后果：① 状态查询接口返回体里没有 cost 字段；
        //       ② 成本熔断 `state.cost?.total >= maxTotalCost` 退化为
        //          `undefined >= N`，恒为 false —— 熔断静默失效。
        // 从零值起步后，累加与比较都有确定的起点。
        cost: UsageCounter.createDefaultCost(),
        createdAt: new Date().toISOString(),
        // Store initialContext for executeSync to use
        initialContext,
        lastModified: new Date().toISOString(),
        // Use the passed initial messages
        messages: initialMessages,
        metadata: {
          activeDeviceId,
          agentConfig,
          completionWebhook,
          deviceSystemInfo,
          discordContext,
          evalContext,
          // need be removed
          modelRuntimeConfig,
          stepWebhook,
          stream,
          skillMetas,
          userId,
          userMemory,
          userTimezone,
          webhookDelivery,
          // Per-device working directory resolution (mirrors the client picker):
          // the run's active device supplies the per-device choice, falling back
          // to legacy runtimeEnv, device default, then Desktop/Home.
          workingDirectory: resolveAgentWorkingDirectory({
            agencyConfig: agentConfig?.agencyConfig,
            currentDeviceId: activeDeviceId,
            deviceDefaultCwd,
            fallback: deviceFallbackCwd,
            legacyAgentWorkingDirectory: agentConfig?.chatConfig?.runtimeEnv?.workingDirectory,
          }),
          ...appContext,
        },
        costLimit: effectiveCostLimit,
        maxSteps: effectiveMaxSteps,
        // modelRuntimeConfig at state level for executor fallback
        modelRuntimeConfig,
        operationId,
        operationToolSet,
        status: 'idle',
        stepCount: 0,
        // Backward-compat: resolved tool fields read by RuntimeExecutors
        toolManifestMap: operationToolSet.manifestMap,
        toolSourceMap: operationToolSet.sourceMap,
        tools: operationToolSet.tools,
        // User intervention config for headless mode in async tasks
        userInterventionConfig,
      } as Partial<AgentState>;

      // Use coordinator to create operation, automatically sends initialization event
      await this.coordinator.createAgentOperation(operationId, {
        agentConfig,
        modelRuntimeConfig,
        userId,
      });

      // Save initial state
      await this.coordinator.saveAgentState(operationId, initialState as any);

      // Durable, lightweight tracking row (survives Redis TTL expiry) — used
      // by callSubAgent's CAS resume and the dead-operation watchdog.
      // parentOperationId is set when this operation was forked by callSubAgent.
      try {
        await new AgentOperationModel(this.serverDB, userId || this.userId).recordStart({
          id: operationId,
          agentId: appContext?.agentId,
          parentOperationId: appContext?.parentOperationId,
          threadId: appContext?.threadId ?? undefined,
          topicId: appContext?.topicId ?? undefined,
        });
      } catch (error) {
        log('[%s] Failed to record agent_operations row: %O', operationId, error);
      }

      // Register step lifecycle callbacks
      if (stepCallbacks) {
        this.registerStepCallbacks(operationId, stepCallbacks);
      }

      // Register external hooks
      if (hooks && hooks.length > 0) {
        hookDispatcher.register(operationId, hooks);

        // Persist webhook configs to state metadata for production mode
        const serializedHooks = hookDispatcher.getSerializedHooks(operationId);
        if (serializedHooks && serializedHooks.length > 0) {
          const currentState = await this.coordinator.loadAgentState(operationId);
          if (currentState) {
            await this.coordinator.saveAgentState(operationId, {
              ...currentState,
              metadata: {
                ...currentState.metadata,
                _hooks: serializedHooks,
              },
            });
          }
        }
      }

      let messageId: string | undefined;
      let autoStarted = false;

      if (autoStart && this.queueService) {
        // Both local and queue modes use scheduleMessage
        // LocalQueueServiceImpl uses setTimeout + callback mechanism
        // QStashQueueServiceImpl schedules HTTP requests
        messageId = await this.queueService.scheduleMessage({
          context: initialContext,
          delay: 50, // Short delay for startup
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority: 'high',
          stepIndex: 0,
        });
        autoStarted = true;
        log('[%s] Scheduled first step (messageId: %s)', operationId, messageId);
      }

      if (!autoStarted) {
        log('[%s] Created operation without auto-start', operationId);
      }

      return { autoStarted, messageId, operationId, success: true };
    } catch (error) {
      console.error('Failed to create operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Execute Agent step
   */
  async executeStep(params: AgentExecutionParams): Promise<AgentExecutionResult> {
    const { operationId, stepIndex, context, humanInput, approvedToolCall, rejectionReason } =
      params;

    const callbacks = this.getStepCallbacks(operationId);

    // ===== Distributed lock: prevent duplicate execution from QStash retries =====
    const claimed = await this.coordinator.tryClaimStep(operationId, stepIndex, 35);
    if (!claimed) {
      log(
        '[%s][%d] Step lock conflict — another instance is executing this step, returning locked',
        operationId,
        stepIndex,
      );
      return {
        locked: true,
        nextStepScheduled: false,
        state: {},
        success: false,
      };
    }

    try {
      log('[%s][%d] Start step executing...', operationId, stepIndex);

      // Publish step start event
      await this.streamManager.publishStreamEvent(operationId, {
        data: {},
        stepIndex,
        type: 'step_start',
      });

      // Get operation state and metadata
      const agentState = await this.coordinator.loadAgentState(operationId);

      if (!agentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      // ===== Async-tool bridge control payloads =====
      // These re-check/resume a parked operation; they don't advance stepIndex
      // through the normal LLM/tool step loop. Scheduled directly by
      // completeSubAgentBridge / maybeScheduleAsyncToolVerify, not by the
      // regular willScheduleNextStep path below.
      if (params.verifyAsyncToolBarrier) {
        const attempt = params.asyncToolVerifyAttempt ?? 1;
        const resumed = await this.tryResumeParentFromAsyncTool(
          { parentOperationId: operationId },
          { scheduleVerifyOnHold: true, verifyAttempt: attempt + 1 },
        );
        return { nextStepScheduled: resumed, state: agentState, stepResult: null, success: true };
      }

      let resumingAsyncTool = false;
      if (params.resumeAsyncTool) {
        if (agentState.status !== 'waiting_for_async_tool') {
          // Already resumed by a concurrent call (or otherwise moved on) — no-op.
          log(
            '[%s][%d] resumeAsyncTool no-op — status is already %s',
            operationId,
            stepIndex,
            agentState.status,
          );
          return { nextStepScheduled: false, state: agentState, stepResult: null, success: true };
        }

        // The bridge already backfilled agentState.messages with the resolved
        // tool result(s) (see completeSubAgentBridge) — just flip the park.
        agentState.status = 'running';
        agentState.pendingToolsCalling = [];
        agentState.interruption = undefined;
        resumingAsyncTool = true;
      }

      if (stepIndex === 0 && agentState.metadata?.agentId) {
        void this.recordMarketAgentUsage(String(agentState.metadata.agentId));
      }

      // Layer 2 defense: catch extremely delayed retries that arrive after lock TTL expired
      if (agentState.stepCount > stepIndex) {
        log(
          '[%s][%d] Step already completed (stepCount=%d), skipping',
          operationId,
          stepIndex,
          agentState.stepCount,
        );
        return {
          nextStepScheduled: false,
          state: agentState,
          stepResult: null,
          success: true,
        };
      }

      // Early exit: skip step if operation is already in a terminal state
      // This prevents executing expensive LLM/tool calls after timeout or interruption
      if (
        agentState.status === 'interrupted' ||
        agentState.status === 'done' ||
        agentState.status === 'error'
      ) {
        log(
          '[%s][%d] Skipping step — operation already in terminal state: %s',
          operationId,
          stepIndex,
          agentState.status,
        );

        const reason = this.determineCompletionReason(agentState);

        // Mirror the normal-completion path (see the `!shouldContinue` block
        // below). An operation that reaches a terminal state via interrupt /
        // timeout (or a step re-delivered after the op already ended) still
        // needs its completion webhook + onComplete hooks fired — otherwise the
        // task-lifecycle finalization (onTopicComplete) never runs in queue
        // mode and the task / task_topic stay pinned at 'running' forever,
        // which also blocks every subsequent scheduled tick. Single-fire is
        // guaranteed by the Layer-2 `stepCount > stepIndex` guard + tryClaimStep
        // above: a normally-completed op never re-enters this branch.
        await this.triggerCompletionWebhook(agentState, operationId, reason);
        await this.dispatchCompletionHooks(operationId, agentState, reason);

        // Trigger completion callback so eval run can finalize properly
        if (callbacks?.onComplete) {
          try {
            await callbacks.onComplete({
              finalState: agentState,
              operationId,
              reason,
            });
            this.unregisterStepCallbacks(operationId);
          } catch (callbackError) {
            log('[%s] onComplete callback error: %O', operationId, callbackError);
          }
        }

        return {
          nextStepScheduled: false,
          state: agentState,
          stepResult: null,
          success: true,
        };
      }

      // Call onBeforeStep callback (legacy)
      if (callbacks?.onBeforeStep) {
        try {
          await callbacks.onBeforeStep({
            context,
            operationId,
            state: agentState,
            stepIndex,
          });
        } catch (callbackError) {
          log('[%s] onBeforeStep callback error: %O', operationId, callbackError);
        }
      }

      // Dispatch beforeStep hooks
      try {
        const beforeStepMetadata = agentState?.metadata || {};
        await hookDispatcher.dispatch(
          operationId,
          'beforeStep',
          {
            agentId: beforeStepMetadata?.agentId || '',
            finalState: agentState,
            operationId,
            stepIndex,
            steps: agentState?.stepCount || 0,
            userId: beforeStepMetadata?.userId || this.userId,
          },
          beforeStepMetadata._hooks,
        );
      } catch (hookError) {
        log('[%s] beforeStep hook dispatch error: %O', operationId, hookError);
      }

      // Create Agent and Runtime instances
      // Use agentState.metadata which contains the full app context (topicId, agentId, etc.)
      // operationMetadata only contains basic fields (agentConfig, modelRuntimeConfig, userId)
      const { runtime } = await this.createAgentRuntime({
        metadata: agentState?.metadata,
        operationId,
        stepIndex,
      });

      // 注册，供 interruptOperation 就地 abort；下方 finally 里注销。
      this.activeRuntimes.set(operationId, runtime);

      // 入口检查：上一步与本步之间可能已经被中断（尤其 queue 模式下两步之间隔着
      // 一次队列往返）。在真正干活之前先看一眼，避免白跑一整步。
      if (await this.coordinator.isInterrupted(operationId)) {
        log('[%s][%d] Interrupt flag set before step start, aborting', operationId, stepIndex);
        await this.coordinator.saveAgentState(operationId, {
          ...agentState,
          lastModified: new Date().toISOString(),
          status: 'interrupted',
        } as AgentState);
        return {
          completed: true,
          executionTime: 0,
          status: 'interrupted',
          stepIndex,
          success: true,
        } as any;
      }

      // 置为 running。
      //
      // 此前服务端从来没有人把 AgentState.status 写成 'running' —— 它从创建时的 'idle'
      // 一直保持到终态。后果是监控侧**分不清「空闲」和「正在失控烧钱」**，
      // `isActive` 之类的派生字段也不可信（附录 B-3）。
      // 这里持有步锁，写 state 是安全的；每步多一次 SETEX，代价可接受。
      if (agentState && agentState.status !== 'running') {
        await this.coordinator.saveAgentState(operationId, {
          ...agentState,
          lastModified: new Date().toISOString(),
          status: 'running',
        } as AgentState);
        agentState.status = 'running';
      }

      // Handle human intervention
      let currentContext = context;
      let currentState = agentState;

      if (resumingAsyncTool) {
        // Re-enter the LLM with the now-resolved tool result(s) in state.messages
        currentContext = { phase: 'user_input' };
      } else if (humanInput || approvedToolCall || rejectionReason) {
        const interventionResult = await this.handleHumanIntervention(runtime, currentState, {
          approvedToolCall,
          humanInput,
          rejectionReason,
        });
        currentState = interventionResult.newState;
        currentContext = interventionResult.nextContext;
      }

      // Ensure topic sandbox files before tool execution (regenerate / continue / idle session)
      await this.ensureTopicSandboxFilesBeforeStep(currentState);

      // Pre-step computation: extract device context from DB messages
      // Follows front-end computeStepContext pattern — computed at step boundary, not inside executors
      if (!currentState.metadata?.activeDeviceId) {
        const deviceContext = await this.computeDeviceContext(currentState);
        if (deviceContext && currentState.metadata) {
          currentState.metadata.activeDeviceId = deviceContext.activeDeviceId;
          currentState.metadata.devicePlatform = deviceContext.devicePlatform;
          currentState.metadata.deviceSystemInfo = deviceContext.deviceSystemInfo;
          log(
            '[%s][%d] Pre-step: device context computed from messages (deviceId: %s)',
            operationId,
            stepIndex,
            deviceContext.activeDeviceId,
          );
        }
      }

      // Execute step
      const startAt = Date.now();
      const stepResult = await runtime.step(currentState, currentContext);

      // 步骤执行期间是否被中断？
      //
      // 原来只看 `latestState.status`，但那个字段会被本次 saveStepResult 整体覆盖 ——
      // 中断如果落在「读 state」与「写 state」之间就丢了（附录 B-2 的丢失更新）。
      // 现在以**独立的中断标记**为准：它不参与状态覆盖，也跨进程可见。
      // status 仍然一并检查，兼容通过其它路径直接改状态的情况。
      const latestState = await this.coordinator.loadAgentState(operationId);
      const interrupted =
        (await this.coordinator.isInterrupted(operationId)) ||
        latestState?.status === 'interrupted';

      if (interrupted) {
        stepResult.newState.status = 'interrupted';
        stepResult.newState.lastModified = new Date().toISOString();
        log('[%s][%d] Operation was interrupted during step execution', operationId, stepIndex);
      }

      // 硬上限触发时要真正落到终态。
      //
      // 只让 shouldContinueExecution 返回 false 会「停止调度但状态停在 running」——
      // operation 永远不进终态、不发 agent_runtime_end，前端一直转圈、
      // 监控也永远看到一个「运行中」的僵尸（实测：步数确实停在 11，但 status=running）。
      const hardCap = stepResult.newState.maxSteps
        ? stepResult.newState.maxSteps + MAX_STEPS_GRACE
        : undefined;
      if (
        hardCap &&
        stepResult.newState.stepCount >= hardCap &&
        !['done', 'error', 'interrupted'].includes(stepResult.newState.status)
      ) {
        stepResult.newState.status = 'done';
        stepResult.newState.lastModified = new Date().toISOString();
        log(
          '[%s][%d] Hard step cap reached (%d >= %d), forcing terminal state',
          operationId,
          stepIndex,
          stepResult.newState.stepCount,
          hardCap,
        );
      }

      // Save state, coordinator will handle event sending automatically
      await this.coordinator.saveStepResult(operationId, {
        ...stepResult,
        executionTime: Date.now() - startAt,
        stepIndex, // placeholder
      });

      // Sync the durable operation-tracking row (heartbeat + status). Used by
      // callSubAgent's CAS resume and the dead-operation watchdog — best
      // effort, must never break the actual step execution.
      try {
        const opUserId = stepResult.newState.metadata?.userId || this.userId;
        const operationModel = new AgentOperationModel(this.serverDB, opUserId);
        const finalStatus = stepResult.newState.status;

        if (finalStatus === 'done' || finalStatus === 'error' || finalStatus === 'interrupted') {
          await operationModel.markTerminal(operationId, finalStatus);
        } else {
          await operationModel.touchHeartbeat(operationId, {
            status: finalStatus,
            stepCount: stepResult.newState.stepCount,
          });
        }
      } catch (error) {
        log('[%s] Failed to sync agent_operations tracking row: %O', operationId, error);
      }

      // Decide whether to schedule next step — computed before event publishing
      // so stream consumers get the correct value
      const shouldContinue = this.shouldContinueExecution(
        stepResult.newState,
        stepResult.nextContext,
      );
      const willScheduleNextStep =
        shouldContinue && !!stepResult.nextContext && !!this.queueService;

      // Publish step complete event
      await this.streamManager.publishStreamEvent(operationId, {
        data: {
          finalState: stepResult.newState,
          nextStepScheduled: willScheduleNextStep,
          stepIndex,
        },
        stepIndex,
        type: 'step_complete',
      });

      // Build enhanced step completion log & presentation data
      const { usage, cost } = stepResult.newState;
      const phase = stepResult.nextContext?.phase;
      const isToolPhase = phase === 'tool_result' || phase === 'tools_batch_result';

      // --- Extract presentation fields from step result ---
      let content: string | undefined;
      let reasoning: string | undefined;
      let toolsCalling:
        | Array<{ apiName: string; arguments?: string; identifier: string }>
        | undefined;
      let toolsResult:
        | Array<{ apiName: string; identifier: string; isSuccess?: boolean; output?: string }>
        | undefined;
      let stepSummary: string;

      if (phase === 'tool_result') {
        const toolPayload = stepResult.nextContext?.payload as any;
        const toolCall = toolPayload?.toolCall;
        const identifier = toolCall?.identifier || 'unknown';
        const apiName = toolCall?.apiName || 'unknown';
        const output = toolPayload?.data;
        toolsResult = [
          {
            apiName,
            identifier,
            isSuccess: toolPayload?.isSuccess !== false,
            output:
              typeof output === 'string'
                ? output
                : output != null
                  ? JSON.stringify(output)
                  : undefined,
          },
        ];
        stepSummary = `[tool] ${identifier}/${apiName}`;
      } else if (phase === 'tools_batch_result') {
        const nextPayload = stepResult.nextContext?.payload as any;
        const toolCount = nextPayload?.toolCount || 0;
        const rawToolResults = nextPayload?.toolResults || [];
        const mappedResults: Array<{
          apiName: string;
          identifier: string;
          isSuccess?: boolean;
          output?: string;
        }> = rawToolResults.map((r: any) => {
          const tc = r.toolCall;
          const output = r.data;
          return {
            apiName: tc?.apiName || 'unknown',
            identifier: tc?.identifier || 'unknown',
            isSuccess: r?.isSuccess !== false,
            output:
              typeof output === 'string'
                ? output
                : output != null
                  ? JSON.stringify(output)
                  : undefined,
          };
        });
        toolsResult = mappedResults;
        const toolNames = mappedResults.map((r) => `${r.identifier}/${r.apiName}`);
        stepSummary = `[tools×${toolCount}] ${toolNames.join(', ')}`;
      } else {
        // Check for done event first (finish step with no next context)
        const doneEvent = stepResult.events?.find((e) => e.type === 'done') as
          | { reason?: string; reasonDetail?: string; type: 'done' }
          | undefined;

        if (doneEvent) {
          stepSummary = `[done] reason=${doneEvent.reason ?? 'unknown'}`;
        } else {
          // LLM result
          const llmEvent = stepResult.events?.find((e) => e.type === 'llm_result');
          content = (llmEvent as any)?.result?.content || undefined;
          reasoning = (llmEvent as any)?.result?.reasoning || undefined;

          // Use parsed ChatToolPayload from payload (has identifier + apiName)
          const payloadToolsCalling = (stepResult.nextContext?.payload as any)?.toolsCalling as
            | Array<{ apiName: string; arguments: string; identifier: string }>
            | undefined;
          const hasToolCalls = Array.isArray(payloadToolsCalling) && payloadToolsCalling.length > 0;

          if (hasToolCalls) {
            toolsCalling = payloadToolsCalling.map((tc) => ({
              apiName: tc.apiName,
              arguments: tc.arguments,
              identifier: tc.identifier,
            }));
          }

          const parts: string[] = [];
          if (reasoning) {
            const thinkPreview = reasoning.length > 30 ? reasoning.slice(0, 30) + '...' : reasoning;
            parts.push(`💭 "${thinkPreview}"`);
          }
          if (!content && hasToolCalls) {
            parts.push(
              `→ call tools: ${toolsCalling!.map((tc) => `${tc.identifier}|${tc.apiName}`).join(', ')}`,
            );
          } else if (content) {
            const preview = content.length > 20 ? content.slice(0, 20) + '...' : content;
            parts.push(`"${preview}"`);
          }
          if (parts.length > 0) {
            stepSummary = `[llm] ${parts.join(' | ')}`;
          } else {
            stepSummary = `[llm] (empty) phase=${stepResult.nextContext?.phase ?? 'none'} events=${stepResult.events?.length ?? 0}`;
          }
        }
      }

      // --- Step-level usage from nextContext.stepUsage ---
      const stepUsage = stepResult.nextContext?.stepUsage as Record<string, number> | undefined;

      // --- Cumulative usage ---
      const tokens = usage?.llm?.tokens;
      const totalInputTokens = tokens?.input ?? 0;
      const totalOutputTokens = tokens?.output ?? 0;
      const totalTokensNum = tokens?.total ?? 0;
      const totalCostNum = cost?.total ?? 0;

      const totalTokensStr =
        totalTokensNum >= 1_000_000
          ? `${(totalTokensNum / 1_000_000).toFixed(1)}m`
          : totalTokensNum >= 1000
            ? `${(totalTokensNum / 1000).toFixed(1)}k`
            : String(totalTokensNum);
      const llmCalls = usage?.llm?.apiCalls ?? 0;
      const toolCallCount = usage?.tools?.totalCalls ?? 0;

      log(
        '[%s][%d] completed %s | total: %s tokens / $%s | llm×%d | tools×%d',
        operationId,
        stepIndex,
        stepSummary,
        totalTokensStr,
        totalCostNum.toFixed(4),
        llmCalls,
        toolCallCount,
      );

      // Build presentation data object for callbacks and webhooks
      const stepPresentationData: StepPresentationData = {
        content,
        executionTimeMs: Date.now() - startAt,
        reasoning,
        stepCost: stepUsage?.cost ?? undefined,
        stepInputTokens: stepUsage?.totalInputTokens ?? undefined,
        stepOutputTokens: stepUsage?.totalOutputTokens ?? undefined,
        stepTotalTokens: stepUsage?.totalTokens ?? undefined,
        stepType: isToolPhase ? ('call_tool' as const) : ('call_llm' as const),
        thinking: !isToolPhase,
        toolsCalling,
        toolsResult,
        totalCost: totalCostNum,
        totalInputTokens,
        totalOutputTokens,
        totalSteps: stepResult.newState.stepCount ?? 0,
        totalTokens: totalTokensNum,
      };

      // Call onAfterStep callback with presentation data (legacy)
      if (callbacks?.onAfterStep) {
        try {
          await callbacks.onAfterStep({
            ...stepPresentationData,
            operationId,
            shouldContinue,
            state: stepResult.newState,
            stepIndex,
            stepResult,
          });
        } catch (callbackError) {
          log('[%s] onAfterStep callback error: %O', operationId, callbackError);
        }
      }

      // Dispatch afterStep hooks
      try {
        const metadata = stepResult.newState?.metadata || {};
        await hookDispatcher.dispatch(
          operationId,
          'afterStep',
          {
            agentId: metadata?.agentId || '',
            finalState: stepResult.newState,
            operationId,
            shouldContinue,
            status: stepResult.newState?.status,
            stepIndex,
            steps: stepResult.newState?.stepCount || 0,
            userId: metadata?.userId || this.userId,
          },
          metadata._hooks,
        );
      } catch (hookError) {
        log('[%s] afterStep hook dispatch error: %O', operationId, hookError);
      }

      // Record step snapshot via injected snapshot store
      if (this.snapshotStore) {
        try {
          const partial = (await this.snapshotStore.loadPartial(operationId)) ?? { steps: [] };

          if (!partial.startedAt) {
            partial.startedAt = Date.now();
            partial.model =
              (agentState?.metadata as any)?.agentConfig?.model ??
              agentState?.modelRuntimeConfig?.model;
            partial.provider =
              (agentState?.metadata as any)?.agentConfig?.provider ??
              agentState?.modelRuntimeConfig?.provider;
          }

          if (!partial.steps) partial.steps = [];

          // Incremental diff: only store message delta + baseline at reset points
          const prevMessages = agentState?.messages ?? [];
          const afterMessages = stepResult.newState.messages;
          const isCompression = stepResult.events?.some(
            (e: any) => e.type === 'compression_complete',
          );
          const isBaseline = stepIndex === 0 || isCompression;
          // Always store only the newly added messages, even for baseline steps
          const messagesDelta = afterMessages.slice(prevMessages.length);

          // Strip heavy/redundant data from events before persisting to snapshot
          const snapshotEvents = (stepResult.events as any[])
            ?.filter((e) => e.type !== 'llm_stream')
            .map((e) => {
              if (e.type === 'done' && e.finalState) {
                // Remove reconstructible fields from finalState:
                // - messages: from messagesBaseline + messagesDelta chain
                // - operationToolSet: from toolsetBaseline (step 0)
                // - toolManifestMap/tools/toolSourceMap: backward-compat copies of operationToolSet
                const {
                  messages: _msgs,
                  operationToolSet: _ots,
                  toolManifestMap: _tmm,
                  toolSourceMap: _tsm,
                  tools: _tools,
                  // activatedStepTools is kept since it's the cumulative record
                  ...restState
                } = e.finalState;
                return { ...e, finalState: restState };
              }
              return e;
            });

          // Strip toolResults from payload (already in step.toolsResult)
          let snapshotPayload: unknown = currentContext?.payload;
          if (
            snapshotPayload &&
            typeof snapshotPayload === 'object' &&
            'toolResults' in snapshotPayload
          ) {
            const { toolResults: _tr, ...restPayload } = snapshotPayload as Record<string, unknown>;
            snapshotPayload = restPayload;
          }

          // Compute activatedStepTools delta (newly discovered tools in this step)
          const prevActivated = agentState?.activatedStepTools ?? [];
          const afterActivated = stepResult.newState.activatedStepTools ?? [];
          const activatedStepToolsDelta =
            afterActivated.length > prevActivated.length
              ? afterActivated.slice(prevActivated.length)
              : undefined;

          partial.steps.push({
            activatedStepToolsDelta,
            completedAt: Date.now(),
            content: stepPresentationData.content,
            context: {
              payload: snapshotPayload,
              phase: currentContext?.phase ?? 'unknown',
              stepContext: currentContext?.stepContext,
            },
            events: snapshotEvents,
            executionTimeMs: stepPresentationData.executionTimeMs,
            inputTokens: stepPresentationData.stepInputTokens,
            isCompressionReset: isCompression || undefined,
            messagesBaseline: isBaseline ? prevMessages : undefined,
            messagesDelta,
            outputTokens: stepPresentationData.stepOutputTokens,
            reasoning: stepPresentationData.reasoning,
            startedAt: startAt,
            stepIndex,
            stepType: stepPresentationData.stepType,
            // Store operation-level toolset once at step 0
            toolsetBaseline: stepIndex === 0 ? agentState?.operationToolSet : undefined,
            toolsCalling: stepPresentationData.toolsCalling,
            toolsResult: stepPresentationData.toolsResult,
            totalCost: stepPresentationData.totalCost,
            totalTokens: stepPresentationData.totalTokens,
          });

          await this.snapshotStore.savePartial(operationId, partial);
        } catch (e) {
          log('[%s] snapshot step recording failed: %O', operationId, e);
        }
      }

      // Update step tracking in state metadata and trigger step webhook
      if (stepResult.newState.metadata?.stepWebhook) {
        const prevTracking = stepResult.newState.metadata._stepTracking || {};
        const newTotalToolCalls = (prevTracking.totalToolCalls ?? 0) + (toolsCalling?.length ?? 0);

        // Truncate content to 1800 chars to match Discord message limits
        const truncatedContent = content
          ? content.length > 1800
            ? content.slice(0, 1800) + '...'
            : content
          : prevTracking.lastLLMContent;

        const updatedTracking = {
          lastLLMContent: truncatedContent,
          lastToolsCalling: toolsCalling || prevTracking.lastToolsCalling,
          totalToolCalls: newTotalToolCalls,
        };

        // Persist tracking state for next step
        stepResult.newState.metadata._stepTracking = updatedTracking;
        await this.coordinator.saveAgentState(operationId, stepResult.newState);

        // Fire step webhook (include shouldContinue so the callback knows
        // whether the agent is still running or about to complete)
        await this.triggerStepWebhook(stepResult.newState, operationId, {
          ...stepPresentationData,
          shouldContinue,
        } as unknown as Record<string, unknown>);
      }

      if (willScheduleNextStep) {
        const nextStepIndex = stepIndex + 1;
        const delay = this.calculateStepDelay(stepResult);
        const priority = this.calculatePriority(stepResult);

        // queueService is guaranteed non-null when willScheduleNextStep is true
        const queueService = this.queueService!;
        await queueService.scheduleMessage({
          context: stepResult.nextContext,
          delay,
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority,
          stepIndex: nextStepIndex,
        });

        log('[%s][%d] Scheduled next step %d', operationId, stepIndex, nextStepIndex);
      }

      // Check if operation is complete
      if (!shouldContinue) {
        const reason = this.determineCompletionReason(stepResult.newState);

        // Trigger completion webhook (fire-and-forget)
        await this.triggerCompletionWebhook(stepResult.newState, operationId, reason);

        // Dispatch onComplete hooks
        await this.dispatchCompletionHooks(operationId, stepResult.newState, reason);

        // Call onComplete callback (legacy)
        if (callbacks?.onComplete) {
          try {
            await callbacks.onComplete({
              finalState: stepResult.newState,
              operationId,
              reason,
            });
            // Clean up callbacks after operation completes
            this.unregisterStepCallbacks(operationId);
          } catch (callbackError) {
            log('[%s] onComplete callback error: %O', operationId, callbackError);
          }
        }

        // Finalize tracing snapshot via injected snapshot store
        if (this.snapshotStore) {
          try {
            const partial = await this.snapshotStore.loadPartial(operationId);

            if (partial) {
              const metadata = agentState?.metadata as any;
              const snapshot = {
                agentId: metadata?.agentId,
                completedAt: Date.now(),
                completionReason: reason,
                error: stepResult.newState.error
                  ? {
                      message: String(
                        stepResult.newState.error.message ?? stepResult.newState.error,
                      ),
                      type: String(stepResult.newState.error.type ?? 'unknown'),
                    }
                  : undefined,
                model: partial.model,
                operationId,
                provider: partial.provider,
                startedAt: partial.startedAt ?? Date.now(),
                steps: (partial.steps ?? []).sort((a, b) => a.stepIndex - b.stepIndex),
                totalCost: stepResult.newState.cost?.total ?? 0,
                totalSteps: stepResult.newState.stepCount,
                totalTokens: stepResult.newState.usage?.llm?.tokens?.total ?? 0,
                topicId: metadata?.topicId,
                traceId: operationId,
                userId: metadata?.userId,
              };

              await this.snapshotStore.save(snapshot as any);
              await this.snapshotStore.removePartial(operationId);
            }
          } catch (e) {
            log('[%s] snapshot finalization failed: %O', operationId, e);
          }
        }
      }

      return {
        nextStepScheduled: willScheduleNextStep,
        state: stepResult.newState,
        stepResult,
        success: true,
      };
    } catch (error) {
      log('Step %d failed for operation %s: %O', stepIndex, operationId, error);
      const formattedError = formatErrorForState(error);

      // Build error state — try loading current state from coordinator, but if that
      // also fails (e.g. Redis ECONNRESET), fall back to a minimal error state so
      // that completion callbacks and webhooks can still fire.
      let finalStateWithError: any;
      try {
        await this.streamManager.publishStreamEvent(operationId, {
          data: {
            error: formattedError.message,
            errorType: String(formattedError.type),
            phase: 'step_execution',
            stepIndex,
          },
          stepIndex,
          type: 'error',
        });
      } catch (publishError) {
        log(
          '[%s] Failed to publish error event (infra may be down): %O',
          operationId,
          publishError,
        );
      }

      try {
        const errorState = await this.coordinator.loadAgentState(operationId);
        finalStateWithError = {
          ...errorState!,
          error: formattedError,
          status: 'error' as const,
          stepCount: errorState?.stepCount ?? stepIndex,
        };
      } catch (loadError) {
        log('[%s] Failed to load error state (infra may be down): %O', operationId, loadError);
        // Fallback: construct a minimal error state so callbacks still receive useful info
        finalStateWithError = {
          error: formattedError,
          status: 'error' as const,
          stepCount: stepIndex,
        };
      }

      try {
        await this.coordinator.saveAgentState(operationId, finalStateWithError);
      } catch (saveError) {
        log('[%s] Failed to save error state (infra may be down): %O', operationId, saveError);
      }

      // Trigger completion webhook on error (fire-and-forget)
      try {
        await this.triggerCompletionWebhook(finalStateWithError, operationId, 'error');
      } catch (webhookError) {
        log('[%s] Failed to trigger completion webhook: %O', operationId, webhookError);
      }

      // Dispatch onComplete + onError hooks
      await this.dispatchCompletionHooks(operationId, finalStateWithError, 'error');

      // Also call onComplete callback when execution fails (legacy)
      if (callbacks?.onComplete) {
        try {
          await callbacks.onComplete({
            finalState: finalStateWithError,
            operationId,
            reason: 'error',
          });
          this.unregisterStepCallbacks(operationId);
        } catch (callbackError) {
          log('[%s] onComplete callback error in catch: %O', operationId, callbackError);
        }
      }

      throw error;
    } finally {
      // Release lock so legitimate retries or next operations can proceed.
      // If Vercel force-kills the process, this won't execute — the lock
      // auto-expires after TTL (35s), allowing QStash retries to self-heal.
      await this.coordinator.releaseStepLock(operationId, stepIndex);
      // 注销活跃实例，否则 Map 会随 operation 数量无界增长。
      this.activeRuntimes.delete(operationId);
    }
  }

  /**
   * Get operation status
   */
  async getOperationStatus(params: {
    historyLimit?: number;
    includeHistory?: boolean;
    operationId: string;
  }): Promise<OperationStatusResult | null> {
    const { operationId, includeHistory = false, historyLimit = 10 } = params;

    try {
      log('Getting operation status for %s', operationId);

      // Get current state and metadata
      const [currentState, operationMetadata] = await Promise.all([
        this.coordinator.loadAgentState(operationId),
        this.coordinator.getOperationMetadata(operationId),
      ]);

      // Operation may have expired or does not exist, return null
      if (!currentState || !operationMetadata) {
        log('Operation %s not found (may have expired)', operationId);
        return null;
      }

      // Get execution history (if needed)
      let executionHistory;
      if (includeHistory) {
        try {
          executionHistory = await this.coordinator.getExecutionHistory(operationId, historyLimit);
        } catch (error) {
          log('Failed to load execution history: %O', error);
          executionHistory = [];
        }
      }

      // Get recent stream events (for debugging)
      let recentEvents;
      if (includeHistory) {
        try {
          recentEvents = await this.streamManager.getStreamHistory(operationId, 20);
        } catch (error) {
          log('Failed to load recent events: %O', error);
          recentEvents = [];
        }
      }

      // Calculate operation statistics
      const stats = {
        lastActiveTime: operationMetadata.lastActiveAt
          ? Date.now() - new Date(operationMetadata.lastActiveAt).getTime()
          : 0,
        totalCost: currentState.cost?.total || 0,
        totalMessages: currentState.messages?.length || 0,
        totalSteps: currentState.stepCount || 0,
        uptime: operationMetadata.createdAt
          ? Date.now() - new Date(operationMetadata.createdAt).getTime()
          : 0,
      };

      return {
        currentState: {
          cost: currentState.cost,
          costLimit: currentState.costLimit,
          error: currentState.error,
          interruption: currentState.interruption,
          lastModified: currentState.lastModified,
          maxSteps: currentState.maxSteps,
          pendingHumanPrompt: currentState.pendingHumanPrompt,
          pendingHumanSelect: currentState.pendingHumanSelect,
          pendingToolsCalling: currentState.pendingToolsCalling,
          status: currentState.status,
          stepCount: currentState.stepCount,
          usage: currentState.usage,
        },
        executionHistory: executionHistory?.slice(0, historyLimit),
        hasError: currentState.status === 'error',
        isActive: ['running', 'waiting_for_human'].includes(currentState.status),
        isCompleted: currentState.status === 'done',
        metadata: operationMetadata,
        needsHumanInput: currentState.status === 'waiting_for_human',
        operationId,
        recentEvents: recentEvents?.slice(0, 10),
        stats,
      };
    } catch (error) {
      log('Failed to get operation status for %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Get list of pending human interventions
   */
  async getPendingInterventions(params: {
    operationId?: string;
    userId?: string;
  }): Promise<PendingInterventionsResult> {
    const { operationId, userId } = params;

    try {
      log('Getting pending interventions for operationId: %s, userId: %s', operationId, userId);

      let operations: string[] = [];

      if (operationId) {
        operations = [operationId];
      } else if (userId) {
        // Get all active operations for the user
        try {
          const activeOperations = await this.coordinator.getActiveOperations();

          // Filter operations belonging to this user
          const userOperations = [];
          for (const operation of activeOperations) {
            try {
              const metadata = await this.coordinator.getOperationMetadata(operation);
              if (metadata?.userId === userId) {
                userOperations.push(operation);
              }
            } catch (error) {
              log('Failed to get metadata for operation %s: %O', operation, error);
            }
          }
          operations = userOperations;
        } catch (error) {
          log('Failed to get active operations: %O', error);
          operations = [];
        }
      }

      // Check status of each operation
      const pendingInterventions = [];

      for (const operation of operations) {
        try {
          const [state, metadata] = await Promise.all([
            this.coordinator.loadAgentState(operation),
            this.coordinator.getOperationMetadata(operation),
          ]);

          if (state?.status === 'waiting_for_human') {
            const intervention: any = {
              lastModified: state.lastModified,
              modelRuntimeConfig: metadata?.modelRuntimeConfig,
              operationId: operation,
              status: state.status,
              stepCount: state.stepCount,
              userId: metadata?.userId,
            };

            // Add specific pending content
            if (state.pendingToolsCalling) {
              intervention.type = 'tool_approval';
              intervention.pendingToolsCalling = state.pendingToolsCalling;
            } else if (state.pendingHumanPrompt) {
              intervention.type = 'human_prompt';
              intervention.pendingHumanPrompt = state.pendingHumanPrompt;
            } else if (state.pendingHumanSelect) {
              intervention.type = 'human_select';
              intervention.pendingHumanSelect = state.pendingHumanSelect;
            }

            pendingInterventions.push(intervention);
          }
        } catch (error) {
          log('Failed to get state for operation %s: %O', operation, error);
        }
      }

      return {
        pendingInterventions,
        timestamp: new Date().toISOString(),
        totalCount: pendingInterventions.length,
      };
    } catch (error) {
      log('Failed to get pending interventions: %O', error);
      throw error;
    }
  }

  /**
   * Explicitly start operation execution
   */
  async startExecution(params: StartExecutionParams): Promise<StartExecutionResult> {
    const { operationId, context, priority = 'normal', delay = 50 } = params;

    try {
      log('Starting execution for operation %s', operationId);

      // Check if operation exists
      const operationMetadata = await this.coordinator.getOperationMetadata(operationId);
      if (!operationMetadata) {
        throw new Error(`Operation ${operationId} not found`);
      }

      // Get current state
      const currentState = await this.coordinator.loadAgentState(operationId);
      if (!currentState) {
        throw new Error(`Agent state not found for operation ${operationId}`);
      }

      // Check operation status
      if (currentState.status === 'running') {
        throw new Error(`Operation ${operationId} is already running`);
      }

      if (currentState.status === 'done') {
        throw new Error(`Operation ${operationId} is already completed`);
      }

      if (currentState.status === 'error') {
        throw new Error(`Operation ${operationId} is in error state`);
      }

      // Build execution context
      let executionContext = context;
      if (!executionContext) {
        // If no context provided, build default context from metadata
        // Note: AgentRuntimeContext requires sessionId for compatibility with @lobechat/agent-runtime
        executionContext = {
          payload: {
            isFirstMessage: true,
            message: [{ content: '' }],
          },
          phase: 'user_input' as const,
          session: {
            messageCount: currentState.messages?.length || 0,
            sessionId: operationId,
            status: 'idle' as const,
            stepCount: currentState.stepCount || 0,
          },
        };
      }

      // Update operation status to running
      await this.coordinator.saveAgentState(operationId, {
        ...currentState,
        lastModified: new Date().toISOString(),
        status: 'running',
      });

      // Schedule execution (if queue service is available)
      let messageId: string | undefined;
      if (this.queueService) {
        messageId = await this.queueService.scheduleMessage({
          context: executionContext,
          delay,
          endpoint: `${this.baseURL}/run`,
          operationId,
          priority,
          stepIndex: currentState.stepCount || 0,
        });
        log('Scheduled execution for operation %s (messageId: %s)', operationId, messageId);
      } else {
        log('Queue service disabled, skipping schedule for operation %s', operationId);
      }

      return {
        messageId,
        operationId,
        scheduled: !!messageId,
        success: true,
      };
    } catch (error) {
      log('Failed to start execution for operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Process human intervention
   */
  async processHumanIntervention(params: {
    action: 'approve' | 'reject' | 'input' | 'select';
    approvedToolCall?: any;
    humanInput?: any;
    operationId: string;
    rejectionReason?: string;
    stepIndex: number;
  }): Promise<{ messageId?: string }> {
    const { operationId, stepIndex, action, approvedToolCall, humanInput, rejectionReason } =
      params;

    try {
      log(
        'Processing human intervention for operation %s:%d (action: %s)',
        operationId,
        stepIndex,
        action,
      );

      // Schedule execution with high priority (if queue service is available)
      let messageId: string | undefined;
      if (this.queueService) {
        messageId = await this.queueService.scheduleMessage({
          context: undefined, // Will be retrieved from state manager
          delay: 100,
          endpoint: `${this.baseURL}/run`,
          operationId,
          payload: { approvedToolCall, humanInput, rejectionReason },
          priority: 'high',
          stepIndex,
        });
        log(
          'Scheduled immediate execution for operation %s (messageId: %s)',
          operationId,
          messageId,
        );
      } else {
        log('Queue service disabled, skipping schedule for operation %s', operationId);
      }

      return { messageId };
    } catch (error) {
      log('Failed to process human intervention for operation %s: %O', operationId, error);
      throw error;
    }
  }

  /**
   * Create Agent Runtime instance
   */
  private async createAgentRuntime({
    metadata,
    operationId,
    stepIndex,
  }: {
    metadata?: any;
    operationId: string;
    stepIndex: number;
  }) {
    // Create Durable Agent instance
    const agent = new GeneralChatAgent({
      agentConfig: metadata?.agentConfig,
      compressionConfig: {
        enabled: metadata?.agentConfig?.chatConfig?.enableContextCompression ?? true,
      },
      dynamicInterventionAudits,
      modelRuntimeConfig: metadata?.modelRuntimeConfig,
      operationId,
      userId: metadata?.userId,
    });

    // Create streaming executor context
    const executorContext: RuntimeExecutorContext = {
      agentConfig: metadata?.agentConfig,
      discordContext: metadata?.discordContext,
      userTimezone: metadata?.userTimezone,
      evalContext: metadata?.evalContext,
      messageModel: this.messageModel,
      operationId,
      serverDB: this.serverDB,
      stepIndex,
      stream: metadata?.stream,
      streamManager: this.streamManager,
      toolExecutionService: this.toolExecutionService,
      topicId: metadata?.topicId,
      userId: metadata?.userId,
    };

    // Create Agent Runtime instance
    const runtime = new AgentRuntime(agent as any, {
      executors: createRuntimeExecutors(executorContext),
    });

    return { agent, runtime };
  }

  /**
   * Create default snapshot store based on environment.
   * - ENABLE_AGENT_S3_TRACING=1 → S3SnapshotStore
   * - NODE_ENV=development → FileSnapshotStore
   * - Otherwise → null (no tracing)
   */
  private createDefaultSnapshotStore(): ISnapshotStore | null {
    if (process.env.ENABLE_AGENT_S3_TRACING === '1') {
      try {
        const { S3SnapshotStore } = require('@/server/modules/AgentTracing');
        return new S3SnapshotStore();
      } catch {
        // S3SnapshotStore not available
      }
    }

    if (process.env.NODE_ENV === 'development') {
      try {
        const { FileSnapshotStore } = require('@lobechat/agent-tracing');
        return new FileSnapshotStore();
      } catch {
        // agent-tracing not available
      }
    }

    return null;
  }

  /**
   * Idempotently inject sandbox-eligible topic files before agent step (covers regenerate/continue).
   */
  private async ensureTopicSandboxFilesBeforeStep(state: any): Promise<void> {
    const topicId = state?.metadata?.topicId;
    if (!topicId) return;

    const userId = state?.metadata?.userId || this.userId;

    try {
      const fileService = new FileService(this.serverDB, userId);
      await renewTopicSandboxSession({ topicId });
      await ensureTopicSandboxFiles({
        fileService,
        messageModel: this.messageModel,
        topicId,
      });
    } catch (error) {
      log('[%s] ensureTopicSandboxFilesBeforeStep failed: %O', topicId, error);
    }
  }

  /**
   * Compute device context from DB messages at step boundary.
   * Uses findInMessages visitor to scan tool messages for device activation.
   */
  private async computeDeviceContext(state: any) {
    try {
      const dbMessages = await this.messageModel.query({
        agentId: state.metadata?.agentId,
        threadId: state.metadata?.threadId,
        topicId: state.metadata?.topicId,
      });

      return findInMessages(
        dbMessages,
        (msg) => {
          const activeDeviceId = msg.pluginState?.metadata?.activeDeviceId;
          if (activeDeviceId) {
            return {
              activeDeviceId,
              devicePlatform: msg.pluginState?.metadata?.devicePlatform as string | undefined,
              deviceSystemInfo: msg.pluginState?.metadata?.deviceSystemInfo as
                | Record<string, string>
                | undefined,
            };
          }
        },
        { role: 'tool' },
      );
    } catch (error) {
      log('computeDeviceContext error: %O', error);
    }

    return undefined;
  }

  // ==================== Sub-Agent Bridge (callSubAgent) ====================

  /**
   * Fired when a `callSubAgent` child operation reaches a terminal status.
   * Backfills the parent's placeholder tool message with the child's result,
   * then attempts to resume the parent from `waiting_for_async_tool`.
   */
  async completeSubAgentBridge(params: SubAgentBridgeParams): Promise<boolean> {
    const { operationId, parentOperationId, reason, threadId, toolMessageId } = params;
    const failed = reason === 'error' || reason === 'interrupted';

    const finalState =
      params.finalState ?? (await this.coordinator.loadAgentState(operationId)) ?? undefined;

    log(
      '[%s] sub-agent bridge -> parent %s (reason: %s, state: %s)',
      operationId,
      parentOperationId,
      reason,
      finalState ? 'loaded' : 'missing',
    );

    const childMessages = Array.isArray(finalState?.messages) ? finalState.messages : [];
    const lastAssistant = [...childMessages].reverse().find((m: any) => m?.role === 'assistant');
    const content = failed
      ? `Sub-agent did not complete (${reason}).`
      : (lastAssistant?.content as string | undefined) ||
        'Sub-agent completed without a textual answer.';

    const backfill = await this.messageModel.updateToolMessage(toolMessageId, {
      content,
      pluginError: failed ? { message: content } : undefined,
      pluginState: {
        status: failed ? 'error' : 'completed',
        threadId,
        totalToolCalls: finalState?.usage?.tools?.totalCalls,
        totalTokens: finalState?.usage?.llm?.tokens?.total,
      },
    });

    if (!backfill.success) {
      log(
        '[%s] sub-agent bridge: failed to backfill tool message %s for parent %s',
        operationId,
        toolMessageId,
        parentOperationId,
      );
      return false;
    }

    return this.tryResumeParentFromAsyncTool({ parentOperationId }, { scheduleVerifyOnHold: true });
  }

  /**
   * Attempt to resume a parked (`waiting_for_async_tool`) parent operation.
   * Checks the K=N barrier (every pending deferred tool call fulfilled),
   * then CAS-resumes via the durable `agent_operations` row so only one
   * concurrent completer wins. On success, backfills `state.messages` with
   * the resolved tool result(s) and schedules the resume step.
   */
  private async tryResumeParentFromAsyncTool(
    params: { parentOperationId: string },
    options?: { scheduleVerifyOnHold?: boolean; verifyAttempt?: number },
  ): Promise<boolean> {
    const { parentOperationId } = params;

    const state = await this.coordinator.loadAgentState(parentOperationId);
    if (!state || state.status !== 'waiting_for_async_tool') {
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state ?? null, options);
      return false;
    }

    const pending = (state.pendingToolsCalling ?? []) as ChatToolPayload[];
    if (pending.length === 0) {
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
      return false;
    }

    const fulfilled = await this.allPendingToolsFulfilled(pending);
    if (!fulfilled) {
      await this.maybeScheduleAsyncToolVerify(parentOperationId, state, options);
      return false;
    }

    const parentUserId = state.metadata?.userId || this.userId;
    const won = await new AgentOperationModel(this.serverDB, parentUserId).tryResumeFromAsyncTool(
      parentOperationId,
    );
    if (!won) return false;

    const backfilledMessages = await this.buildBackfilledMessages(state, pending);
    await this.coordinator.saveAgentState(parentOperationId, {
      ...state,
      messages: backfilledMessages,
    });

    if (this.queueService) {
      await this.queueService.scheduleMessage({
        delay: 100,
        endpoint: `${this.baseURL}/run`,
        operationId: parentOperationId,
        payload: { resumeAsyncTool: true },
        priority: 'high',
        stepIndex: state.stepCount,
      });
    }

    log('[%s] sub-agent bridge: resumed', parentOperationId);
    return true;
  }

  /**
   * Bounded re-check for a parent that's parked but not yet resumable
   * (barrier held, or the resume message arrived before this bridge call
   * committed). Self re-arms with exponential backoff up to
   * `ASYNC_TOOL_VERIFY_MAX_ATTEMPTS`; after that it gives up — a genuinely
   * dead child is instead caught by the separate dead-operation watchdog.
   */
  private async maybeScheduleAsyncToolVerify(
    parentOperationId: string,
    state: AgentState | null,
    options?: { scheduleVerifyOnHold?: boolean; verifyAttempt?: number },
  ): Promise<void> {
    if (!options?.scheduleVerifyOnHold || !this.queueService) return;

    const status = state?.status;
    if (status === 'done' || status === 'error' || status === 'interrupted') return;

    const attempt = options.verifyAttempt ?? 1;
    if (attempt > ASYNC_TOOL_VERIFY_MAX_ATTEMPTS) {
      log(
        '[%s] async-tool verify exhausted after %d attempts — giving up re-arming',
        parentOperationId,
        attempt - 1,
      );
      return;
    }

    const delay = asyncToolVerifyDelayMs(attempt);
    await this.queueService.scheduleMessage({
      delay,
      endpoint: `${this.baseURL}/run`,
      operationId: parentOperationId,
      payload: { asyncToolVerifyAttempt: attempt, verifyAsyncToolBarrier: true },
      priority: 'high',
      stepIndex: state?.stepCount ?? 0,
    });
  }

  /**
   * K=N barrier check: every pending deferred/client tool call must have a
   * fulfilled `tool` message (non-empty content, or a terminal
   * `pluginState.status`) before the parent can resume.
   */
  private async allPendingToolsFulfilled(pending: ChatToolPayload[]): Promise<boolean> {
    if (pending.length === 0) return true;

    const rows = await this.serverDB
      .select({
        content: messages.content,
        state: messagePlugins.state,
        toolCallId: messagePlugins.toolCallId,
      })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(
        inArray(
          messagePlugins.toolCallId,
          pending.map((p) => p.id),
        ),
      );

    const byCallId = new Map(rows.map((r) => [r.toolCallId, r]));

    return pending.every((p) => {
      const row = byCallId.get(p.id);
      if (!row) return false;
      const status = (row.state as { status?: string } | null)?.status;
      return !!row.content || status === 'completed' || status === 'error';
    });
  }

  /**
   * Append `{role:'tool', tool_call_id, content}` entries for each pending
   * tool call not already present in `state.messages`, pulling the
   * now-fulfilled content from the DB tool message. This is what lets the
   * resumed step's LLM call see the sub-agent's result.
   */
  private async buildBackfilledMessages(
    state: AgentState,
    pending: ChatToolPayload[],
  ): Promise<any[]> {
    const existingToolCallIds = new Set(
      (state.messages ?? [])
        .filter((m: any) => m?.role === 'tool' && m?.tool_call_id)
        .map((m: any) => m.tool_call_id),
    );

    const missing = pending.filter((p) => !existingToolCallIds.has(p.id));
    if (missing.length === 0) return state.messages ?? [];

    const rows = await this.serverDB
      .select({ content: messages.content, toolCallId: messagePlugins.toolCallId })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(
        inArray(
          messagePlugins.toolCallId,
          missing.map((p) => p.id),
        ),
      );

    const contentByCallId = new Map(rows.map((r) => [r.toolCallId, r.content]));

    const appended = missing.map((p) => ({
      content: contentByCallId.get(p.id) ?? '',
      role: 'tool',
      tool_call_id: p.id,
    }));

    return [...(state.messages ?? []), ...appended];
  }

  /**
   * Handle human intervention logic
   */
  private async handleHumanIntervention(
    runtime: AgentRuntime,
    state: any,
    intervention: { approvedToolCall?: any; humanInput?: any; rejectionReason?: string },
  ) {
    const { humanInput, approvedToolCall, rejectionReason } = intervention;

    // 这三个分支此前都是 `// TODO: implement ... logic` 并原样返回 state ——
    // 即 approve/reject/input 全部**无操作**：`pendingToolsCalling` 不清、status 不变，
    // operation 永久停在 `waiting_for_human`（附录 C-2 实测：调用后 25 秒内状态纹丝不动）。
    // 下面按 runtime 已支持的 phase 语义补上。

    // ⚠️ 不能再用 `state.status === 'waiting_for_human'` 做判据。
    // executeStep 在入口处已把 status 置为 'running'（B-3 的修复，让监控能区分
    // 「空闲」与「正在执行」），等走到这里状态早就不是 waiting_for_human 了 ——
    // 沿用旧判据会让 approve/reject 分支永远进不去，pendingToolsCalling 依旧不清。
    // 改以「调用方确实带来了干预数据」为准。
    if (approvedToolCall) {
      const newState = {
        ...state,
        // 清掉待审队列，否则下一步又会被判定为「仍在等人」
        pendingToolsCalling: [],
        status: 'running',
      };

      // runtime.step() 见到 phase === 'human_approved_tool' 会直接合成 call_tool 指令
      // （runtime.ts:109-124），无需再过一遍 Brain。
      return {
        newState,
        nextContext: {
          payload: {
            approvedToolCall,
            parentMessageId: state.pendingToolsCalling?.[0]?.parentMessageId,
            skipCreateToolMessage: false,
          },
          phase: 'human_approved_tool' as const,
        },
      };
    }

    if (rejectionReason) {
      // 拒绝：把理由作为工具结果回灌，让模型知道这次调用被人否了，
      // 而不是把整个 operation 挂死。
      const rejected = (state.pendingToolsCalling ?? []) as ChatToolPayload[];
      const rejectionMessages = rejected.map((call) => ({
        content: `Tool call rejected by user. Reason: ${rejectionReason}`,
        role: 'tool',
        tool_call_id: call.id,
      }));

      const newState = {
        ...state,
        messages: [...(state.messages ?? []), ...rejectionMessages],
        pendingToolsCalling: [],
        status: 'running',
      };

      return {
        newState,
        nextContext: { payload: { rejectionReason }, phase: 'human_abort' as const },
      };
    }

    if (humanInput) {
      // 追问/选项回填：清掉 pending 标记并把用户输入交回 Brain。
      const newState = {
        ...state,
        pendingHumanPrompt: undefined,
        pendingHumanSelect: undefined,
        status: 'running',
      };

      return {
        newState,
        nextContext: { payload: { humanInput }, phase: 'human_response' as const },
      };
    }

    return { newState: state, nextContext: undefined };
  }

  /**
   * Deliver a webhook payload via fetch or QStash.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async deliverWebhook(
    url: string,
    payload: Record<string, unknown>,
    delivery: 'fetch' | 'qstash' = 'fetch',
    operationId: string,
  ): Promise<void> {
    try {
      if (delivery === 'qstash' && process.env.ZXQSTASH_TOKEN) {
        const { qstashClient } = await import('@/libs/qstash');
        const { publishJSON } = qstashClient;
        await publishJSON({
          body: payload,
          headers: { 'Content-Type': 'application/json' },
          url,
        });
      } else {
        await fetch(url, {
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        });
      }
    } catch (error) {
      console.error('[%s] Webhook delivery failed (fetch → %s):', operationId, url, error);
    }
  }

  /**
   * Dispatch onComplete (and onError) hooks via HookDispatcher.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async dispatchCompletionHooks(
    operationId: string,
    state: any,
    reason: string,
  ): Promise<void> {
    try {
      const metadata = state?.metadata || {};

      // Extract last assistant content (same as triggerCompletionWebhook)
      const lastAssistantContent = state?.messages
        ?.slice()
        .reverse()
        .find(
          (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
        )?.content;

      const duration = state?.createdAt
        ? Date.now() - new Date(state.createdAt).getTime()
        : undefined;

      const event = {
        agentId: metadata?.agentId || '',
        cost: state?.cost?.total,
        duration,
        errorDetail: state?.error,
        errorMessage: this.extractErrorMessage?.(state?.error) || String(state?.error || ''),
        // Full state available in local mode only (not serialized to webhooks)
        finalState: state,
        lastAssistantContent,
        llmCalls: state?.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state?.status || reason,
        steps: state?.stepCount || 0,
        toolCalls: state?.usage?.tools?.totalCalls,
        topicId: metadata?.topicId,
        totalTokens: state?.usage?.llm?.tokens?.total,
        userId: metadata?.userId || this.userId,
      };

      // Dispatch onComplete hooks
      await hookDispatcher.dispatch(operationId, 'onComplete', event, metadata._hooks);

      // Also dispatch onError hooks if reason is error
      if (reason === 'error') {
        await hookDispatcher.dispatch(operationId, 'onError', event, metadata._hooks);
      }

      // Cleanup hooks after completion
      hookDispatcher.unregister(operationId);
    } catch (error) {
      log('[%s] Hook dispatch error (non-fatal): %O', operationId, error);
    }
  }

  /**
   * Trigger completion webhook if configured in state metadata.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async triggerCompletionWebhook(
    state: any,
    operationId: string,
    reason: StepCompletionReason,
  ): Promise<void> {
    const webhook = state.metadata?.completionWebhook;
    if (!webhook?.url) return;

    log('[%s] Triggering completion webhook: %s', operationId, webhook.url);

    const duration = state.createdAt ? Date.now() - new Date(state.createdAt).getTime() : undefined;

    // Extract last assistant content from state messages
    const lastAssistantContent = state.messages
      ?.slice()
      .reverse()
      .find(
        (m: { content?: string; role: string }) => m.role === 'assistant' && m.content,
      )?.content;

    // Extract first user prompt for downstream consumers (e.g., topic title summarization)
    const userPrompt = state.messages?.find(
      (m: { content?: string; role: string }) => m.role === 'user',
    )?.content;

    const delivery = state.metadata?.webhookDelivery || 'fetch';

    await this.deliverWebhook(
      webhook.url,
      {
        ...webhook.body,
        cost: state.cost?.total,
        duration,
        errorDetail: state.error,
        errorMessage: this.extractErrorMessage(state.error),
        lastAssistantContent,
        llmCalls: state.usage?.llm?.apiCalls,
        operationId,
        reason,
        status: state.status,
        steps: state.stepCount,
        toolCalls: state.usage?.tools?.totalCalls,
        topicId: state.metadata?.topicId,
        totalTokens: state.usage?.llm?.tokens?.total,
        type: 'completion',
        userId: state.metadata?.userId,
        userPrompt,
      },
      delivery,
      operationId,
    );
  }

  /**
   * Trigger step webhook if configured in state metadata.
   * Reads accumulated step tracking data and fires webhook with step presentation data.
   * Fire-and-forget: errors are logged but never thrown.
   */
  private async triggerStepWebhook(
    state: any,
    operationId: string,
    presentationData: Record<string, unknown>,
  ): Promise<void> {
    const webhook = state.metadata?.stepWebhook;
    if (!webhook?.url) return;

    log('[%s] Triggering step webhook: %s', operationId, webhook.url);

    const tracking = state.metadata?._stepTracking || {};
    const delivery = state.metadata?.webhookDelivery || 'fetch';
    const elapsedMs = state.createdAt
      ? Date.now() - new Date(state.createdAt).getTime()
      : undefined;

    await this.deliverWebhook(
      webhook.url,
      {
        ...webhook.body,
        ...presentationData,
        elapsedMs,
        lastLLMContent: tracking.lastLLMContent,
        lastToolsCalling: tracking.lastToolsCalling,
        operationId,
        totalToolCalls: tracking.totalToolCalls ?? 0,
        type: 'step',
      },
      delivery,
      operationId,
    );
  }

  /**
   * Extract a human-readable error message from the agent state error object.
   * Handles both raw ChatCompletionErrorPayload (from runtime.step catch) and
   * formatted ChatMessageError (from executeStep catch).
   */
  private extractErrorMessage(error: any): string | undefined {
    if (!error) return undefined;

    // Path B: formatted ChatMessageError — { body, message, type }
    // Try to extract meaningful info from body first
    if (error.body) {
      const body = error.body;
      // OpenAI-style: body.error.message
      if (body.error?.message) return body.error.message;
      // Direct message on body
      if (body.message) return body.message;
    }

    // Path A: raw ChatCompletionErrorPayload — { errorType, error: {...}, provider }
    if (error.error) {
      const inner = error.error;
      if (inner.error?.message) return inner.error.message;
      if (inner.message) return inner.message;
    }

    // Fallback to message or type
    if (error.message && error.message !== 'error') return error.message;
    if (error.type || error.errorType) return String(error.type || error.errorType);

    return undefined;
  }

  /**
   * Decide whether to continue execution
   */
  private shouldContinueExecution(state: any, context?: any): boolean {
    // 硬上限：步数超过 maxSteps 一定幅度后**无条件**停。
    //
    // runtime.step() 的 maxSteps 处理只是把 `forceFinish` 置真 ——
    // 它的语义是「剥掉工具、注入收尾 prompt，请模型给个最终答复」，
    // 属于**软收敛，依赖模型配合**。模型（或 mock）若继续返回 tool_calls，
    // 循环照样无限跑下去：实测显式传 maxSteps=6 仍跑到 106 步。
    // 因此这里补一道不依赖模型的硬闸，留少量余量让 forceFinish 有机会正常收尾。
    const hardCap = state.maxSteps ? state.maxSteps + MAX_STEPS_GRACE : undefined;
    if (hardCap && state.stepCount >= hardCap) {
      log(
        '[%s] Hard step cap reached (%d >= %d), stopping unconditionally',
        state.operationId,
        state.stepCount,
        hardCap,
      );
      return false;
    }

    // Completed
    if (state.status === 'done') return false;

    // Needs human intervention
    if (state.status === 'waiting_for_human') return false;

    // Parked waiting on a deferred/async tool (e.g. callSubAgent) — the
    // completion bridge schedules the resume step explicitly, not this loop
    if (state.status === 'waiting_for_async_tool') return false;

    // Error occurred
    if (state.status === 'error') return false;

    // Interrupted
    if (state.status === 'interrupted') return false;

    // maxSteps is handled by runtime.step() which sets forceFinish → status:'done'
    // No redundant check here — trust the runtime state machine

    // Exceeded cost limit
    //
    // `?? 0` 不能省：老的持久化状态里可能没有 cost，那时这个判断是
    // `undefined >= N`，恒为 false —— 熔断看着配了、实际从不生效。
    if (state.costLimit && (state.cost?.total ?? 0) >= state.costLimit.maxTotalCost) {
      return state.costLimit.onExceeded !== 'stop';
    }

    // No next context
    if (!context) return false;

    return true;
  }

  /**
   * Calculate step delay
   */
  private calculateStepDelay(stepResult: any): number {
    const baseDelay = 50;

    // If there are tool calls, add longer delay
    if (stepResult.events?.some((e: any) => e.type === 'tool_result')) {
      return baseDelay + 50;
    }

    // If there are errors, use exponential backoff
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return Math.min(baseDelay * 2, 1000);
    }

    return baseDelay;
  }

  /**
   * Calculate priority
   */
  private calculatePriority(stepResult: any): 'high' | 'normal' | 'low' {
    // If human intervention needed, high priority
    if (stepResult.newState?.status === 'waiting_for_human') {
      return 'high';
    }

    // If there are errors, normal priority
    if (stepResult.events?.some((e: any) => e.type === 'error')) {
      return 'normal';
    }

    return 'normal';
  }

  /**
   * Determine operation completion reason
   */
  private determineCompletionReason(state: AgentState): StepCompletionReason {
    if (state.status === 'done') return 'done';
    if (state.status === 'error') return 'error';
    if (state.status === 'interrupted') return 'interrupted';
    if (state.status === 'waiting_for_human') return 'waiting_for_human';
    if (state.status === 'waiting_for_async_tool') return 'waiting_for_async_tool';
    if (state.maxSteps && state.stepCount >= state.maxSteps) return 'max_steps';
    if (state.costLimit && (state.cost?.total ?? 0) >= state.costLimit.maxTotalCost)
      return 'cost_limit';
    return 'done';
  }

  /**
   * Synchronously execute Agent operation until completion
   *
   * Used in test scenarios, doesn't depend on QueueService, executes all steps directly in the current process.
   *
   * @param operationId Operation ID
   * @param options Execution options
   * @returns Final state
   *
   * @example
   * ```ts
   * // Create operation (without auto-starting queue)
   * const result = await service.createOperation({ ...params, autoStart: false });
   *
   * // Synchronously execute to completion
   * const finalState = await service.executeSync(result.operationId);
   * expect(finalState.status).toBe('done');
   * ```
   */
  async executeSync(
    operationId: string,
    options?: {
      /** Initial context (if not provided, inferred from state) */
      initialContext?: AgentRuntimeContext;
      /** Maximum step limit to prevent infinite loops, defaults to 9999 */
      maxSteps?: number;
      /** Callback after each step execution (for debugging) */
      onStepComplete?: (stepIndex: number, state: AgentState) => void;
    },
  ): Promise<AgentState> {
    const { maxSteps = 999, onStepComplete, initialContext } = options ?? {};

    log('[%s] Starting sync execution (maxSteps: %d)', operationId, maxSteps);

    // Load initial state
    const initialState = await this.coordinator.loadAgentState(operationId);
    if (!initialState) {
      throw new Error(`Agent state not found for operation ${operationId}`);
    }

    let state: AgentState = initialState;

    // Build initial context
    // Priority: explicit initialContext param > saved initialContext in state > default
    let context: AgentRuntimeContext | undefined =
      initialContext ??
      (state as any).initialContext ??
      ({
        payload: {},
        phase: 'user_input' as const,
        session: {
          messageCount: state.messages?.length ?? 0,
          sessionId: operationId,
          status: state.status,
          stepCount: state.stepCount,
        },
      } as AgentRuntimeContext);

    let stepIndex = state.stepCount;

    // Execution loop
    while (stepIndex < maxSteps) {
      // Check termination conditions
      if (state.status === 'done' || state.status === 'error' || state.status === 'interrupted') {
        log('[%s] Sync execution finished with status: %s', operationId, state.status);
        break;
      }

      // Check if human intervention is needed
      if (state.status === 'waiting_for_human') {
        log('[%s] Sync execution paused: waiting for human intervention', operationId);
        break;
      }

      // Execute one step
      log('[%s][%d] Start executing...', operationId, stepIndex);
      const result = await this.executeStep({
        context,
        operationId,
        stepIndex,
      });

      state = result.state as AgentState;
      context = result.stepResult.nextContext;
      stepIndex++;

      // Callback
      if (onStepComplete) {
        onStepComplete(stepIndex, state);
      }

      // Check if should continue
      if (!this.shouldContinueExecution(state, context)) {
        log('[%s] Sync execution stopped: shouldContinue=false', operationId);
        break;
      }
    }

    if (stepIndex >= maxSteps) {
      log('[%s] Sync execution stopped: reached maxSteps (%d)', operationId, maxSteps);
      // If stopped due to executeSync's maxSteps limit, need to manually call onComplete
      // Note: If stopped due to state.maxSteps being reached, onComplete has already been called in executeStep
      const callbacks = this.getStepCallbacks(operationId);
      if (callbacks?.onComplete && state.status !== 'done' && state.status !== 'error') {
        try {
          await callbacks.onComplete({
            finalState: state,
            operationId,
            reason: 'max_steps',
          });
          this.unregisterStepCallbacks(operationId);
        } catch (callbackError) {
          log('[%s] onComplete callback error in executeSync: %O', operationId, callbackError);
        }
      }
    }

    return state;
  }

  /**
   * Get Coordinator instance (for testing)
   */
  getCoordinator(): AgentRuntimeCoordinator {
    return this.coordinator;
  }

  private recordMarketAgentUsage = async (localAgentId: string) => {
    const agentModel = new AgentModel(this.serverDB, this.userId);
    const config = await agentModel.getAgentConfigById(localAgentId);
    if (!config?.marketIdentifier && !config?.installedFromMarketIdentifier) return;

    const marketIdentifier = config.marketIdentifier ?? config.installedFromMarketIdentifier!;

    scheduleMarketUsageReport({
      agentId: localAgentId,
      identifier: marketIdentifier,
      serverDB: this.serverDB,
      type: 'agent',
      userId: this.userId,
    });
  };
}
