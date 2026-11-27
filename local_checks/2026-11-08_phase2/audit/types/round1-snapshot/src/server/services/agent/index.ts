import { type BuiltinAgentSlug } from '@lobechat/builtin-agents';
import { BUILTIN_AGENTS } from '@lobechat/builtin-agents';
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import debug from 'debug';
import type { AiModelDevParams } from 'model-bank';
import { type PartialDeep } from 'type-fest';

import { AgentModel } from '@/database/models/agent';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { getRedisConfig } from '@/envs/redis';
import {
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';
import { getServerDefaultAgentConfig, getServerGlobalConfig } from '@/server/globalConfig';
import { mergeLobehubZtripIntoAiProviderConfig } from '@/server/services/ctripLobehubConfig';
import { type ProviderConfig } from '@/types/user/settings';

import { type UpdateAgentResult } from './type';

const log = debug('lobe-agent:service');

/**
 * Agent config with required id field.
 * Used when returning agent config from database (id is always present).
 */
export type AgentConfigWithId = LobeAgentConfig & { id: string; slug?: string | null };

interface AgentWelcomeData {
  openQuestions: string[];
  welcomeMessage: string;
}

/**
 * Agent Service
 *
 * Encapsulates "mutation + query" logic for agent operations.
 * After performing update operations, returns the updated agent data.
 */
export class AgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentModel: AgentModel;
  private readonly userModel: UserModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.agentModel = new AgentModel(db, userId);
    this.userModel = new UserModel(db, userId);
  }

  async createInbox() {
    const sessionModel = new SessionModel(this.db, this.userId);
    const defaultAgentConfig = getServerDefaultAgentConfig();
    await sessionModel.createInbox(defaultAgentConfig);
  }

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. The actual agent config from database
   * 4. Avatar from builtin-agents package definition (if available)
   *
   * This ensures the frontend always receives a complete config with model/provider.
   */
  async getBuiltinAgent(slug: string) {
    // Fetch agent and defaultAgentConfig in parallel
    const [agent, defaultAgentConfig] = await Promise.all([
      this.agentModel.getBuiltinAgent(slug),
      this.userModel.getUserSettingsDefaultAgentConfig(),
    ]);

    const mergedConfig = await this.mergeDefaultConfigWithModelDevDefaults(
      agent,
      defaultAgentConfig,
    );
    if (!mergedConfig) return null;

    // Merge avatar from builtin-agents package definition
    const builtinAgent = BUILTIN_AGENTS[slug as BuiltinAgentSlug];
    if (builtinAgent?.avatar) {
      return { ...mergedConfig, avatar: builtinAgent.avatar };
    }

    return mergedConfig;
  }

  /**
   * Get agent config by ID or slug with default config merged.
   * Supports both agentId and slug lookup.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   */
  async getAgentConfig(idOrSlug: string): Promise<AgentConfigWithId | null> {
    const [agent, defaultAgentConfig] = await Promise.all([
      this.agentModel.getAgentConfig(idOrSlug),
      this.userModel.getUserSettingsDefaultAgentConfig(),
    ]);

    return (await this.mergeDefaultConfigWithModelDevDefaults(
      agent,
      defaultAgentConfig,
    )) as AgentConfigWithId | null;
  }

  /**
   * Get agent config by ID with default config merged.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   * 5. AI-generated welcome data from Redis (if available)
   */
  async getAgentConfigById(agentId: string) {
    const [agent, defaultAgentConfig, welcomeData] = await Promise.all([
      this.agentModel.getAgentConfigById(agentId),
      this.userModel.getUserSettingsDefaultAgentConfig(),
      this.getAgentWelcomeFromRedis(agentId),
    ]);

    const config = await this.mergeDefaultConfigWithModelDevDefaults(agent, defaultAgentConfig);
    if (!config) return null;

    // Merge AI-generated welcome data if available
    if (welcomeData) {
      return {
        ...config,
        openingMessage: welcomeData.welcomeMessage,
        openingQuestions: welcomeData.openQuestions,
      };
    }

    return config;
  }

  /**
   * Get AI-generated welcome data from Redis
   * Returns null if Redis is disabled or data doesn't exist
   */
  private async getAgentWelcomeFromRedis(agentId: string): Promise<AgentWelcomeData | null> {
    try {
      const redisConfig = getRedisConfig();
      if (!isRedisEnabled(redisConfig)) return null;

      const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.AI_GENERATION);
      if (!redis) return null;

      const key = RedisKeys.aiGeneration.agentWelcome(agentId);
      const value = await redis.get(key);
      if (!value) return null;

      return JSON.parse(value) as AgentWelcomeData;
    } catch (error) {
      // Log error for observability but don't break agent retrieval
      log('Failed to get agent welcome from Redis for agent %s: %O', agentId, error);
      return null;
    }
  }

  /**
   * Merge default config with agent config.
   * Returns null if agent is null/undefined.
   *
   * Merge order (later values override earlier):
   * 1. DEFAULT_AGENT_CONFIG - hardcoded defaults
   * 2. serverDefaultAgentConfig - from environment variable
   * 3. userDefaultAgentConfig - from user settings (defaultAgent.config)
   * 4. agent - actual agent config from database
   */
  private mergeDefaultConfig(
    agent: any,
    defaultAgentConfig: Awaited<ReturnType<UserModel['getUserSettingsDefaultAgentConfig']>>,
  ): LobeAgentConfig | null {
    if (!agent) return null;

    const userDefaultAgentConfig =
      (defaultAgentConfig as { config?: PartialDeep<LobeAgentConfig> })?.config || {};

    // Merge configs in order: DEFAULT -> server -> user -> agent
    const serverDefaultAgentConfig = getServerDefaultAgentConfig();
    const baseConfig = merge(DEFAULT_AGENT_CONFIG, serverDefaultAgentConfig);
    const withUserConfig = merge(baseConfig, userDefaultAgentConfig);

    return merge(withUserConfig, cleanObject(agent));
  }

  /**
   * After DEFAULT_AGENT_CONFIG / server / user / DB merge, apply every `devParams.*.default`
   * present on the merged model card when the DB row did not set that params key (qconfig / model-bank
   * wins over const defaults for missing keys only).
   */
  private async mergeDefaultConfigWithModelDevDefaults(
    agent: any,
    defaultAgentConfig: Awaited<ReturnType<UserModel['getUserSettingsDefaultAgentConfig']>>,
  ): Promise<LobeAgentConfig | null> {
    const merged = this.mergeDefaultConfig(agent, defaultAgentConfig);
    if (!merged) return null;

    return this.enrichMergedConfigWithModelDevDefaults(merged, agent as AgentItem | undefined);
  }

  private async enrichMergedConfigWithModelDevDefaults(
    merged: LobeAgentConfig,
    rawAgent: AgentItem | undefined,
  ): Promise<LobeAgentConfig> {
    if (!merged.model || !merged.provider) return merged;

    try {
      const { aiProvider } = await getServerGlobalConfig();
      const mergedAiProvider = await mergeLobehubZtripIntoAiProviderConfig(
        this.db,
        this.userId,
        aiProvider as Record<string, ProviderConfig>,
      );
      const repos = new AiInfraRepos(this.db, this.userId, mergedAiProvider);
      const devParams = await repos.getMergedModelDevParams(merged.model, merged.provider);
      if (!devParams) return merged;

      const rawParams = rawAgent?.params as Record<string, unknown> | undefined | null;
      const nextParams = merged.params ? { ...merged.params } : {};

      for (const key of Object.keys(devParams) as (keyof AiModelDevParams)[]) {
        const item = devParams[key];
        if (!item || typeof item.default !== 'number') continue;
        if (item.enabled === false) continue;
        if (rawParams && Object.prototype.hasOwnProperty.call(rawParams, key)) continue;
        nextParams[key] = item.default;
      }

      return { ...merged, params: nextParams };
    } catch (error) {
      log('enrichMergedConfigWithModelDevDefaults failed: %O', error);
      return merged;
    }
  }

  /**
   * Update agent config and return the updated data
   * Pattern: update + query
   *
   * This method combines config update and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async updateAgentConfig(
    agentId: string,
    value: PartialDeep<AgentItem>,
  ): Promise<UpdateAgentResult> {
    // 1. Execute update
    await this.agentModel.updateConfig(agentId, value);

    // 2. Query and return updated data (with default config merged)
    const agent = await this.getAgentConfigById(agentId);

    return { agent: agent as any, success: true };
  }
}
