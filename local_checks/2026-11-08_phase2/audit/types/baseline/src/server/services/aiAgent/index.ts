import type { AgentRuntimeContext, AgentState } from '@lobechat/agent-runtime';
import { BUILTIN_AGENT_SLUGS, getAgentRuntimeConfig } from '@lobechat/builtin-agents';
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import { builtinSkills, SANDBOX_BUILTIN_SKILL_IDENTIFIERS } from '@lobechat/builtin-skills';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import {
  type DeviceAttachment,
  generateSystemPrompt,
  RemoteDeviceManifest,
} from '@lobechat/builtin-tool-remote-device';
import { builtinTools, manualModeExcludeToolIds } from '@lobechat/builtin-tools';
import { LOADING_FLAT } from '@lobechat/const';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { LobeChatDatabase } from '@lobechat/database';
import type {
  ChatTopicBotContext,
  ExecAgentParams,
  ExecAgentResult,
  ExecGroupAgentParams,
  ExecGroupAgentResult,
  ExecSubAgentTaskParams,
  ExecSubAgentTaskResult,
  UserInterventionConfig,
} from '@lobechat/types';
import { ThreadStatus, ThreadType } from '@lobechat/types';
import { messagesHaveSandboxFiles, nanoid, shouldProcessFileInSandbox } from '@lobechat/utils';
import debug from 'debug';

import { serverFeatureFlags } from '@/config/featureFlags';
import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { AiModelModel } from '@/database/models/aiModel';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { TaskModel } from '@/database/models/task';
import { ThreadModel } from '@/database/models/thread';
import { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';
import { UserPersonaModel } from '@/database/models/userMemory/persona';
import { resolveExecutionPlan } from '@/helpers/executionTarget';
import { filterBuiltinSkills } from '@/helpers/skillFilters';
import {
  createServerAgentToolsEngine,
  type EvalContext,
  type ServerAgentToolsContext,
} from '@/server/modules/Mecha';
import { type ServerUserMemoryConfig } from '@/server/modules/Mecha/ContextEngineering/types';
import { AgentService } from '@/server/services/agent';
import type { AgentRuntimeServiceOptions } from '@/server/services/agentRuntime';
import { AgentRuntimeService } from '@/server/services/agentRuntime';
import { getAbortError, throwIfAborted } from '@/server/services/agentRuntime/abort';
import { type AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { type StepLifecycleCallbacks } from '@/server/services/agentRuntime/types';
import { FileService } from '@/server/services/file';
import { KlavisService } from '@/server/services/klavis';
import { MarketService } from '@/server/services/market';
import {
  collectSandboxFileIdsFromTopic,
  renewTopicSandboxSession,
} from '@/server/services/market/openSandbox';
import { preInjectSandboxFiles } from '@/server/services/market/preInjectSandboxFiles';
import { deviceProxy } from '@/server/services/toolExecution/deviceProxy';

import { buildDeviceStatusNotice } from './deviceStatusNotice';
import { ingestAttachment } from './ingestAttachment';

const log = debug('lobe-server:ai-agent-service');

const isDbSkillAvailableForRuntime = (
  skill: { webSafeScanPassed?: boolean },
  activeDeviceId?: string,
) => !!activeDeviceId || skill.webSafeScanPassed !== false;

const buildUnavailableSkillsNotice = (
  skills: Array<{ description?: string | null; name: string }>,
): string | undefined => {
  if (skills.length === 0) return undefined;

  const skillTags = skills
    .map((skill) => `  <skill name="${skill.name}">${skill.description ?? ''}</skill>`)
    .join('\n');

  return `<unavailable_skills>
${skillTags}
</unavailable_skills>

These skills were uploaded through desktop or imported without passing the web security scan. They are not available in web/cloud execution. Do not call runSkill for them. If the user asks about them, explain that they need to sync it to web first.`;
};

/**
 * Format error for storage in thread metadata
 * Handles Error objects which don't serialize properly with JSON.stringify
 */
function formatErrorForMetadata(error: unknown): Record<string, any> | undefined {
  if (!error) return undefined;

  // Handle Error objects
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  // Handle objects with message property (like ChatMessageError)
  if (typeof error === 'object' && 'message' in error) {
    return error as Record<string, any>;
  }

  // Fallback: wrap in object
  return { message: String(error) };
}

/**
 * Internal params for execAgent with step lifecycle callbacks
 * This extends the public ExecAgentParams with server-side only options
 */
interface InternalExecAgentParams extends ExecAgentParams {
  /** Extra builtin tool/skill ids to mount for this run (e.g. task skill, brief tool) */
  additionalPluginIds?: string[];
  /** DB file IDs already uploaded (e.g. Group chat attachments) */
  attachmentFileIds?: string[];
  /** Bot context for topic metadata (platform, applicationId, platformThreadId) */
  botContext?: ChatTopicBotContext;
  /**
   * Bot platform runtime hints (e.g. whether the platform renders markdown).
   * Used to nudge the agent's output format and surface file warnings.
   */
  botPlatformContext?: {
    platformName: string;
    supportsMarkdown: boolean;
    warnings?: string[];
  };
  /**
   * Completion webhook configuration
   * Persisted in Redis state, triggered via HTTP POST when the operation completes.
   */
  completionWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
  /** Cron job ID that triggered this execution (if trigger is 'cron') */
  cronJobId?: string;
  /** Discord context for injecting channel/guild info into agent system message */
  discordContext?: any;
  /** Eval context for injecting environment prompts into system message */
  evalContext?: EvalContext;
  /**
   * Files to attach to the user message. Either a pre-downloaded `buffer`
   * (bot platform attachments) or an external `url` (downloaded then uploaded).
   */
  files?: Array<{
    buffer?: Buffer;
    mimeType?: string;
    name?: string;
    size?: number;
    url?: string;
  }>;
  /** External lifecycle hooks (auto-adapt to local/production mode) */
  hooks?: AgentHook[];
  /** Maximum steps for the agent operation */
  maxSteps?: number;
  /**
   * Abort signal for startup work (before an operationId exists).
   * Bot platforms pass this so an early `/stop` cancels in-flight startup.
   */
  signal?: AbortSignal;
  /** Step lifecycle callbacks for operation tracking (server-side only) */
  stepCallbacks?: StepLifecycleCallbacks;
  /**
   * Step webhook configuration
   * Persisted in Redis state, triggered via HTTP POST after each step completes.
   */
  stepWebhook?: {
    body?: Record<string, unknown>;
    url: string;
  };
  /**
   * Whether the LLM call should use streaming.
   * Defaults to true. Set to false for non-streaming scenarios (e.g., bot integrations).
   */
  stream?: boolean;
  /** Task ID or identifier that triggered this execution (if trigger is 'task') */
  taskId?: string;
  /**
   * Custom title for the topic.
   * When provided (including empty string), overrides the default prompt-based title.
   * When undefined, falls back to prompt.slice(0, 50).
   */
  title?: string;
  /** Topic creation trigger source ('cron' | 'chat' | 'api') */
  trigger?: string;
  /**
   * User intervention configuration
   * Use { approvalMode: 'headless' } for async tasks that should never wait for human approval
   */
  userInterventionConfig?: UserInterventionConfig;
  /**
   * Webhook delivery method.
   * - 'fetch': plain HTTP POST (default)
   * - 'qstash': deliver via QStash publishJSON for guaranteed delivery
   */
  webhookDelivery?: 'fetch' | 'qstash';
}

/**
 * AI Agent Service
 *
 * Encapsulates agent execution logic that can be triggered via:
 * - tRPC router (aiAgent.execAgent)
 * - REST API endpoint (/api/agent)
 * - Cron jobs / scheduled tasks
 */
export class AiAgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentModel: AgentModel;
  private readonly agentService: AgentService;
  private readonly messageModel: MessageModel;
  private readonly taskModel: TaskModel;
  private readonly pluginModel: PluginModel;
  private readonly threadModel: ThreadModel;
  private readonly topicModel: TopicModel;
  private readonly agentRuntimeService: AgentRuntimeService;
  private readonly marketService: MarketService;
  private readonly klavisService: KlavisService;

  constructor(
    db: LobeChatDatabase,
    userId: string,
    options?: { runtimeOptions?: AgentRuntimeServiceOptions },
  ) {
    this.userId = userId;
    this.db = db;
    this.agentModel = new AgentModel(db, userId);
    this.agentService = new AgentService(db, userId);
    this.messageModel = new MessageModel(db, userId);
    this.taskModel = new TaskModel(db, userId);
    this.pluginModel = new PluginModel(db, userId);
    this.threadModel = new ThreadModel(db, userId);
    this.topicModel = new TopicModel(db, userId);
    this.agentRuntimeService = new AgentRuntimeService(db, userId, options?.runtimeOptions);
    this.marketService = new MarketService({ serverDB: db, userInfo: { userId } });
    this.klavisService = new KlavisService({ db, userId });
  }

  /**
   * Resolve a task identifier (e.g. human-readable `T-1`) or FK id to the
   * canonical task id. Returns undefined when no task is provided or found.
   */
  private async resolveOperationTaskId(
    idOrIdentifier?: string | null,
  ): Promise<string | undefined> {
    if (!idOrIdentifier) return;
    const task = await this.taskModel.resolve(idOrIdentifier);
    return task?.id;
  }

  /**
   * Execute agent with just a prompt
   *
   * This is a simplified API that requires agent identifier (id or slug) and prompt.
   * All necessary data (agent config, tools, messages) will be fetched from the database.
   *
   * Architecture:
   * execAgent({ agentId | slug, prompt })
   *   → AgentModel.getAgentConfig(idOrSlug)
   *   → ServerMechaModule.AgentToolsEngine(config)
   *   → ServerMechaModule.ContextEngineering(input, config, messages)
   *   → AgentRuntimeService.createOperation(...)
   */
  async execAgent(params: InternalExecAgentParams): Promise<ExecAgentResult> {
    const {
      agentId,
      slug,
      prompt,
      appContext,
      autoStart = true,
      botContext,
      botPlatformContext,
      discordContext,
      existingMessageIds = [],
      files,
      hooks,
      instructions,
      signal,
      stepCallbacks,
      stream,
      title,
      trigger,
      cronJobId,
      taskId,
      additionalPluginIds,
      evalContext,
      maxSteps,
      userInterventionConfig,
      completionWebhook,
      stepWebhook,
      webhookDelivery,
    } = params;

    // Validate that either agentId or slug is provided
    if (!agentId && !slug) {
      throw new Error('Either agentId or slug must be provided');
    }

    // Determine the identifier to use (agentId takes precedence)
    const identifier = agentId || slug!;

    log('execAgent: identifier=%s, prompt=%s', identifier, prompt.slice(0, 50));

    // Abort early when the caller (e.g. a bot `/stop`) cancelled before startup.
    throwIfAborted(signal, 'Agent execution aborted before startup');
    const throwIfExecutionAborted = (stage: string): void => {
      if (!signal?.aborted) return;
      throw getAbortError(signal, `Agent execution aborted during ${stage}`);
    };

    // 1. Get agent configuration with default config merged (supports both id and slug)
    const agentConfig = await this.agentService.getAgentConfig(identifier);
    if (!agentConfig) {
      throw new Error(`Agent not found: ${identifier}`);
    }

    // Use actual agent ID from config for subsequent operations
    const resolvedAgentId = agentConfig.id;

    log(
      'execAgent: got agent config for %s (id: %s), model: %s, provider: %s',
      identifier,
      resolvedAgentId,
      agentConfig.model,
      agentConfig.provider,
    );

    // 2. Merge builtin agent runtime config (systemRole, plugins)
    // The DB only stores persist config. Runtime config (e.g. inbox systemRole) is generated dynamically.
    const agentSlug = agentConfig.slug;
    const builtinSlugs = Object.values(BUILTIN_AGENT_SLUGS) as string[];
    if (agentSlug && builtinSlugs.includes(agentSlug)) {
      const runtimeConfig = getAgentRuntimeConfig(agentSlug, {
        model: agentConfig.model,
        plugins: agentConfig.plugins ?? [],
      });
      if (runtimeConfig) {
        // Runtime systemRole takes effect only if DB has no user-customized systemRole
        if (!agentConfig.systemRole && runtimeConfig.systemRole) {
          agentConfig.systemRole = runtimeConfig.systemRole;
          log('execAgent: merged builtin agent runtime systemRole for slug=%s', agentSlug);
        }
        // Runtime plugins merged (runtime plugins take priority if provided)
        if (runtimeConfig.plugins && runtimeConfig.plugins.length > 0) {
          agentConfig.plugins = runtimeConfig.plugins;
          log('execAgent: merged builtin agent runtime plugins for slug=%s', agentSlug);
        }
      }
    }

    // 2.5. Append additional instructions to agent's systemRole
    if (instructions) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${instructions}`
        : instructions;
      log('execAgent: appended additional instructions to systemRole');
    }

    // 2.6. Inject bot platform hints (markdown support + file warnings) into systemRole.
    // Chat platforms like Feishu don't render markdown, so the agent is asked to
    // reply in plain text; warnings surface issues like oversized attachments.
    if (botPlatformContext) {
      const hints: string[] = [];
      if (!botPlatformContext.supportsMarkdown) {
        hints.push(
          `You are replying through ${botPlatformContext.platformName}, which does not render Markdown. Respond in plain text without Markdown syntax (no **, #, backticks, tables, or link syntax).`,
        );
      }
      if (botPlatformContext.warnings?.length) {
        hints.push(`Note about the user's attachments:\n${botPlatformContext.warnings.join('\n')}`);
      }
      if (hints.length > 0) {
        const hintBlock = hints.join('\n\n');
        agentConfig.systemRole = agentConfig.systemRole
          ? `${agentConfig.systemRole}\n\n${hintBlock}`
          : hintBlock;
        log('execAgent: injected bot platform hints into systemRole');
      }
    }

    // Resolve a task identifier (e.g. `T-1`) or FK id to the canonical task id.
    // Used to stamp topic metadata so the task detail view can correlate topics.
    const operationTaskId = await this.resolveOperationTaskId(taskId);

    // 3. Handle topic creation: if no topicId provided, create a new topic; otherwise reuse existing
    let topicId = appContext?.topicId;
    if (!topicId) {
      // Prepare metadata with cronJobId, taskId and botContext if provided
      const metadata =
        cronJobId || operationTaskId || botContext
          ? {
              bot: botContext,
              cronJobId: cronJobId || undefined,
              taskId: operationTaskId || undefined,
            }
          : undefined;

      const newTopic = await this.topicModel.create({
        agentId: resolvedAgentId,
        metadata,
        title:
          title !== undefined ? title : prompt.slice(0, 50) + (prompt.length > 50 ? '...' : ''),
        trigger,
      });
      topicId = newTopic.id;
      log(
        'execAgent: created new topic %s with trigger %s, cronJobId %s, taskId %s',
        topicId,
        trigger || 'default',
        cronJobId || 'none',
        operationTaskId || 'none',
      );
    } else {
      log('execAgent: reusing existing topic %s', topicId);
    }

    // Extract model and provider from agent config
    const model = agentConfig.model!;
    const provider = agentConfig.provider!;

    // 4. Get installed plugins from database
    const installedPlugins = await this.pluginModel.query();
    log('execAgent: got %d installed plugins', installedPlugins.length);

    // 5. Get model abilities from model-bank for function calling support check
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');
    const isModelSupportToolUse = (m: string, p: string) => {
      const info = LOBE_DEFAULT_MODEL_LIST.find((item) => item.id === m && item.providerId === p);
      return info?.abilities?.functionCall ?? true;
    };

    // 6. Fetch TripYoYo Skills manifests (temporary solution until LOBE-3517 is implemented)
    let lobehubSkillManifests: LobeToolManifest[] = [];
    try {
      lobehubSkillManifests = await this.marketService.getLobehubSkillManifests();
    } catch (error) {
      log('execAgent: failed to fetch lobehub skill manifests: %O', error);
    }
    log('execAgent: got %d lobehub skill manifests', lobehubSkillManifests.length);

    // 7. Fetch Klavis tool manifests from database
    let klavisManifests: LobeToolManifest[] = [];
    try {
      klavisManifests = await this.klavisService.getKlavisManifests();
    } catch (error) {
      log('execAgent: failed to fetch klavis manifests: %O', error);
    }
    log('execAgent: got %d klavis manifests', klavisManifests.length);

    // 8. Fetch user settings (memory config + timezone)
    // Agent-level memory config takes priority; fallback to user-level setting
    const agentMemoryEnabled = agentConfig.chatConfig?.memory?.enabled;
    let globalMemoryEnabled = agentMemoryEnabled ?? false;
    let userTimezone: string | undefined;
    let uninstalledBuiltinTools: string[] = [];
    try {
      const userModel = new UserModel(this.db, this.userId);
      const settings = await userModel.getUserSettings();
      const memorySettings = settings?.memory as { enabled?: boolean } | undefined;

      globalMemoryEnabled = agentMemoryEnabled ?? memorySettings?.enabled !== false;

      const generalSettings = settings?.general as { timezone?: string } | undefined;
      userTimezone = generalSettings?.timezone;

      const toolSettings = settings?.tool as { uninstalledBuiltinTools?: string[] } | undefined;
      uninstalledBuiltinTools = toolSettings?.uninstalledBuiltinTools ?? [];
    } catch (error) {
      log('execAgent: failed to fetch user settings: %O', error);
    }
    log(
      'execAgent: globalMemoryEnabled=%s, timezone=%s',
      globalMemoryEnabled,
      userTimezone ?? 'default',
    );

    // 9. Create tools using Server AgentToolsEngine
    const hasEnabledKnowledgeBases =
      agentConfig.knowledgeBases?.some((kb: { enabled?: boolean | null }) => kb.enabled === true) ??
      false;

    // Build device context for ToolsEngine enableChecker
    const gatewayConfigured = deviceProxy.isConfigured;
    const boundDeviceId = agentConfig.agencyConfig?.boundDeviceId;
    let onlineDevices: DeviceAttachment[] = [];
    if (gatewayConfigured) {
      try {
        onlineDevices = await deviceProxy.queryDeviceList(this.userId);
        log('execAgent: found %d online device(s)', onlineDevices.length);
      } catch (error) {
        log('execAgent: failed to query device list: %O', error);
      }
    }
    const deviceOnline = onlineDevices.length > 0;

    const toolsContext: ServerAgentToolsContext = {
      installedPlugins,
      isModelSupportToolUse,
    };

    // Dynamically inject topic-reference tool when prompt contains <refer_topic> tags
    const hasTopicReference = /refer_topic/.test(prompt ?? '');
    const agentPlugins = [
      ...(agentConfig?.plugins ?? []),
      ...(hasTopicReference ? ['lobe-topic-reference'] : []),
      ...(additionalPluginIds ?? []),
    ];

    // Resolve THE device decision for this run via the shared execution plan
    // (`@/helpers/executionTarget`). All binding/online/auto-activation rules
    // live there: a bound device is used only if it is itself online (an
    // offline binding stays unrouted instead of guessing another machine), and
    // unbound runs auto-activate only when EXACTLY ONE device is online.
    //
    // `isDesktop` here means "can a client/device actually execute this run"
    // (lobehub calls it `clientExecutionAvailable`) — NOT "the caller is a
    // desktop OS". We pass `gatewayConfigured`: a server wired to a device-gateway
    // is serving desktop-class users with a reachable device, so a `local` target
    // routes to that device instead of collapsing to the cloud sandbox. With NO
    // gateway it stays `false`, so `local` still degrades to `sandbox` (nowhere
    // in-process to run). Two compatibility bridges preserve today's flows:
    //   - a legacy `boundDeviceId` without an explicit `executionTarget` is
    //     treated as `executionTarget: 'device'` so existing bindings keep
    //     routing to the device;
    //   - the IM/Bot single-online-device auto-activation is fed in as a
    //     `requestedDeviceId` so those scenarios still activate as before.
    const agencyConfig = agentConfig.agencyConfig;
    const effectiveAgencyConfig =
      agencyConfig?.boundDeviceId && !agencyConfig.executionTarget
        ? { ...agencyConfig, executionTarget: 'device' as const }
        : agencyConfig;
    const legacyBotAutoActivateDeviceId =
      !boundDeviceId && (discordContext || botContext) && onlineDevices.length === 1
        ? onlineDevices[0].deviceId
        : undefined;

    // Cloud sandbox availability (`cloud_sandbox` flag, off via `FEATURE_FLAGS=-cloud_sandbox`).
    // Disabling it degrades sandbox-bound runs to `none` and prevents the Cloud
    // Sandbox tool from ever being mounted.
    const sandboxEnabled = serverFeatureFlags(this.userId).enableCloudSandbox;

    const executionPlan = resolveExecutionPlan({
      agencyConfig: effectiveAgencyConfig,
      isDesktop: gatewayConfigured,
      onlineDeviceIds: onlineDevices.map((device) => device.deviceId),
      requestedDeviceId: legacyBotAutoActivateDeviceId,
      sandboxEnabled,
    });
    const activeDeviceId = executionPlan.kind === 'device' ? executionPlan.deviceId : undefined;
    log(
      'execAgent: execution plan → kind=%s deviceId=%s',
      executionPlan.kind,
      activeDeviceId ?? 'none',
    );

    // Gap 3 — visible offline degradation: when the run wanted a desktop device
    // but none is reachable (`device-unrouted`), tell the agent so it explains
    // the failure (a device-dependent scheduled task otherwise degrades silently
    // — desktop-only skills are already filtered out of <available_skills>).
    const deviceStatusNotice = buildDeviceStatusNotice(executionPlan);
    if (deviceStatusNotice) {
      agentConfig.systemRole = agentConfig.systemRole
        ? `${agentConfig.systemRole}\n\n${deviceStatusNotice}`
        : deviceStatusNotice;
      log('execAgent: injected device-unrouted status notice (kind=%s)', executionPlan.kind);
    }

    let forceEnableCloudSandbox =
      files?.some(
        (file) =>
          !!file.size &&
          shouldProcessFileInSandbox(file.mimeType || 'application/octet-stream', file.size),
      ) ?? false;

    if (!forceEnableCloudSandbox && topicId) {
      const fileService = new FileService(this.db, this.userId);
      const topicSandboxFileIds = await collectSandboxFileIdsFromTopic(
        topicId,
        fileService,
        this.messageModel,
      );
      forceEnableCloudSandbox = topicSandboxFileIds.length > 0;
    }

    const toolsEngine = createServerAgentToolsEngine(toolsContext, {
      additionalManifests: [...lobehubSkillManifests, ...klavisManifests],
      agentConfig: {
        agencyConfig: agentConfig.agencyConfig ?? undefined,
        chatConfig: agentConfig.chatConfig ?? undefined,
        plugins: agentPlugins,
      },
      deviceContext: gatewayConfigured
        ? {
            autoActivated: activeDeviceId ? true : undefined,
            boundDeviceId,
            deviceOnline,
            gatewayConfigured: true,
          }
        : undefined,
      // THE single source of truth for the run's execution target — drives the
      // device/sandbox tool gate (e.g. `sandbox` disables local-system /
      // remote-device). See `resolveExecutionPlan` above.
      executionPlan,
      forceEnableCloudSandbox,
      globalMemoryEnabled,
      hasEnabledKnowledgeBases,
      model,
      provider,
      sandboxEnabled,
      uninstalledBuiltinTools,
    });

    // Generate tools and manifest map
    // Include device tool IDs so ToolsEngine can process them via enableChecker
    // Composer-selected tool ids are merged in so explicit picks for this
    // message are mounted (mirrors the in-process path's `mergedToolIds`).
    const selectedToolIds = (params.initialContext?.selectedTools ?? [])
      .map((t) => t?.identifier)
      .filter((id): id is string => !!id);
    const pluginIds = [
      ...new Set([
        ...(agentConfig.plugins || []),
        ...(additionalPluginIds ?? []),
        ...selectedToolIds,
        LocalSystemManifest.identifier,
        RemoteDeviceManifest.identifier,
      ]),
    ];
    log('execAgent: agent configured plugins: %O', pluginIds);

    // skillActivateMode 'manual': only strip discovery-only defaults (activator, skill-store)
    // while keeping the rest (lobe-agent, task, agent-documents, etc.) available.
    // Aligned with lobehub upstream; the previous `skipDefaultTools: isManualMode` dropped
    // every default and broke lobe-agent's Plan/Todo APIs (model would hallucinate names).
    const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';

    const toolsResult = toolsEngine.generateToolsDetailed({
      excludeDefaultToolIds: isManualMode ? manualModeExcludeToolIds : undefined,
      model,
      provider,
      toolIds: pluginIds,
    });

    const tools = toolsResult.tools;

    log('execAgent: enabled tool ids: %O', toolsResult.enabledToolIds);

    // Get manifest map and convert from Map to Record
    const manifestMap = toolsEngine.getEnabledPluginManifests(pluginIds);
    const toolManifestMap: Record<string, any> = {};
    manifestMap.forEach((manifest, id) => {
      toolManifestMap[id] = manifest;
    });

    // Build toolSourceMap for routing tool execution
    const toolSourceMap: Record<string, 'builtin' | 'plugin' | 'mcp' | 'klavis' | 'lobehubSkill'> =
      {};
    // Mark lobehub skills
    for (const manifest of lobehubSkillManifests) {
      toolSourceMap[manifest.identifier] = 'lobehubSkill';
    }
    // Mark klavis tools
    for (const manifest of klavisManifests) {
      toolSourceMap[manifest.identifier] = 'klavis';
    }

    log(
      'execAgent: generated %d tools from %d configured plugins, %d lobehub skills, %d klavis tools',
      tools?.length ?? 0,
      pluginIds.length,
      lobehubSkillManifests.length,
      klavisManifests.length,
    );

    // Override RemoteDevice manifest's systemRole with dynamic device list prompt
    // The manifest is already included/excluded by ToolsEngine enableChecker
    if (toolManifestMap[RemoteDeviceManifest.identifier]) {
      toolManifestMap[RemoteDeviceManifest.identifier] = {
        ...toolManifestMap[RemoteDeviceManifest.identifier],
        systemRole: generateSystemPrompt(onlineDevices),
      };
    }

    // 9.4. Fetch device system info for placeholder variable replacement
    let deviceSystemInfo: Record<string, string> = {};
    if (activeDeviceId) {
      try {
        const systemInfo = await deviceProxy.queryDeviceSystemInfo(this.userId, activeDeviceId);
        if (systemInfo) {
          const activeDevice = onlineDevices.find((d) => d.deviceId === activeDeviceId);
          deviceSystemInfo = {
            arch: systemInfo.arch,
            desktopPath: systemInfo.desktopPath,
            documentsPath: systemInfo.documentsPath,
            downloadsPath: systemInfo.downloadsPath,
            homePath: systemInfo.homePath,
            hostname: activeDevice?.hostname ?? 'unknown',
            musicPath: systemInfo.musicPath,
            picturesPath: systemInfo.picturesPath,
            platform: activeDevice?.platform ?? 'unknown',
            userDataPath: systemInfo.userDataPath,
            videosPath: systemInfo.videosPath,
            workingDirectory: systemInfo.workingDirectory,
          };
          log('execAgent: fetched device system info for %s', activeDeviceId);
        }
      } catch (error) {
        log('execAgent: failed to fetch device system info: %O', error);
      }
    }

    // 9.5. Build Agent Management context if agent-management tool is enabled
    const isAgentManagementEnabled = toolsResult.enabledToolIds?.includes('lobe-agent-management');
    let agentManagementContext;
    if (isAgentManagementEnabled) {
      // Query user's enabled models from database
      const aiModelModel = new AiModelModel(this.db, this.userId);
      const allUserModels = await aiModelModel.getAllModels();

      // Filter only enabled chat models and group by provider
      const providerMap = new Map<
        string,
        {
          id: string;
          models: Array<{ abilities?: any; description?: string; id: string; name: string }>;
          name: string;
        }
      >();

      for (const userModel of allUserModels) {
        // Only include enabled chat models
        if (!userModel.enabled || userModel.type !== 'chat') continue;

        // Get model info from LOBE_DEFAULT_MODEL_LIST for full metadata
        const modelInfo = LOBE_DEFAULT_MODEL_LIST.find(
          (m) => m.id === userModel.id && m.providerId === userModel.providerId,
        );

        if (!providerMap.has(userModel.providerId)) {
          providerMap.set(userModel.providerId, {
            id: userModel.providerId,
            models: [],
            name: userModel.providerId, // TODO: Map to friendly provider name
          });
        }

        const provider = providerMap.get(userModel.providerId)!;
        provider.models.push({
          abilities: userModel.abilities || modelInfo?.abilities,
          description: modelInfo?.description,
          id: userModel.id,
          name: userModel.displayName || modelInfo?.displayName || userModel.id,
        });
      }

      // Build availablePlugins from all plugin sources
      // Exclude only truly internal tools (agent-management itself, agent-builder, page-agent)
      const INTERNAL_TOOLS = new Set([
        'lobe-agent-management', // Don't show agent-management in its own context
        'lobe-agent-builder', // Used for editing current agent, not for creating new agents
        'lobe-group-agent-builder', // Used for editing current group, not for creating new agents
        'lobe-page-agent', // Page-editor specific tool
      ]);

      const availablePlugins = [
        // All builtin tools (including hidden ones like web-browsing, cloud-sandbox)
        ...builtinTools
          .filter((tool) => !INTERNAL_TOOLS.has(tool.identifier))
          .map((tool) => ({
            description: tool.manifest.meta?.description,
            identifier: tool.identifier,
            name: tool.manifest.meta?.title || tool.identifier,
            type: 'builtin' as const,
          })),
        // Lobehub Skills
        ...lobehubSkillManifests.map((manifest) => ({
          description: manifest.meta?.description,
          identifier: manifest.identifier,
          name: manifest.meta?.title || manifest.identifier,
          type: 'lobehub-skill' as const,
        })),
        // Klavis tools
        ...klavisManifests.map((manifest) => ({
          description: manifest.meta?.description,
          identifier: manifest.identifier,
          name: manifest.meta?.title || manifest.identifier,
          type: 'klavis' as const,
        })),
        // Builtin MCP servers
        ...builtinMcpManifests.map((manifest) => ({
          description: manifest.meta?.description,
          identifier: manifest.identifier,
          name: manifest.meta?.title || manifest.identifier,
          type: 'builtin' as const,
        })),
      ];

      agentManagementContext = {
        availablePlugins,
        // Limit to first 5 providers to avoid context bloat
        availableProviders: Array.from(providerMap.values()).slice(0, 5),
      };

      log(
        'execAgent: built agentManagementContext with %d providers and %d plugins',
        agentManagementContext.availableProviders.length,
        agentManagementContext.availablePlugins.length,
      );
    }

    // 10. Fetch user persona for memory injection (reuses globalMemoryEnabled from step 8)
    let userMemory: ServerUserMemoryConfig | undefined;

    if (globalMemoryEnabled) {
      try {
        const personaModel = new UserPersonaModel(this.db, this.userId);
        const persona = await personaModel.getLatestPersonaDocument();

        if (persona?.persona) {
          userMemory = {
            fetchedAt: Date.now(),
            memories: {
              contexts: [],
              experiences: [],
              persona: {
                narrative: persona.persona,
                tagline: persona.tagline,
              },
              preferences: [],
            },
          };
          log('execAgent: fetched user persona (version: %d)', persona.version);
        }
      } catch (error) {
        log('execAgent: failed to fetch user persona: %O', error);
      }
    }

    // 11. Get existing messages if provided
    let historyMessages: any[] = [];
    if (existingMessageIds.length > 0) {
      historyMessages = await this.messageModel.query({
        sessionId: appContext?.sessionId,
        topicId: appContext?.topicId ?? undefined,
      });
      const idSet = new Set(existingMessageIds);
      historyMessages = historyMessages.filter((msg) => idSet.has(msg.id));
    } else if (appContext?.topicId) {
      // Follow-up message in existing topic: load all history for context
      historyMessages = await this.messageModel.query({
        sessionId: appContext?.sessionId,
        topicId: appContext.topicId,
      });
    }

    // 12. Ingest attachments (buffer from bot platforms or external URL) and collect file IDs
    throwIfExecutionAborted('file upload');
    let fileIds: string[] | undefined = params.attachmentFileIds?.length
      ? [...params.attachmentFileIds]
      : undefined;
    let imageList: Array<{ alt: string; id: string; url: string }> | undefined;

    if (files && files.length > 0) {
      const fileService = new FileService(this.db, this.userId);
      if (!fileIds) fileIds = [];
      imageList = [];

      for (const file of files) {
        try {
          const result = await ingestAttachment(file, fileService, this.userId);
          fileIds.push(result.fileId);

          // Build imageList for vision-capable models
          if (result.isImage && result.resolvedUrl) {
            imageList.push({
              alt: file.name || 'image',
              id: result.fileId,
              url: result.resolvedUrl,
            });
          }
        } catch (error) {
          log('execAgent: failed to ingest file %s: %O', file.name ?? file.url, error);
        }
      }

      if (fileIds.length > 0) {
        log('execAgent: ingested %d files to S3', fileIds.length);
      }
      if (imageList.length === 0) imageList = undefined;
    }

    // 13. Create user message in database — unless regenerating, where the user
    // message already exists and the new assistant is just a fresh branch under
    // it (so we must NOT create a duplicate user message).
    const userMessageRecord = params.reuseUserMessageId
      ? { id: params.reuseUserMessageId }
      : await this.messageModel.create({
          agentId: resolvedAgentId,
          content: prompt,
          files: fileIds,
          role: 'user',
          threadId: appContext?.threadId ?? undefined,
          topicId,
        });
    log(
      'execAgent: %s user message %s',
      params.reuseUserMessageId ? 'reusing' : 'created',
      userMessageRecord.id,
    );

    await renewTopicSandboxSession({ topicId });

    {
      const fileService = new FileService(this.db, this.userId);
      await preInjectSandboxFiles({
        fileIds,
        fileService,
        messageModel: this.messageModel,
        topicId,
      });
    }

    // 14. Create assistant message placeholder in database
    // Include threadId if provided (for SubAgent task execution in isolated Thread)
    const assistantMessageRecord = await this.messageModel.create({
      agentId: resolvedAgentId,
      content: LOADING_FLAT,
      model,
      parentId: userMessageRecord.id,
      provider,
      role: 'assistant',
      threadId: appContext?.threadId ?? undefined,
      topicId,
    });
    log('execAgent: created assistant message %s', assistantMessageRecord.id);

    // Create user message object for processing (include imageList for vision models)
    const userMessage = { content: prompt, imageList, role: 'user' as const };

    // Combine history messages with user message
    const allMessages = [...historyMessages, userMessage];

    log('execAgent: prepared evalContext for executor');

    // 15. Generate operation ID: agt_{timestamp}_{agentId}_{topicId}_{random}
    const timestamp = Date.now();
    const operationId = `op_${timestamp}_${resolvedAgentId}_${topicId}_${nanoid(8)}`;

    // 16. Create initial context
    const initialContext: AgentRuntimeContext = {
      // Carry the composer-selected skills / @mentions in the runtime context's
      // designated slot (same slot the in-process path uses). Tool *availability*
      // is already handled by merging `selectedTools` into `pluginIds` above;
      // skill activation is `auto` server-side (the model picks from
      // <available_skills>), so this is forward-compatible context rather than a
      // second activation path.
      ...(params.initialContext
        ? { initialContext: params.initialContext as AgentRuntimeContext['initialContext'] }
        : {}),
      payload: {
        // Pass assistant message ID so agent runtime knows which message to update
        assistantMessageId: assistantMessageRecord.id,
        isFirstMessage: true,
        message: [{ content: prompt }],
        // Pass user message ID as parentMessageId for reference
        parentMessageId: userMessageRecord.id,
        // Include tools for initial LLM call
        tools,
      },
      phase: 'user_input' as const,
      session: {
        messageCount: allMessages.length,
        sessionId: operationId,
        status: 'idle' as const,
        stepCount: 0,
      },
    };

    // 17. Log final operation parameters summary
    throwIfExecutionAborted('operation preparation');
    log(
      'execAgent: creating operation %s with params: model=%s, provider=%s, tools=%d, messages=%d, manifests=%d',
      operationId,
      model,
      provider,
      tools?.length ?? 0,
      allMessages.length,
      Object.keys(toolManifestMap).length,
    );

    // 18. Build skill metas for <available_skills> prompt injection
    // Combine builtin skills + user DB skills so AI can discover all installed skills
    let skillMetas: Array<{ description: string; identifier: string; name: string }> = [];
    try {
      // Filter the same way the skills execution runtime does, so the model is
      // never told it has a desktop-only skill it can't actually activate.
      // Desktop-only skills stay advertised only when an online device can run
      // their bundled CLI (`activeDeviceId`).
      const builtinMetas = filterBuiltinSkills(builtinSkills, {
        activeDevice: !!activeDeviceId,
        isDesktop: false,
      })
        .filter((s) => !uninstalledBuiltinTools.includes(s.identifier))
        .map((s) => ({
          description: s.description,
          identifier: s.identifier,
          name: s.name,
        }));
      const skillModel = new AgentSkillModel(this.db, this.userId);
      const { data: dbSkills } = await skillModel.findAll();
      const unavailableDbSkills = dbSkills.filter(
        (skill) => !isDbSkillAvailableForRuntime(skill, activeDeviceId),
      );
      const unavailableSkillsNotice = buildUnavailableSkillsNotice(unavailableDbSkills);
      if (unavailableSkillsNotice) {
        agentConfig.systemRole = [agentConfig.systemRole, unavailableSkillsNotice]
          .filter(Boolean)
          .join('\n\n');
      }

      const dbMetas = dbSkills
        .filter((skill) => isDbSkillAvailableForRuntime(skill, activeDeviceId))
        .map((s) => ({
          description: s.description ?? '',
          identifier: s.identifier,
          name: s.name,
        }));
      // In manual skill-activate mode, only pinned skills (ids in pluginIds)
      // are advertised in <available_skills>; auto (non-pinned) skills are
      // hidden from the LLM. Pinned + fixed skills stay visible either way.
      const pinnedSkillSet = new Set(pluginIds);
      const mergedMetas = [...builtinMetas, ...dbMetas].filter(
        (meta) => !isManualMode || pinnedSkillSet.has(meta.identifier),
      );
      skillMetas = messagesHaveSandboxFiles(allMessages)
        ? mergedMetas
        : mergedMetas.filter((meta) => !SANDBOX_BUILTIN_SKILL_IDENTIFIERS.has(meta.identifier));
    } catch (error) {
      log('execAgent: failed to fetch skill metas: %O', error);
    }

    // 19. Create operation using AgentRuntimeService
    // Wrap in try-catch to handle operation startup failures (e.g., QStash unavailable)
    // If createOperation fails, we still have valid messages that need error info
    try {
      const result = await this.agentRuntimeService.createOperation({
        activeDeviceId,
        agentConfig,
        deviceSystemInfo: Object.keys(deviceSystemInfo).length > 0 ? deviceSystemInfo : undefined,
        userTimezone,
        appContext: {
          agentId: resolvedAgentId,
          groupId: appContext?.groupId,
          isSubAgent: appContext?.isSubAgent,
          parentOperationId: appContext?.parentOperationId,
          threadId: appContext?.threadId,
          topicId,
          trigger,
        },
        autoStart,
        completionWebhook,
        discordContext,
        evalContext,
        initialContext,
        initialMessages: allMessages,
        maxSteps,
        modelRuntimeConfig: { model, provider },
        hooks,
        operationId,
        stepCallbacks,
        stepWebhook,
        stream,
        toolSet: {
          enabledToolIds: toolsResult.enabledToolIds,
          manifestMap: toolManifestMap,
          sourceMap: toolSourceMap,
          tools,
        },
        skillMetas,
        userId: this.userId,
        userInterventionConfig,
        userMemory,
        webhookDelivery,
      });

      log('execAgent: created operation %s (autoStarted: %s)', operationId, result.autoStarted);

      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: result.autoStarted,
        createdAt: new Date().toISOString(),
        message: 'Agent operation created successfully',
        messageId: result.messageId,
        operationId,
        status: 'created',
        success: true,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord.id,
      };
    } catch (error) {
      // Operation startup failed (e.g., QStash queue service unavailable)
      // Update assistant message with error so user can see what went wrong
      const errorMessage = error instanceof Error ? error.message : 'Unknown error starting agent';
      log(
        'execAgent: createOperation failed, updating assistant message with error: %s',
        errorMessage,
      );

      await this.messageModel.update(assistantMessageRecord.id, {
        content: '',
        error: {
          body: {
            detail: errorMessage,
          },
          message: errorMessage,
          type: 'ServerAgentRuntimeError', // ServiceUnavailable - agent runtime service unavailable
        },
      });

      // Return result with error status - messages are valid but agent didn't start
      return {
        agentId: resolvedAgentId,
        assistantMessageId: assistantMessageRecord.id,
        autoStarted: false,
        createdAt: new Date().toISOString(),
        error: errorMessage,
        message: 'Agent operation failed to start',
        operationId,
        status: 'error',
        success: false,
        timestamp: new Date().toISOString(),
        topicId,
        userMessageId: userMessageRecord.id,
      };
    }
  }

  /**
   * Execute Group Agent (Supervisor) in a single call
   *
   * This method handles Group-specific logic (topic with groupId) and delegates
   * the core agent execution to execAgent.
   *
   * Flow:
   * 1. Create topic with groupId (if needed)
   * 2. Delegate to execAgent for the rest
   */
  async execGroupAgent(params: ExecGroupAgentParams): Promise<ExecGroupAgentResult> {
    const { agentId, groupId, message, topicId: inputTopicId, newTopic } = params;

    log(
      'execGroupAgent: agentId=%s, groupId=%s, message=%s',
      agentId,
      groupId,
      message.slice(0, 50),
    );

    // 1. Create topic with groupId if needed
    let topicId = inputTopicId;
    let isCreateNewTopic = false;

    // Create new topic when:
    // - newTopic is explicitly provided, OR
    // - no topicId is provided (default behavior for group chat)
    if (newTopic || !inputTopicId) {
      const topicTitle =
        newTopic?.title || message.slice(0, 50) + (message.length > 50 ? '...' : '');
      const topicItem = await this.topicModel.create({
        agentId,
        groupId,
        messages: newTopic?.topicMessageIds,
        title: topicTitle,
        // Note: execGroupAgent doesn't have trigger param yet, defaults to null
      });
      topicId = topicItem.id;
      isCreateNewTopic = true;
      log('execGroupAgent: created new topic %s with groupId %s', topicId, groupId);
    }

    // 2. Delegate to execAgent with groupId in appContext
    const result = await this.execAgent({
      agentId,
      appContext: { groupId, topicId },
      attachmentFileIds: params.files,
      autoStart: true,
      prompt: message,
    });

    log(
      'execGroupAgent: delegated to execAgent, operationId=%s, success=%s',
      result.operationId,
      result.success,
    );

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      isCreateNewTopic,
      operationId: result.operationId,
      success: result.success,
      topicId: result.topicId,
      userMessageId: result.userMessageId,
    };
  }

  /**
   * Execute SubAgent task (supports both Group and Single Agent mode)
   *
   * This method is called by Supervisor (Group mode) or Agent (Single mode)
   * to delegate tasks to SubAgents. Each task runs in an isolated Thread context.
   *
   * - Group mode: pass groupId, Thread will be associated with the Group
   * - Single Agent mode: omit groupId, Thread will only be associated with the Agent
   *
   * Flow:
   * 1. Create Thread (type='isolation', status='processing')
   * 2. Delegate to execAgent with threadId in appContext
   * 3. Store operationId in Thread metadata
   */
  async execSubAgentTask(params: ExecSubAgentTaskParams): Promise<ExecSubAgentTaskResult> {
    return this.execAgentThreadRun(params, { isSubAgent: false, logScope: 'execSubAgentTask' });
  }

  /**
   * Fork a sub-agent for `callSubAgent`'s server-side deferred/bridge path.
   * Unlike `execSubAgentTask` (client-polling driven), the caller doesn't
   * poll — instead a completion bridge hook is installed that resumes the
   * parent operation directly once this child reaches a terminal status.
   *
   * `parentMessageId` must be the parent's already-created placeholder
   * `role: 'tool'` message id (see `GTDServerExecutionRuntime.callSubAgent`)
   * — both the Thread's `sourceMessageId` and the bridge's `toolMessageId`
   * point at it.
   */
  async execVirtualSubAgent(
    params: ExecSubAgentTaskParams & { parentOperationId: string },
  ): Promise<ExecSubAgentTaskResult> {
    const { parentOperationId, ...threadRunParams } = params;
    return this.execAgentThreadRun(threadRunParams, {
      isSubAgent: true,
      logScope: 'execVirtualSubAgent',
      parentOperationId,
      resumeParentOnComplete: true,
    });
  }

  /**
   * Shared Thread-orchestration primitive: create an isolated Thread, run
   * the target agent headlessly inside it, and track progress/completion via
   * hooks. `execSubAgentTask` (client-polling, `execTask`/`execTasks`/
   * `callAgent(runAsTask)`) and `execVirtualSubAgent` (`callSubAgent`'s
   * server bridge) are both thin wrappers — only the recursion guard
   * (`isSubAgent`) and whether a completion bridge hook is installed differ.
   */
  private async execAgentThreadRun(
    params: ExecSubAgentTaskParams,
    options: {
      isSubAgent: boolean;
      logScope: string;
      parentOperationId?: string;
      resumeParentOnComplete?: boolean;
    },
  ): Promise<ExecSubAgentTaskResult> {
    const { groupId, topicId, parentMessageId, agentId, instruction, title } = params;
    const { logScope } = options;

    log(
      '%s: agentId=%s, groupId=%s, topicId=%s, instruction=%s',
      logScope,
      agentId,
      groupId,
      topicId,
      instruction.slice(0, 50),
    );

    // 1. Create Thread for isolated task execution
    const thread = await this.threadModel.create({
      agentId,
      groupId,
      sourceMessageId: parentMessageId,
      title,
      topicId,
      type: ThreadType.Isolation,
    });

    if (!thread) {
      throw new Error('Failed to create thread for task execution');
    }

    log('%s: created thread %s', logScope, thread.id);

    // 2. Update Thread status to processing with startedAt timestamp
    const startedAt = new Date().toISOString();
    await this.threadModel.update(thread.id, {
      metadata: { startedAt },
      status: ThreadStatus.Processing,
    });

    // 3. Create hooks for updating Thread metadata and task message. When
    // resumeParentOnComplete is set, the onComplete hook also drives the
    // sub-agent bridge instead of (redundantly) writing plain content.
    const threadHooks = this.createThreadHooks(
      thread.id,
      startedAt,
      parentMessageId,
      options.resumeParentOnComplete && options.parentOperationId
        ? { parentOperationId: options.parentOperationId, toolMessageId: parentMessageId }
        : undefined,
    );

    // 4. Delegate to execAgent with threadId in appContext and hooks
    // The instruction will be created as user message in the Thread
    // Use headless mode to skip human approval in async task execution
    const result = await this.execAgent({
      agentId,
      appContext: {
        groupId,
        threadId: thread.id,
        topicId,
        ...(options.isSubAgent && { isSubAgent: true }),
        ...(options.parentOperationId && { parentOperationId: options.parentOperationId }),
      },
      autoStart: true,
      hooks: threadHooks,
      prompt: instruction,
      userInterventionConfig: { approvalMode: 'headless' },
    });

    log(
      '%s: delegated to execAgent, operationId=%s, success=%s',
      logScope,
      result.operationId,
      result.success,
    );

    // 5. Store operationId in Thread metadata
    await this.threadModel.update(thread.id, {
      metadata: { operationId: result.operationId, startedAt },
    });

    // 6. If operation failed to start, update thread status
    if (!result.success) {
      const completedAt = new Date().toISOString();
      await this.threadModel.update(thread.id, {
        metadata: {
          completedAt,
          duration: Date.now() - new Date(startedAt).getTime(),
          error: result.error,
          operationId: result.operationId,
          startedAt,
        },
        status: ThreadStatus.Failed,
      });
    }

    return {
      assistantMessageId: result.assistantMessageId,
      error: result.error,
      operationId: result.operationId,
      success: result.success ?? false,
      threadId: thread.id,
    };
  }

  /**
   * Create step lifecycle callbacks for updating Thread metadata
   * These callbacks accumulate metrics during execution and update Thread on completion
   *
   * @param threadId - The Thread ID to update
   * @param startedAt - The start time ISO string
   * @param sourceMessageId - The task message ID (sourceMessageId from Thread) to update with summary
   */
  private createThreadMetadataCallbacks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
  ): StepLifecycleCallbacks {
    // Accumulator for tracking metrics across steps
    let accumulatedToolCalls = 0;

    return {
      onAfterStep: async ({ state, stepResult }) => {
        // Count tool calls from this step
        const toolCallsInStep = stepResult?.events?.filter(
          (e: { type: string }) => e.type === 'tool_call',
        )?.length;
        if (toolCallsInStep) {
          accumulatedToolCalls += toolCallsInStep;
        }

        // Update Thread metadata with current progress
        try {
          await this.threadModel.update(threadId, {
            metadata: {
              operationId: state.operationId,
              startedAt,
              totalMessages: state.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(state.usage),
              totalToolCalls: accumulatedToolCalls,
            },
          });
          log(
            'execSubAgentTask: updated thread %s metadata after step %d',
            threadId,
            state.stepCount,
          );
        } catch (error) {
          log('execSubAgentTask: failed to update thread metadata: %O', error);
        }
      },

      onComplete: async ({ finalState, reason }) => {
        const completedAt = new Date().toISOString();
        const duration = Date.now() - new Date(startedAt).getTime();

        // Determine thread status based on completion reason
        let status: ThreadStatus;
        switch (reason) {
          case 'done': {
            status = ThreadStatus.Completed;
            break;
          }
          case 'error': {
            status = ThreadStatus.Failed;
            break;
          }
          case 'interrupted': {
            status = ThreadStatus.Cancel;
            break;
          }
          case 'waiting_for_human': {
            status = ThreadStatus.InReview;
            break;
          }
          default: {
            status = ThreadStatus.Completed;
          }
        }

        // Log error when task fails
        if (reason === 'error' && finalState.error) {
          console.error('execSubAgentTask: task failed for thread %s:', threadId, finalState.error);
        }

        try {
          // Extract summary from last assistant message and update task message content
          const lastAssistantMessage = finalState.messages
            ?.slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'assistant');

          if (lastAssistantMessage?.content) {
            await this.messageModel.update(sourceMessageId, {
              content: lastAssistantMessage.content,
            });
            log('execSubAgentTask: updated task message %s with summary', sourceMessageId);
          }

          // Format error for proper serialization (Error objects don't serialize with JSON.stringify)
          const formattedError = formatErrorForMetadata(finalState.error);

          // Update Thread metadata
          await this.threadModel.update(threadId, {
            metadata: {
              completedAt,
              duration,
              error: formattedError,
              operationId: finalState.operationId,
              startedAt,
              totalCost: finalState.cost?.total,
              totalMessages: finalState.messages?.length ?? 0,
              totalTokens: this.calculateTotalTokens(finalState.usage),
              totalToolCalls: accumulatedToolCalls,
            },
            status,
          });

          log(
            'execSubAgentTask: thread %s completed with status %s, reason: %s',
            threadId,
            status,
            reason,
          );
        } catch (error) {
          console.error('execSubAgentTask: failed to update thread on completion: %O', error);
        }
      },
    };
  }

  /**
   * Create hooks for tracking Thread metadata updates during SubAgent execution.
   * Replaces the legacy createThreadMetadataCallbacks with the hooks system.
   */
  private createThreadHooks(
    threadId: string,
    startedAt: string,
    sourceMessageId: string,
    /**
     * When set (callSubAgent's server bridge path), the onComplete hook
     * drives `completeSubAgentBridge` instead of writing plain content to
     * `sourceMessageId` — the bridge backfills content + pluginState +
     * pluginError together and resumes the parent operation.
     */
    bridgeOptions?: { parentOperationId: string; toolMessageId: string },
  ): AgentHook[] {
    let accumulatedToolCalls = 0;

    return [
      {
        handler: async (event) => {
          const state = event.finalState;
          if (!state) return;

          // Count tool calls from step result
          const stepToolCalls = state.session?.toolCalls || 0;
          if (stepToolCalls > accumulatedToolCalls) {
            accumulatedToolCalls = stepToolCalls;
          }

          try {
            await this.threadModel.update(threadId, {
              metadata: {
                operationId: event.operationId,
                startedAt,
                totalMessages: state.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(state.usage),
                totalToolCalls: accumulatedToolCalls,
              },
            });
          } catch (error) {
            log('Thread hook afterStep: failed to update metadata: %O', error);
          }
        },
        id: 'thread-metadata-update',
        type: 'afterStep' as const,
      },
      {
        handler: async (event) => {
          const finalState = event.finalState;
          if (!finalState) return;

          const completedAt = new Date().toISOString();
          const duration = Date.now() - new Date(startedAt).getTime();

          // Map completion reason to ThreadStatus
          let status: ThreadStatus;
          switch (event.reason) {
            case 'done': {
              status = ThreadStatus.Completed;
              break;
            }
            case 'error': {
              status = ThreadStatus.Failed;
              break;
            }
            case 'interrupted': {
              status = ThreadStatus.Cancel;
              break;
            }
            case 'waiting_for_human': {
              status = ThreadStatus.InReview;
              break;
            }
            default: {
              status = ThreadStatus.Completed;
            }
          }

          if (event.reason === 'error' && finalState.error) {
            console.error(
              'Thread hook onComplete: task failed for thread %s:',
              threadId,
              finalState.error,
            );
          }

          try {
            if (bridgeOptions) {
              // callSubAgent's server bridge: backfill the parent's
              // placeholder tool message and attempt to resume the parent.
              await this.agentRuntimeService.completeSubAgentBridge({
                finalState,
                operationId: event.operationId,
                parentOperationId: bridgeOptions.parentOperationId,
                reason: event.reason ?? 'done',
                threadId,
                toolMessageId: bridgeOptions.toolMessageId,
              });
            } else {
              // Update task message with summary
              const lastAssistantMessage = finalState.messages
                ?.slice()
                .reverse()
                .find((m: { role: string }) => m.role === 'assistant');

              if (lastAssistantMessage?.content) {
                await this.messageModel.update(sourceMessageId, {
                  content: lastAssistantMessage.content,
                });
              }
            }

            const formattedError = formatErrorForMetadata(finalState.error);

            await this.threadModel.update(threadId, {
              metadata: {
                completedAt,
                duration,
                error: formattedError,
                operationId: finalState.operationId,
                startedAt,
                totalCost: finalState.cost?.total,
                totalMessages: finalState.messages?.length ?? 0,
                totalTokens: this.calculateTotalTokens(finalState.usage),
                totalToolCalls: accumulatedToolCalls,
              },
              status,
            });

            log(
              'Thread hook onComplete: thread %s status=%s reason=%s',
              threadId,
              status,
              event.reason,
            );
          } catch (error) {
            console.error('Thread hook onComplete: failed to update: %O', error);
          }
        },
        id: 'thread-completion',
        type: 'onComplete' as const,
      },
    ];
  }

  /**
   * Calculate total tokens from AgentState usage object
   * AgentState.usage is of type Usage from @lobechat/agent-runtime
   */
  private calculateTotalTokens(usage?: AgentState['usage']): number | undefined {
    if (!usage) return undefined;
    return usage.llm?.tokens?.total;
  }

  /**
   * Interrupt a running task
   *
   * This method interrupts a SubAgent task by threadId or operationId.
   * It updates both operation status and Thread status to cancelled state.
   */
  async interruptTask(params: {
    operationId?: string;
    threadId?: string;
  }): Promise<{ operationId?: string; success: boolean; threadId?: string }> {
    const { threadId, operationId } = params;

    log('interruptTask: threadId=%s, operationId=%s', threadId, operationId);

    // 1. Get operationId and thread
    let resolvedOperationId = operationId;
    let thread;

    if (threadId) {
      thread = await this.threadModel.findById(threadId);
      if (!thread) {
        throw new Error('Thread not found');
      }
      resolvedOperationId = resolvedOperationId || thread.metadata?.operationId;
    }

    if (!resolvedOperationId) {
      throw new Error('Operation ID not found');
    }

    // 2. 中断 operation
    //
    // 🐛 这里原来传的是**对象**：`service.interruptOperation({ operationId })`，
    // 而 `AgentRuntimeService.interruptOperation(operationId: string)` 收的是**字符串**。
    // 结果 `loadAgentState({...})` 用 `[object Object]` 当 key，永远查不到状态、
    // 直接 `return false` —— 中断从来没有真正执行过。
    // 再叠加下面「无条件返回 success: true」，接口就成了**谎报成功**：
    // 用户点了中断、拿到成功响应，agent 却继续烧钱（附录 B-2 实测 372 → 564 步）。
    let interruptedOk = false;
    try {
      interruptedOk = await this.agentRuntimeService.interruptOperation(resolvedOperationId);
    } catch (error: any) {
      log('interruptTask: Failed to interrupt operation: %O', error);
      // Thread 状态仍然照常更新，但不能因此谎报中断成功
    }

    // 3. Update Thread status to cancel
    if (thread) {
      await this.threadModel.update(thread.id, {
        metadata: {
          ...thread.metadata,
          completedAt: new Date().toISOString(),
        },
        status: ThreadStatus.Cancel,
      });
    }

    return {
      operationId: resolvedOperationId,
      // 如实反映中断结果。原来恒为 true，调用方无法区分「已中断」与
      // 「operation 不存在 / 已是终态 / 中断失败」。
      success: interruptedOk,
      threadId: thread?.id,
    };
  }
}
