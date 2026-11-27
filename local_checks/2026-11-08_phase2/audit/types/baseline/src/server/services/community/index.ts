import type { LobeChatDatabase } from '@lobechat/database';
import type { InstalledPluginItem, NewInstalledPlugin } from '@lobechat/database/schemas';
import {
  agents,
  agentSkills,
  knowledgeBases,
  marketAgents,
  marketKnowledgeBases,
  marketMcps,
  marketSkills,
  userInstalledPlugins,
} from '@lobechat/database/schemas';
import type { CustomPluginParams, SkillManifest, SkillResourceMeta } from '@lobechat/types';
import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { TRPCError } from '@trpc/server';
import { and, eq, isNotNull, isNull, ne, not, sql } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { KnowledgeBaseModel } from '@/database/models/knowledgeBase';
import { MarketAgentModel } from '@/database/models/marketAgent';
import { MarketKnowledgeBaseModel } from '@/database/models/marketKnowledgeBase';
import { MarketMcpModel } from '@/database/models/marketMcp';
import { MarketSkillModel } from '@/database/models/marketSkill';
import { MarketUsageRecordModel } from '@/database/models/marketUsageRecord';
import { createNanoId } from '@/database/utils/idGenerator';
import { KnowledgeBaseMarketService } from '@/server/services/community/knowledgeBaseMarket';
import { MarketAvatarService } from '@/server/services/community/marketAvatar';
import {
  getExplicitMcpIcon,
  getExplicitSkillIcon,
  resolveMcpMarketIcon,
  resolveSkillMarketIcon,
} from '@/server/services/community/marketIcon';
import { extractMcpCapabilities } from '@/server/services/community/mcpCapabilities';
import {
  getMcpConnectionType,
  sanitizeMcpCustomParamsForMarket,
} from '@/server/services/community/mcpCustomParams';
import { FileService } from '@/server/services/file';
import { SkillParser } from '@/server/services/skill/parser';
import { SkillResourceService } from '@/server/services/skill/resource';
import { SkillSecurityScanner } from '@/server/services/skill/securityScanner';
import {
  isValidAssistantPublishCategory,
  isValidMcpPublishCategory,
  isValidSkillPublishCategory,
} from '@/types/discover';

export interface CommunityServiceOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

interface McpManifest {
  meta?: {
    avatar?: string;
    description?: string;
    icon?: string;
    readme?: string;
    tags?: string[];
    title?: string;
  };
  prompts?: unknown[];
  resources?: unknown[];
  tools?: unknown[];
}

interface McpCustomParams {
  type?: string;
}

interface MarketSkillZipSource {
  content?: string | null;
  manifest: SkillManifest;
  resources?: Record<string, unknown> | null;
}

const AGENT_SKILL_SECURITY_SCAN_CONCURRENCY = 5;

const bumpPatchVersion = (version?: string | null) => {
  const currentVersion = version || '1.0.0';
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) => {
  let nextIndex = 0;
  let firstError: unknown;
  const workerCount = Math.min(concurrency, items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length && !firstError) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const item = items[currentIndex];
        if (item === undefined) continue;

        try {
          await worker(item);
        } catch (error) {
          firstError ??= error;
        }
      }
    }),
  );

  if (firstError) throw firstError;
};

const assertPublishCategory = (type: 'agent' | 'skill' | 'mcp', category?: string): string => {
  if (!category) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'CATEGORY_REQUIRED' });
  }

  const valid =
    type === 'agent'
      ? isValidAssistantPublishCategory(category)
      : type === 'skill'
        ? isValidSkillPublishCategory(category)
        : isValidMcpPublishCategory(category);

  if (!valid) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_CATEGORY' });
  }

  return category;
};

export class CommunityService {
  private db: LobeChatDatabase;
  private userId: string;

  private marketAgentModel: MarketAgentModel;
  private marketSkillModel: MarketSkillModel;
  private marketMcpModel: MarketMcpModel;
  private marketKnowledgeBaseModel: MarketKnowledgeBaseModel;
  private agentModel: AgentModel;
  private agentSkillModel: AgentSkillModel;
  private knowledgeBaseModel: KnowledgeBaseModel;
  private knowledgeBaseMarketService: KnowledgeBaseMarketService;
  private marketUsageRecordModel: MarketUsageRecordModel;
  private marketAvatarService: MarketAvatarService;
  private fileService: FileService;
  private skillParser: SkillParser;
  private skillResourceService: SkillResourceService;
  private skillSecurityScanner: SkillSecurityScanner;

  constructor(options: CommunityServiceOptions) {
    this.db = options.serverDB;
    this.userId = options.userId;

    this.marketAgentModel = new MarketAgentModel(this.db, this.userId);
    this.marketSkillModel = new MarketSkillModel(this.db, this.userId);
    this.marketMcpModel = new MarketMcpModel(this.db, this.userId);
    this.marketKnowledgeBaseModel = new MarketKnowledgeBaseModel(this.db, this.userId);
    this.agentModel = new AgentModel(this.db, this.userId);
    this.agentSkillModel = new AgentSkillModel(this.db, this.userId);
    this.knowledgeBaseModel = new KnowledgeBaseModel(this.db, this.userId);
    this.knowledgeBaseMarketService = new KnowledgeBaseMarketService(this.db, this.userId);
    this.marketUsageRecordModel = new MarketUsageRecordModel(this.db);
    this.marketAvatarService = new MarketAvatarService(this.db, this.userId);
    this.fileService = new FileService(this.db, this.userId);
    this.skillParser = new SkillParser();
    this.skillResourceService = new SkillResourceService(this.db, this.userId);
    this.skillSecurityScanner = new SkillSecurityScanner();

    // Bind lifecycle methods to avoid "used before initialization" issues
    this.publishAgent = this._publishAgent.bind(this);
    this.updateAgent = this._updateAgent.bind(this);
    this.installAgent = this._installAgent.bind(this);
    this.updateInstalledAgent = this._updateInstalledAgent.bind(this);

    this.publishSkill = this._publishSkill.bind(this);
    this.updateSkill = this._updateSkill.bind(this);
    this.installSkill = this._installSkill.bind(this);
    this.updateInstalledSkill = this._updateInstalledSkill.bind(this);

    this.publishMcp = this._publishMcp.bind(this);
    this.updateMcp = this._updateMcp.bind(this);
    this.installMcp = this._installMcp.bind(this);
    this.updateInstalledMcp = this._updateInstalledMcp.bind(this);

    this.publishKnowledgeBase = this._publishKnowledgeBase.bind(this);
    this.updateKnowledgeBase = this._updateKnowledgeBase.bind(this);
    this.installKnowledgeBase = this._installKnowledgeBase.bind(this);
    this.updateInstalledKnowledgeBase = this._updateInstalledKnowledgeBase.bind(this);
  }

  private resolveSkillMarketIcon = async (
    manifest: Record<string, unknown> | null | undefined,
    params: { category?: string; description?: string; name: string },
  ) =>
    resolveSkillMarketIcon(
      manifest,
      getExplicitSkillIcon(manifest)
        ? undefined
        : await this.marketAvatarService.generateAvatar(params),
    );

  private resolveMcpMarketIcon = async (
    manifest: McpManifest,
    params: { category?: string; description?: string; name: string },
  ) =>
    resolveMcpMarketIcon(
      manifest,
      getExplicitMcpIcon(manifest)
        ? undefined
        : await this.marketAvatarService.generateAvatar(params),
    );

  // ===== Assistant =====

  getAssistantList = (...args: Parameters<MarketAgentModel['getList']>) =>
    this.marketAgentModel.getList(...args);
  getAssistantDetail = async (identifier: string) => {
    const agent = await this.marketAgentModel.getDetail(identifier);
    if (!agent) return undefined;

    const capabilities = await this.resolveAgentCapabilities(agent);
    return { ...agent, capabilities };
  };
  getMyAssistantList = (...args: Parameters<MarketAgentModel['getMyList']>) =>
    this.marketAgentModel.getMyList(...args);
  delistAgent = (...args: Parameters<MarketAgentModel['delist']>) =>
    this.marketAgentModel.delist(...args);
  relistAgent = (identifier: string, options?: { category?: string; displayName?: string }) =>
    this._relistWithLocalSync('agent', identifier, options);

  // ===== Skill =====

  getSkillList = (...args: Parameters<MarketSkillModel['getList']>) =>
    this.marketSkillModel.getList(...args);
  getSkillDetail = (...args: Parameters<MarketSkillModel['getDetail']>) =>
    this.marketSkillModel.getDetail(...args);
  getMySkillList = (...args: Parameters<MarketSkillModel['getMyList']>) =>
    this.marketSkillModel.getMyList(...args);
  restoreSkillToLocal = async (identifier: string) => {
    const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    if (!marketSkill) throw new TRPCError({ code: 'NOT_FOUND', message: 'MARKET_SKILL_NOT_FOUND' });
    if (marketSkill.publisherId !== this.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'FORBIDDEN' });
    }

    const existing = await this.agentSkillModel.findByIdentifier(identifier);
    if (existing) {
      if (existing.marketIdentifier === identifier) return existing;

      if (existing.installedFromMarketIdentifier === identifier) {
        return this.agentSkillModel.update(existing.id, {
          name: marketSkill.name,
          description: marketSkill.description,
          content: marketSkill.content,
          editorData: marketSkill.editorData,
          installedFromMarketIdentifier: null,
          installedFromSnapshot: null,
          installedMarketVersion: marketSkill.version,
          manifest: marketSkill.manifest,
          marketIdentifier: identifier,
          resources: marketSkill.resources,
          source: 'user',
        });
      }

      throw new TRPCError({ code: 'CONFLICT', message: 'LOCAL_IDENTIFIER_CONFLICT' });
    }

    return this.agentSkillModel.create({
      identifier,
      name: marketSkill.name,
      description: marketSkill.description,
      content: marketSkill.content,
      editorData: marketSkill.editorData,
      installedFromMarketIdentifier: null,
      installedFromSnapshot: null,
      installedMarketVersion: marketSkill.version,
      manifest: marketSkill.manifest,
      marketIdentifier: identifier,
      resources: marketSkill.resources,
      source: 'user',
    });
  };
  delistSkill = (...args: Parameters<MarketSkillModel['delist']>) =>
    this.marketSkillModel.delist(...args);
  relistSkill = (identifier: string, options?: { category?: string; displayName?: string }) =>
    this._relistWithLocalSync('skill', identifier, options);

  // ===== MCP =====

  getMcpList = (...args: Parameters<MarketMcpModel['getList']>) =>
    this.marketMcpModel.getList(...args);
  getMcpDetail = (...args: Parameters<MarketMcpModel['getDetail']>) =>
    this.marketMcpModel.getDetail(...args);
  getMyMcpList = (...args: Parameters<MarketMcpModel['getMyList']>) =>
    this.marketMcpModel.getMyList(...args);
  restoreMcpToLocal = async (identifier: string) => {
    const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
    if (!marketMcp) throw new TRPCError({ code: 'NOT_FOUND', message: 'MARKET_MCP_NOT_FOUND' });
    if (marketMcp.publisherId !== this.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'FORBIDDEN' });
    }

    const [existing] = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(
        and(
          eq(userInstalledPlugins.userId, this.userId),
          eq(userInstalledPlugins.identifier, identifier),
        ),
      )
      .limit(1);

    const restoreData = {
      customParams: marketMcp.customParams as CustomPluginParams | null | undefined,
      installedFromMarketIdentifier: null,
      installedFromSnapshot: null,
      installedMarketVersion: marketMcp.version,
      manifest: marketMcp.manifest as LobeChatPluginManifest | null | undefined,
      marketIdentifier: identifier,
      source: 'user',
    } satisfies Partial<InstalledPluginItem>;

    if (existing) {
      if (existing.marketIdentifier === identifier) return existing;

      if (existing.installedFromMarketIdentifier === identifier) {
        const [result] = await this.db
          .update(userInstalledPlugins)
          .set({ ...restoreData, updatedAt: new Date() })
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              eq(userInstalledPlugins.identifier, identifier),
            ),
          )
          .returning();

        return result;
      }

      throw new TRPCError({ code: 'CONFLICT', message: 'LOCAL_IDENTIFIER_CONFLICT' });
    }

    const [result] = await this.db
      .insert(userInstalledPlugins)
      .values({
        userId: this.userId,
        identifier,
        type: 'plugin',
        ...restoreData,
      } satisfies NewInstalledPlugin)
      .returning();

    return result;
  };
  delistMcp = (...args: Parameters<MarketMcpModel['delist']>) =>
    this.marketMcpModel.delist(...args);
  relistMcp = (identifier: string, options?: { category?: string; displayName?: string }) =>
    this._relistWithLocalSync('mcp', identifier, options);

  // ===== Knowledge Base =====

  getKnowledgeBaseList = (...args: Parameters<MarketKnowledgeBaseModel['getList']>) =>
    this.marketKnowledgeBaseModel.getList(...args);
  getKnowledgeBaseDetail = (...args: Parameters<MarketKnowledgeBaseModel['getDetail']>) =>
    this.marketKnowledgeBaseModel.getDetail(...args);
  getMyKnowledgeBaseList = (...args: Parameters<MarketKnowledgeBaseModel['getMyList']>) =>
    this.marketKnowledgeBaseModel.getMyList(...args);
  delistKnowledgeBase = (...args: Parameters<MarketKnowledgeBaseModel['delist']>) =>
    this.marketKnowledgeBaseModel.delist(...args);
  relistKnowledgeBase = (
    identifier: string,
    options?: { category?: string; displayName?: string },
  ) => this._relistWithLocalSync('knowledgeBase', identifier, options);

  getPublisherResourceStates = async () => {
    const [agentStates, skillStates, mcpStates, kbStates] = await Promise.all([
      this.db
        .select({
          category: marketAgents.category,
          deletedAt: marketAgents.deletedAt,
          identifier: marketAgents.identifier,
          status: marketAgents.status,
        })
        .from(marketAgents)
        .where(eq(marketAgents.publisherId, this.userId)),
      this.db
        .select({
          category: marketSkills.category,
          deletedAt: marketSkills.deletedAt,
          identifier: marketSkills.identifier,
          status: marketSkills.status,
        })
        .from(marketSkills)
        .where(eq(marketSkills.publisherId, this.userId)),
      this.db
        .select({
          category: marketMcps.category,
          deletedAt: marketMcps.deletedAt,
          identifier: marketMcps.identifier,
          status: marketMcps.status,
        })
        .from(marketMcps)
        .where(eq(marketMcps.publisherId, this.userId)),
      this.db
        .select({
          category: sql<string | null>`null`.as('category'),
          deletedAt: marketKnowledgeBases.deletedAt,
          identifier: marketKnowledgeBases.identifier,
          status: marketKnowledgeBases.status,
        })
        .from(marketKnowledgeBases)
        .where(eq(marketKnowledgeBases.publisherId, this.userId)),
    ]);

    return {
      agents: agentStates,
      knowledgeBases: kbStates,
      mcps: mcpStates,
      skills: skillStates,
    };
  };

  getLeaderboard = (days?: number, limit?: number) =>
    this.marketUsageRecordModel.getLeaderboard(days, limit);

  recordAgentUsage = (agentIdentifier: string) =>
    this.marketUsageRecordModel.recordAgentUsage(agentIdentifier, this.userId);

  recordSkillUsage = (skillIdentifier: string, agentId?: string) =>
    this.marketUsageRecordModel.recordSkillUsage(skillIdentifier, this.userId, agentId);

  recordMcpUsage = (mcpIdentifier: string, agentId?: string) =>
    this.marketUsageRecordModel.recordMcpUsage(mcpIdentifier, this.userId, agentId);

  getUnpublishedResources = async () => {
    const resolveMcpDisplayName = (manifest: unknown, identifier: string) => {
      const data = (manifest || {}) as { meta?: { title?: string }; title?: string };
      return data.meta?.title?.trim() || data.title?.trim() || identifier;
    };

    const [agentRows, delistedAgentRows, skillRows, delistedSkillRows, mcpRows, delistedMcpRows] =
      await Promise.all([
        this.db
          .select({
            id: agents.id,
            installedFromMarketIdentifier: agents.installedFromMarketIdentifier,
            installedFromSnapshot: agents.installedFromSnapshot,
            title: agents.title,
          })
          .from(agents)
          .where(
            and(
              eq(agents.userId, this.userId),
              isNull(agents.marketIdentifier),
              not(eq(agents.virtual, true)),
            ),
          ),
        this.db
          .select({
            id: agents.id,
            installedFromMarketIdentifier: agents.installedFromMarketIdentifier,
            installedFromSnapshot: agents.installedFromSnapshot,
            marketCategory: marketAgents.category,
            marketIdentifier: agents.marketIdentifier,
            title: agents.title,
          })
          .from(agents)
          .innerJoin(marketAgents, eq(agents.marketIdentifier, marketAgents.identifier))
          .where(
            and(
              eq(agents.userId, this.userId),
              not(eq(agents.virtual, true)),
              isNotNull(agents.marketIdentifier),
              isNotNull(marketAgents.deletedAt),
              eq(marketAgents.publisherId, this.userId),
            ),
          ),
        this.db
          .select({
            id: agentSkills.id,
            identifier: agentSkills.identifier,
            installedFromMarketIdentifier: agentSkills.installedFromMarketIdentifier,
            installedFromSnapshot: agentSkills.installedFromSnapshot,
            manifest: agentSkills.manifest,
            name: agentSkills.name,
            source: agentSkills.source,
          })
          .from(agentSkills)
          .where(
            and(
              eq(agentSkills.userId, this.userId),
              isNull(agentSkills.marketIdentifier),
              ne(agentSkills.source, 'builtin'),
            ),
          ),
        this.db
          .select({
            id: agentSkills.id,
            identifier: agentSkills.identifier,
            installedFromMarketIdentifier: agentSkills.installedFromMarketIdentifier,
            installedFromSnapshot: agentSkills.installedFromSnapshot,
            manifest: agentSkills.manifest,
            marketCategory: marketSkills.category,
            marketIdentifier: agentSkills.marketIdentifier,
            name: agentSkills.name,
            source: agentSkills.source,
          })
          .from(agentSkills)
          .innerJoin(marketSkills, eq(agentSkills.marketIdentifier, marketSkills.identifier))
          .where(
            and(
              eq(agentSkills.userId, this.userId),
              ne(agentSkills.source, 'builtin'),
              isNotNull(agentSkills.marketIdentifier),
              isNotNull(marketSkills.deletedAt),
              eq(marketSkills.publisherId, this.userId),
            ),
          ),
        this.db
          .select({
            customParams: userInstalledPlugins.customParams,
            identifier: userInstalledPlugins.identifier,
            installedFromMarketIdentifier: userInstalledPlugins.installedFromMarketIdentifier,
            installedFromSnapshot: userInstalledPlugins.installedFromSnapshot,
            manifest: userInstalledPlugins.manifest,
            source: userInstalledPlugins.source,
            type: userInstalledPlugins.type,
          })
          .from(userInstalledPlugins)
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              isNull(userInstalledPlugins.marketIdentifier),
            ),
          ),
        this.db
          .select({
            customParams: userInstalledPlugins.customParams,
            identifier: userInstalledPlugins.identifier,
            installedFromMarketIdentifier: userInstalledPlugins.installedFromMarketIdentifier,
            installedFromSnapshot: userInstalledPlugins.installedFromSnapshot,
            manifest: userInstalledPlugins.manifest,
            marketCategory: marketMcps.category,
            marketIdentifier: userInstalledPlugins.marketIdentifier,
            source: userInstalledPlugins.source,
            type: userInstalledPlugins.type,
          })
          .from(userInstalledPlugins)
          .innerJoin(marketMcps, eq(userInstalledPlugins.marketIdentifier, marketMcps.identifier))
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              isNotNull(userInstalledPlugins.marketIdentifier),
              isNotNull(marketMcps.deletedAt),
              eq(marketMcps.publisherId, this.userId),
            ),
          ),
      ]);

    const publishableMcps = mcpRows.filter((row) => {
      const customParams = (row.customParams || {}) as Record<string, unknown>;
      return row.type === 'customPlugin' || Boolean(customParams.mcp);
    });

    const publishableDelistedMcps = delistedMcpRows.filter((row) => {
      const customParams = (row.customParams || {}) as Record<string, unknown>;
      return row.type === 'customPlugin' || Boolean(customParams.mcp);
    });

    const mapAgent = (
      row: (typeof agentRows)[number] | (typeof delistedAgentRows)[number],
      action: 'publish' | 'relist',
    ) => {
      const snapshot = row.installedFromSnapshot as { title?: string } | null;
      const marketSourceName = snapshot?.title || null;
      const installedFromMarket = Boolean(row.installedFromMarketIdentifier);
      const delistedRow = row as (typeof delistedAgentRows)[number];
      return {
        action,
        id: row.id,
        identifier: undefined,
        installedFromMarketIdentifier: row.installedFromMarketIdentifier,
        marketCategory: action === 'relist' ? delistedRow.marketCategory : null,
        marketIdentifier:
          action === 'relist' ? delistedRow.marketIdentifier || undefined : undefined,
        marketSourceName,
        name: row.title || row.id,
        requiresRename: installedFromMarket && action === 'publish',
        source: installedFromMarket ? ('market-installed' as const) : ('local' as const),
      };
    };

    const mapSkill = (
      row: (typeof skillRows)[number] | (typeof delistedSkillRows)[number],
      action: 'publish' | 'relist',
    ) => {
      const snapshot = row.installedFromSnapshot as { name?: string } | null;
      const marketSourceName = snapshot?.name || null;
      const installedFromMarket = Boolean(row.installedFromMarketIdentifier);
      const manifestName = (row.manifest as { name?: string } | null)?.name;
      const delistedRow = row as (typeof delistedSkillRows)[number];
      return {
        action,
        id: row.id,
        identifier: row.identifier,
        installedFromMarketIdentifier: row.installedFromMarketIdentifier,
        marketCategory: action === 'relist' ? delistedRow.marketCategory : null,
        marketIdentifier:
          action === 'relist' ? delistedRow.marketIdentifier || undefined : undefined,
        marketSourceName,
        name: row.name || manifestName || row.identifier,
        requiresRename: installedFromMarket && action === 'publish',
        source: installedFromMarket ? ('market-installed' as const) : ('local' as const),
      };
    };

    const mapMcp = (
      row: (typeof mcpRows)[number] | (typeof delistedMcpRows)[number],
      action: 'publish' | 'relist',
    ) => {
      const snapshot = row.installedFromSnapshot as {
        manifest?: { meta?: { title?: string } };
      } | null;
      const snapshotTitle = snapshot?.manifest?.meta?.title;
      const marketSourceName = snapshotTitle || null;
      const installedFromMarket = Boolean(row.installedFromMarketIdentifier);
      const displayName = resolveMcpDisplayName(row.manifest, row.identifier);
      const delistedRow = row as (typeof delistedMcpRows)[number];
      return {
        action,
        id: row.identifier,
        identifier: row.identifier,
        installedFromMarketIdentifier: row.installedFromMarketIdentifier,
        marketCategory: action === 'relist' ? delistedRow.marketCategory : null,
        marketIdentifier:
          action === 'relist' ? delistedRow.marketIdentifier || undefined : undefined,
        marketSourceName,
        name: displayName,
        requiresRename: installedFromMarket && action === 'publish',
        source: installedFromMarket ? ('market-installed' as const) : ('local' as const),
      };
    };

    return {
      agents: [
        ...agentRows.map((row) => mapAgent(row, 'publish')),
        ...delistedAgentRows.map((row) => mapAgent(row, 'relist')),
      ],
      mcps: [
        ...publishableMcps.map((row) => mapMcp(row, 'publish')),
        ...publishableDelistedMcps.map((row) => mapMcp(row, 'relist')),
      ],
      skills: [
        ...skillRows.map((row) => mapSkill(row, 'publish')),
        ...delistedSkillRows.map((row) => mapSkill(row, 'relist')),
      ],
    };
  };

  checkAgentPublishNameConflict = async (displayName: string, excludeIdentifier?: string) =>
    this.checkPublishNameConflict('agent', displayName, excludeIdentifier);

  checkSkillPublishNameConflict = async (displayName: string, excludeIdentifier?: string) =>
    this.checkPublishNameConflict('skill', displayName, excludeIdentifier);

  checkMcpPublishNameConflict = async (displayName: string, excludeIdentifier?: string) =>
    this.checkPublishNameConflict('mcp', displayName, excludeIdentifier);

  checkKnowledgeBasePublishNameConflict = async (displayName: string, excludeIdentifier?: string) =>
    this.checkPublishNameConflict('knowledgeBase', displayName, excludeIdentifier);

  private checkPublishNameConflict = async (
    type: 'agent' | 'skill' | 'mcp' | 'knowledgeBase',
    displayName: string,
    excludeIdentifier?: string,
  ) => {
    const existing =
      type === 'agent'
        ? await this.marketAgentModel.findByDisplayName(displayName, excludeIdentifier)
        : type === 'skill'
          ? await this.marketSkillModel.findByDisplayName(displayName, excludeIdentifier)
          : type === 'knowledgeBase'
            ? await this.marketKnowledgeBaseModel.findByDisplayName(displayName, excludeIdentifier)
            : await this.marketMcpModel.findByDisplayName(displayName, excludeIdentifier);

    if (!existing) {
      return { conflict: false as const };
    }

    return {
      conflict: true as const,
      existingIdentifier: existing.identifier,
      existingPublisherId: existing.publisherId,
    };
  };

  private assertPublishNameAvailable = async (
    type: 'agent' | 'skill' | 'mcp' | 'knowledgeBase',
    displayName: string,
    excludeIdentifier?: string,
  ) => {
    const result = await this.checkPublishNameConflict(type, displayName, excludeIdentifier);
    if (result.conflict) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'NAME_CONFLICT',
      });
    }
  };

  // ===== Lifecycle methods (bound in constructor) =====

  publishAgent!: typeof CommunityService.prototype._publishAgent;
  updateAgent!: typeof CommunityService.prototype._updateAgent;
  installAgent!: typeof CommunityService.prototype._installAgent;
  updateInstalledAgent!: typeof CommunityService.prototype._updateInstalledAgent;

  publishSkill!: typeof CommunityService.prototype._publishSkill;
  updateSkill!: typeof CommunityService.prototype._updateSkill;
  installSkill!: typeof CommunityService.prototype._installSkill;
  updateInstalledSkill!: typeof CommunityService.prototype._updateInstalledSkill;

  publishMcp!: typeof CommunityService.prototype._publishMcp;
  updateMcp!: typeof CommunityService.prototype._updateMcp;
  installMcp!: typeof CommunityService.prototype._installMcp;
  updateInstalledMcp!: typeof CommunityService.prototype._updateInstalledMcp;

  publishKnowledgeBase!: typeof CommunityService.prototype._publishKnowledgeBase;
  updateKnowledgeBase!: typeof CommunityService.prototype._updateKnowledgeBase;
  installKnowledgeBase!: typeof CommunityService.prototype._installKnowledgeBase;
  updateInstalledKnowledgeBase!: typeof CommunityService.prototype._updateInstalledKnowledgeBase;

  private collectAgentSkillIdentifiers = async (plugins: string[] = [], skills: string[] = []) => {
    const skillIds = new Set(skills);

    for (const identifier of plugins) {
      if (skillIds.has(identifier)) continue;

      const localSkill = await this.agentSkillModel.findByIdentifier(identifier);
      if (localSkill) {
        skillIds.add(identifier);
      }
    }

    return [...skillIds];
  };

  private resolveAgentCapabilities = async (agent: {
    identifier: string;
    plugins?: string[] | null;
    publisherId: string;
    skills?: string[] | null;
  }) => {
    const orderedIds = [...new Set([...(agent.skills || []), ...(agent.plugins || [])])];
    const capabilities: {
      avatar?: string | null;
      description?: string;
      identifier: string;
      kind: 'mcp' | 'skill';
      name: string;
      visibility: 'bundled' | 'public';
    }[] = [];

    for (const identifier of orderedIds) {
      const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
      if (marketSkill?.status === 'published' && !marketSkill.deletedAt) {
        capabilities.push({
          avatar:
            marketSkill.icon ??
            getExplicitSkillIcon(marketSkill.manifest as Record<string, unknown>) ??
            null,
          description: marketSkill.description ?? undefined,
          identifier,
          kind: 'skill',
          name: marketSkill.name,
          visibility: marketSkill.visibility === 'bundled' ? 'bundled' : 'public',
        });
        continue;
      }

      const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
      if (marketMcp?.status === 'published' && !marketMcp.deletedAt) {
        const manifest = marketMcp.manifest as McpManifest | null;
        capabilities.push({
          avatar: marketMcp.icon ?? getExplicitMcpIcon(manifest) ?? null,
          description: marketMcp.description ?? manifest?.meta?.description ?? undefined,
          identifier,
          kind: 'mcp',
          name: marketMcp.name,
          visibility: marketMcp.visibility === 'bundled' ? 'bundled' : 'public',
        });
        continue;
      }

      const [publisherSkill] = await this.db
        .select()
        .from(agentSkills)
        .where(
          and(eq(agentSkills.userId, agent.publisherId), eq(agentSkills.identifier, identifier)),
        )
        .limit(1);

      if (publisherSkill) {
        const manifest = publisherSkill.manifest as Record<string, unknown> | null;
        capabilities.push({
          avatar: getExplicitSkillIcon(manifest) ?? null,
          description: publisherSkill.description ?? undefined,
          identifier,
          kind: 'skill',
          name: publisherSkill.name,
          visibility: 'bundled',
        });
        continue;
      }

      const [publisherMcp] = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(
            eq(userInstalledPlugins.userId, agent.publisherId),
            eq(userInstalledPlugins.identifier, identifier),
          ),
        )
        .limit(1);

      if (publisherMcp?.manifest) {
        const manifest = publisherMcp.manifest as McpManifest;
        capabilities.push({
          avatar: getExplicitMcpIcon(manifest) ?? null,
          description: manifest.meta?.description ?? undefined,
          identifier,
          kind: 'mcp',
          name: manifest.meta?.title || identifier,
          visibility: 'bundled',
        });
      }
    }

    return capabilities;
  };

  private syncAgentKnowledgeBasesToMarket = async (
    agentId: string,
    bundledKnowledgeBaseIdentifiers: string[] = [],
  ) => {
    const assigned = await this.agentModel.getAgentAssignedKnowledge(agentId);
    const kbIds = (assigned.knowledgeBases || [])
      .filter((kb) => kb?.id && kb.enabled !== false)
      .map((kb) => kb!.id as string);

    for (const kbId of kbIds) {
      const existing = await this.marketKnowledgeBaseModel.findByIdentifier(kbId);
      const shouldBePublic = bundledKnowledgeBaseIdentifiers.includes(kbId);

      if (existing) {
        if (
          existing.publisherId === this.userId &&
          shouldBePublic &&
          existing.visibility === 'bundled'
        ) {
          await this.marketKnowledgeBaseModel.makePublic(kbId);
        }
        if (existing.publisherId === this.userId) {
          await this.knowledgeBaseMarketService.snapshotLocalToMarket(
            kbId,
            shouldBePublic ? 'public' : existing.visibility === 'public' ? 'public' : 'bundled',
          );
        }
        continue;
      }

      const localKb = await this.knowledgeBaseModel.findById(kbId);
      if (!localKb) continue;

      await this.knowledgeBaseMarketService.snapshotLocalToMarket(
        kbId,
        shouldBePublic ? 'public' : 'bundled',
      );
    }

    return kbIds;
  };

  private _publishAgent = async (
    agentId: string,
    bundledSkillIdentifiers: string[] = [],
    bundledMcpIdentifiers: string[] = [],
    bundledKnowledgeBaseIdentifiers: string[] = [],
    newDisplayName?: string,
    category?: string,
  ) => {
    const publishCategory = assertPublishCategory('agent', category);
    const localAgent = await this.agentModel.getAgentConfigById(agentId);
    if (!localAgent) throw new Error('Agent not found');

    if (!localAgent.title || !localAgent.systemRole) {
      throw new Error('Title and systemRole are required');
    }

    const displayTitle = (newDisplayName ?? localAgent.title).trim();
    if (!displayTitle) throw new Error('Title is required');

    if (localAgent.marketIdentifier) {
      const published = await this.marketAgentModel.findByIdentifier(localAgent.marketIdentifier);
      if (published?.publisherId === this.userId) {
        if (newDisplayName) {
          await this.agentModel.update(agentId, { title: displayTitle });
        }
        if (published.deletedAt) {
          return this._relistWithLocalSync('agent', localAgent.marketIdentifier, {
            category: publishCategory,
            displayName: newDisplayName,
          });
        }
        return this._updateAgent(localAgent.marketIdentifier);
      }
    }

    await this.assertPublishNameAvailable('agent', displayTitle);

    const identifier = `agt_${createNanoId(8)()}`;

    const agentSkillIds = await this.collectAgentSkillIdentifiers(
      localAgent.plugins || [],
      localAgent.skills || [],
    );

    await this.assertAgentLocalSkillsWebSafe(agentSkillIds);

    const knowledgeBaseIds = await this.syncAgentKnowledgeBasesToMarket(
      agentId,
      bundledKnowledgeBaseIdentifiers,
    );

    const marketAgent = await this.marketAgentModel.create({
      identifier,
      title: displayTitle,
      description: localAgent.description,
      avatar:
        localAgent.avatar ||
        (await this.marketAvatarService.generateAvatar({
          category: publishCategory,
          description: localAgent.description || undefined,
          name: displayTitle,
        })),
      backgroundColor: localAgent.backgroundColor,
      category: publishCategory,
      tags: localAgent.tags,
      systemRole: localAgent.systemRole,
      model: typeof localAgent.model === 'string' ? localAgent.model : null,
      provider: localAgent.provider,
      plugins: localAgent.plugins,
      skills: agentSkillIds,
      knowledgeBases: knowledgeBaseIds,
      chatConfig: localAgent.chatConfig,
      fewShots: localAgent.fewShots,
      openingMessage: localAgent.openingMessage,
      openingQuestions: localAgent.openingQuestions,
      editorData: localAgent.editorData,
      tokenUsage: 0,
      pluginCount: new Set([...(localAgent.plugins || []), ...agentSkillIds]).size,
      knowledgeCount: knowledgeBaseIds.length,
    });

    for (const skillIdentifier of agentSkillIds) {
      const existingMarketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
      if (existingMarketSkill) continue;

      const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
      if (!localSkill) continue;

      const isBundled = !bundledSkillIdentifiers.includes(skillIdentifier);
      await this.marketSkillModel.create({
        identifier: skillIdentifier,
        name: localSkill.name,
        description: localSkill.description,
        icon: await this.resolveSkillMarketIcon(localSkill.manifest as Record<string, unknown>, {
          description: localSkill.description || undefined,
          name: localSkill.name,
        }),
        category: null,
        tags: localSkill.manifest?.tags || [],
        content: localSkill.content,
        manifest: localSkill.manifest,
        resources: localSkill.resources,
        editorData: localSkill.editorData,
        resourcesCount: Object.keys(localSkill.resources || {}).length,
        visibility: isBundled ? 'bundled' : 'public',
      });
    }

    const mcpIdentifiers = localAgent.plugins || [];
    for (const mcpIdentifier of mcpIdentifiers) {
      const existingMarketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
      if (existingMarketMcp) continue;

      const [localMcp] = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, mcpIdentifier),
          ),
        )
        .limit(1);

      if (!localMcp?.manifest) continue;

      const manifest = localMcp.manifest as McpManifest;
      const customParams = (localMcp.customParams || {}) as McpCustomParams;
      const capabilities = extractMcpCapabilities(manifest);
      const isBundled = !bundledMcpIdentifiers.includes(mcpIdentifier);

      await this.marketMcpModel.create({
        identifier: mcpIdentifier,
        name: manifest.meta?.title || mcpIdentifier,
        description: manifest.meta?.description,
        icon: resolveMcpMarketIcon(manifest),
        category: null,
        tags: manifest.meta?.tags || [],
        overview: manifest.meta?.readme,
        connectionType: customParams.type || 'http',
        manifest: localMcp.manifest,
        customParams: localMcp.customParams,
        capabilities,
        toolsCount: manifest.tools?.length || 0,
        promptsCount: manifest.prompts?.length || 0,
        resourcesCount: manifest.resources?.length || 0,
        visibility: isBundled ? 'bundled' : 'public',
      });
    }

    await this.agentModel.update(agentId, {
      marketIdentifier: identifier,
      ...(newDisplayName ? { title: displayTitle } : {}),
    });

    return marketAgent;
  };

  private _installAgent = async (marketIdentifier: string) => {
    const marketAgent = await this.marketAgentModel.getDetail(marketIdentifier);
    if (!marketAgent) throw new Error('Market agent not found');

    const existing = await this.db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.installedFromMarketIdentifier, marketIdentifier),
          eq(agents.userId, this.userId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const snapshot = {
      title: marketAgent.title,
      description: marketAgent.description,
      systemRole: marketAgent.systemRole,
      model: marketAgent.model,
      provider: marketAgent.provider,
      plugins: marketAgent.plugins,
      skills: marketAgent.skills,
      chatConfig: marketAgent.chatConfig,
      fewShots: marketAgent.fewShots,
      openingMessage: marketAgent.openingMessage,
      openingQuestions: marketAgent.openingQuestions,
    };

    const localAgent = await this.agentModel.create({
      title: marketAgent.title,
      description: marketAgent.description,
      avatar: marketAgent.avatar,
      backgroundColor: marketAgent.backgroundColor,
      tags: marketAgent.tags,
      systemRole: marketAgent.systemRole,
      model: marketAgent.model,
      provider: marketAgent.provider,
      plugins: marketAgent.plugins,
      skills: marketAgent.skills,
      chatConfig: marketAgent.chatConfig,
      fewShots: marketAgent.fewShots,
      openingMessage: marketAgent.openingMessage,
      openingQuestions: marketAgent.openingQuestions,
      editorData: marketAgent.editorData,
      installedFromMarketIdentifier: marketIdentifier,
      installedFromSnapshot: snapshot,
      installedMarketVersion: marketAgent.version,
    });

    for (const skillIdentifier of marketAgent.skills || []) {
      const marketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);

      const existingSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);

      if (marketSkill) {
        if (existingSkill?.zipFileHash) continue;

        if (existingSkill && existingSkill.installedFromMarketIdentifier !== skillIdentifier) {
          continue;
        }

        const zipFileHash = await this.buildAndStoreMarketSkillZip({
          content: marketSkill.content,
          manifest: marketSkill.manifest,
          resources: marketSkill.resources as Record<string, unknown> | null | undefined,
        });

        if (existingSkill) {
          await this.agentSkillModel.update(existingSkill.id, {
            name: marketSkill.name,
            description: marketSkill.description,
            source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
            manifest: marketSkill.manifest,
            content: marketSkill.content,
            editorData: marketSkill.editorData,
            resources: marketSkill.resources,
            zipFileHash,
            installedFromSnapshot: {
              content: marketSkill.content,
              description: marketSkill.description,
              manifest: marketSkill.manifest,
              name: marketSkill.name,
            },
            installedMarketVersion: marketSkill.version,
          });
          continue;
        }

        await this.agentSkillModel.create({
          identifier: skillIdentifier,
          name: marketSkill.name,
          description: marketSkill.description,
          source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
          manifest: marketSkill.manifest,
          content: marketSkill.content,
          editorData: marketSkill.editorData,
          resources: marketSkill.resources,
          zipFileHash,
          installedFromMarketIdentifier: skillIdentifier,
          installedFromSnapshot: {
            content: marketSkill.content,
            description: marketSkill.description,
            manifest: marketSkill.manifest,
            name: marketSkill.name,
          },
          installedMarketVersion: marketSkill.version,
        });
        continue;
      }

      if (existingSkill) continue;

      // If skill not in market, try to get from publisher's agent skills
      const publisherSkill = await this.db
        .select()
        .from(agentSkills)
        .where(
          and(
            eq(agentSkills.userId, marketAgent.publisherId),
            eq(agentSkills.identifier, skillIdentifier),
          ),
        )
        .limit(1);

      if (publisherSkill.length > 0) {
        const skill = publisherSkill[0];
        await this.agentSkillModel.create({
          identifier: skillIdentifier,
          name: skill.name,
          description: skill.description,
          source: skill.source || 'market',
          manifest: skill.manifest,
          content: skill.content,
          editorData: skill.editorData,
          resources: skill.resources,
          installedFromMarketIdentifier: null,
          installedFromSnapshot: {
            content: skill.content,
            description: skill.description,
            manifest: skill.manifest,
            name: skill.name,
          },
        });
      }
    }

    for (const mcpIdentifier of marketAgent.plugins || []) {
      const marketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);

      const existingMcp = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, mcpIdentifier),
          ),
        )
        .limit(1);

      if (existingMcp.length > 0) continue;

      // If MCP exists in market, install from market data
      if (marketMcp) {
        await this.db.insert(userInstalledPlugins).values({
          identifier: mcpIdentifier,
          type: 'plugin',
          userId: this.userId,
          manifest: marketMcp.manifest,
          customParams: marketMcp.customParams,
          source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
          installedFromMarketIdentifier: mcpIdentifier,
          installedFromSnapshot: {
            customParams: marketMcp.customParams,
            manifest: marketMcp.manifest,
          },
          installedMarketVersion: marketMcp.version,
        });

        await this.marketMcpModel.incrementInstallCount(mcpIdentifier);
        continue;
      }

      // If MCP not in market, try to get manifest from the publisher's installed plugins
      // This handles the case where the MCP was installed from lobehub but not published locally
      const publisherInstalledMcp = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(
            eq(userInstalledPlugins.userId, marketAgent.publisherId),
            eq(userInstalledPlugins.identifier, mcpIdentifier),
          ),
        )
        .limit(1);

      if (publisherInstalledMcp.length > 0 && publisherInstalledMcp[0].manifest) {
        const publisherMcp = publisherInstalledMcp[0];
        await this.db.insert(userInstalledPlugins).values({
          identifier: mcpIdentifier,
          type: 'plugin',
          userId: this.userId,
          manifest: publisherMcp.manifest,
          customParams: publisherMcp.customParams,
          source: publisherMcp.source || 'market',
          installedFromMarketIdentifier: null,
          installedFromSnapshot: {
            customParams: publisherMcp.customParams,
            manifest: publisherMcp.manifest,
          },
        });
      }
    }

    for (const kbIdentifier of marketAgent.knowledgeBases || []) {
      const localKb = await this.knowledgeBaseMarketService.installMarketToLocal(kbIdentifier);
      await this.agentModel.createAgentKnowledgeBase(localAgent.id, localKb.id, true);
    }

    await this.marketAgentModel.incrementInstallCount(marketIdentifier);

    return localAgent;
  };

  private _publishSkill = async (skillId: string, newDisplayName?: string, category?: string) => {
    const publishCategory = assertPublishCategory('skill', category);
    const localSkill = await this.agentSkillModel.findById(skillId);
    if (!localSkill) throw new Error('Skill not found');

    const localIdentifier = localSkill.identifier || `skl_${createNanoId(8)()}`;
    const displayName = (newDisplayName ?? localSkill.name).trim();
    if (!displayName) throw new Error('Skill name is required');

    const marketById = await this.marketSkillModel.findByIdentifier(localIdentifier);
    const updatedManifest = {
      ...localSkill.manifest,
      name: displayName,
    };

    await this.assertLocalSkillWebSafe(localSkill, {
      content: localSkill.content,
      manifest: updatedManifest,
      resources: localSkill.resources,
    });

    const resolveSkillIcon = () =>
      this.resolveSkillMarketIcon(updatedManifest as Record<string, unknown>, {
        category: publishCategory,
        description: localSkill.description || undefined,
        name: displayName,
      });

    // Path A: already published by self
    if (localSkill.marketIdentifier) {
      const published = await this.marketSkillModel.findByIdentifier(localSkill.marketIdentifier);
      if (published?.publisherId === this.userId) {
        if (newDisplayName) {
          await this.agentSkillModel.update(skillId, {
            name: displayName,
            manifest: updatedManifest,
          });
        }
        if (published.deletedAt) {
          return this._relistWithLocalSync('skill', localSkill.marketIdentifier, {
            category: publishCategory,
            displayName: newDisplayName,
          });
        }
        if (published.visibility === 'public') {
          return this._updateSkill(localSkill.marketIdentifier);
        }
      }
    }

    // Path B: bundled → public
    if (marketById?.publisherId === this.userId && marketById.visibility === 'bundled') {
      await this.assertPublishNameAvailable('skill', displayName, localIdentifier);

      await this.marketSkillModel.makePublic(localIdentifier);
      const marketSkill = await this.marketSkillModel.updateByIdentifier(localIdentifier, {
        name: displayName,
        description: localSkill.description,
        content: localSkill.content,
        icon: await resolveSkillIcon(),
        manifest: updatedManifest,
        resources: localSkill.resources,
        editorData: localSkill.editorData,
        resourcesCount: Object.keys(localSkill.resources || {}).length,
      });

      await this.agentSkillModel.update(skillId, {
        marketIdentifier: localIdentifier,
        name: displayName,
        manifest: updatedManifest,
      });

      return marketSkill;
    }

    // Path D: fork (installed from market, not owned by current user)
    const isFork =
      Boolean(localSkill.installedFromMarketIdentifier) &&
      (!marketById || marketById.publisherId !== this.userId);

    if (isFork) {
      await this.assertPublishNameAvailable('skill', displayName);

      const newIdentifier = `skl_${createNanoId(8)()}`;
      const marketSkill = await this.marketSkillModel.create({
        identifier: newIdentifier,
        name: displayName,
        description: localSkill.description,
        icon: await resolveSkillIcon(),
        category: publishCategory,
        tags: localSkill.manifest?.tags || [],
        content: localSkill.content,
        manifest: updatedManifest,
        resources: localSkill.resources,
        editorData: localSkill.editorData,
        resourcesCount: Object.keys(localSkill.resources || {}).length,
      });

      await this.agentSkillModel.update(skillId, {
        marketIdentifier: newIdentifier,
        name: displayName,
        manifest: updatedManifest,
      });

      return marketSkill;
    }

    // Path C: user-built first publish
    await this.assertPublishNameAvailable('skill', displayName);

    let marketIdentifier = localIdentifier;
    if (marketById && marketById.publisherId !== this.userId) {
      marketIdentifier = `skl_${createNanoId(8)()}`;
    }

    const marketSkill = await this.marketSkillModel.create({
      identifier: marketIdentifier,
      name: displayName,
      description: localSkill.description,
      icon: await resolveSkillIcon(),
      category: publishCategory,
      tags: localSkill.manifest?.tags || [],
      content: localSkill.content,
      manifest: updatedManifest,
      resources: localSkill.resources,
      editorData: localSkill.editorData,
      resourcesCount: Object.keys(localSkill.resources || {}).length,
    });

    await this.agentSkillModel.update(skillId, {
      marketIdentifier,
      name: displayName,
      manifest: updatedManifest,
      ...(!localSkill.identifier ? { identifier: localIdentifier } : {}),
    });

    return marketSkill;
  };

  private _updateSkill = async (identifier: string) => {
    const [localSkill] = await this.db
      .select()
      .from(agentSkills)
      .where(and(eq(agentSkills.marketIdentifier, identifier), eq(agentSkills.userId, this.userId)))
      .limit(1);

    if (!localSkill) throw new Error('Local skill not found for this market identifier');

    await this.assertLocalSkillWebSafe(localSkill, {
      content: localSkill.content,
      manifest: localSkill.manifest,
      resources: localSkill.resources,
    });

    const currentMarketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    const newVersion = bumpPatchVersion(currentMarketSkill?.version);
    const icon = await this.resolveSkillMarketIcon(localSkill.manifest as Record<string, unknown>, {
      category: currentMarketSkill?.category ?? undefined,
      description: localSkill.description || undefined,
      name: localSkill.name,
    });

    return this.marketSkillModel.updateByIdentifier(identifier, {
      name: localSkill.name,
      description: localSkill.description,
      content: localSkill.content,
      icon,
      manifest: localSkill.manifest,
      resources: localSkill.resources,
      editorData: localSkill.editorData,
      resourcesCount: Object.keys(localSkill.resources || {}).length,
      version: newVersion,
    });
  };

  private buildMarketSkillZipPackage = async (marketSkill: MarketSkillZipSource) => {
    const resources = new Map<string, Buffer>();
    const marketResources = marketSkill.resources ?? {};

    for (const [path, resource] of Object.entries(marketResources).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (typeof resource === 'string') {
        resources.set(path, Buffer.from(resource, 'utf8'));
        continue;
      }

      if (!resource || typeof resource !== 'object') continue;

      if ('content' in resource) {
        const content = (resource as { content?: unknown }).content;
        const encoding =
          (resource as { encoding?: string }).encoding === 'base64' ? 'base64' : 'utf8';
        resources.set(path, Buffer.from(String(content ?? ''), encoding));
        continue;
      }

      if (!('fileHash' in resource)) continue;

      const resolvedResource = await this.skillResourceService.readResource(
        marketResources as Record<string, SkillResourceMeta>,
        path,
      );
      resources.set(
        path,
        Buffer.from(
          resolvedResource.content,
          resolvedResource.encoding === 'base64' ? 'base64' : 'utf8',
        ),
      );
    }

    return this.skillParser.buildSkillZipPackage({
      content: marketSkill.content ?? '',
      manifest: marketSkill.manifest,
      resources,
    });
  };

  private assertAgentLocalSkillsWebSafe = async (skillIdentifiers: string[]) => {
    const localSkills: NonNullable<Awaited<ReturnType<AgentSkillModel['findByIdentifier']>>>[] = [];

    for (const skillIdentifier of skillIdentifiers) {
      const existingMarketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
      if (existingMarketSkill) continue;

      const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
      if (!localSkill || localSkill.webSafeScanPassed) continue;

      localSkills.push(localSkill);
    }

    await runWithConcurrency(
      localSkills,
      AGENT_SKILL_SECURITY_SCAN_CONCURRENCY,
      async (localSkill) =>
        this.assertLocalSkillWebSafe(localSkill, {
          content: localSkill.content,
          manifest: localSkill.manifest,
          resources: localSkill.resources,
        }),
    );
  };

  private assertLocalSkillWebSafe = async (
    localSkill: { id: string; name: string; webSafeScanPassed: boolean },
    scanSource: MarketSkillZipSource,
  ) => {
    if (localSkill.webSafeScanPassed) return;

    const { buffer } = await this.buildMarketSkillZipPackage(scanSource);
    await this.skillSecurityScanner.assertZipSafe({
      buffer,
      fileName: `${localSkill.name || 'skill'}.zip`,
    });

    await this.agentSkillModel.update(localSkill.id, { webSafeScanPassed: true });
  };

  private buildAndStoreMarketSkillZip = async (marketSkill: MarketSkillZipSource) => {
    const { buffer, hash } = await this.buildMarketSkillZipPackage(marketSkill);
    const zipKey = `skills/zip/${hash}.zip`;

    await this.fileService.uploadBuffer(zipKey, buffer, 'application/zip');
    await this.fileService.createGlobalFile({
      fileHash: hash,
      fileType: 'application/zip',
      metadata: {
        dirname: 'skills/zip',
        filename: `${hash}.zip`,
        path: zipKey,
      },
      size: buffer.length,
      url: zipKey,
    });

    return hash;
  };

  private _installSkill = async (identifier: string) => {
    const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    if (!marketSkill) throw new Error('Market skill not found');

    const existing = await this.agentSkillModel.findByIdentifier(identifier);
    if (existing) {
      if (existing.installedFromMarketIdentifier !== identifier) {
        throw new TRPCError({ code: 'CONFLICT', message: 'LOCAL_IDENTIFIER_CONFLICT' });
      }

      if (existing.zipFileHash) return existing;

      const zipFileHash = await this.buildAndStoreMarketSkillZip({
        content: marketSkill.content,
        manifest: marketSkill.manifest,
        resources: marketSkill.resources as Record<string, unknown> | null | undefined,
      });

      const updated = await this.agentSkillModel.update(existing.id, {
        zipFileHash,
        content: marketSkill.content,
        manifest: marketSkill.manifest,
        resources: marketSkill.resources,
        installedFromMarketIdentifier: identifier,
        installedFromSnapshot: {
          name: marketSkill.name,
          description: marketSkill.description,
          manifest: marketSkill.manifest,
          content: marketSkill.content,
        },
        installedMarketVersion: marketSkill.version,
      });

      return updated;
    }

    const zipFileHash = await this.buildAndStoreMarketSkillZip({
      content: marketSkill.content,
      manifest: marketSkill.manifest,
      resources: marketSkill.resources as Record<string, unknown> | null | undefined,
    });

    const localSkill = await this.agentSkillModel.create({
      identifier,
      name: marketSkill.name,
      description: marketSkill.description,
      source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
      manifest: marketSkill.manifest,
      content: marketSkill.content,
      editorData: marketSkill.editorData,
      resources: marketSkill.resources,
      zipFileHash,
      installedFromMarketIdentifier: identifier,
      installedFromSnapshot: {
        name: marketSkill.name,
        description: marketSkill.description,
        manifest: marketSkill.manifest,
        content: marketSkill.content,
      },
      installedMarketVersion: marketSkill.version,
    });

    await this.marketSkillModel.incrementInstallCount(identifier);

    return localSkill;
  };

  private _updateInstalledSkill = async (identifier: string) => {
    const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
    if (!marketSkill) throw new Error('Market skill not found');

    const [localSkill] = await this.db
      .select()
      .from(agentSkills)
      .where(
        and(
          eq(agentSkills.installedFromMarketIdentifier, identifier),
          eq(agentSkills.userId, this.userId),
        ),
      )
      .limit(1);

    if (!localSkill) throw new Error('Installed skill not found');

    const zipFileHash = await this.buildAndStoreMarketSkillZip({
      content: marketSkill.content,
      manifest: marketSkill.manifest,
      resources: marketSkill.resources as Record<string, unknown> | null | undefined,
    });

    await this.agentSkillModel.update(localSkill.id, {
      name: marketSkill.name,
      description: marketSkill.description,
      manifest: marketSkill.manifest,
      content: marketSkill.content,
      editorData: marketSkill.editorData,
      resources: marketSkill.resources,
      zipFileHash,
      installedFromSnapshot: {
        name: marketSkill.name,
        description: marketSkill.description,
        manifest: marketSkill.manifest,
        content: marketSkill.content,
      },
      installedMarketVersion: marketSkill.version,
    });

    return { success: true };
  };

  private _publishMcp = async (
    identifier: string,
    manifest: McpManifest,
    customParams: McpCustomParams,
    newDisplayName?: string,
    category?: string,
  ) => {
    const publishCategory = assertPublishCategory('mcp', category);
    const [localMcp] = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(
        and(
          eq(userInstalledPlugins.userId, this.userId),
          eq(userInstalledPlugins.identifier, identifier),
        ),
      )
      .limit(1);

    if (!localMcp) throw new Error('Local MCP not found');

    const displayName = (newDisplayName ?? manifest.meta?.title ?? identifier).trim();
    if (!displayName) throw new Error('MCP name is required');

    const normalizedManifest = { ...manifest };
    if (!normalizedManifest.tools && (manifest as any)?.api) {
      normalizedManifest.tools = (manifest as any).api;
    }
    normalizedManifest.meta = {
      ...normalizedManifest.meta,
      title: displayName,
    };

    const extracted = extractMcpCapabilities(normalizedManifest);
    const marketById = await this.marketMcpModel.findByIdentifier(identifier);

    // Path A: already published by self. The owning market record is reachable
    // either through the backfilled link on the local plugin, or — for legacy
    // rows and share-created 'unlisted' records that predate the link — by the
    // plugin's own identifier. Route to update/relist instead of re-creating a
    // row at the same identifier, which would trip marketMcps_identifier_unique.
    const linkedMarket = localMcp.marketIdentifier
      ? await this.marketMcpModel.findByIdentifier(localMcp.marketIdentifier)
      : undefined;
    const selfMarket =
      linkedMarket?.publisherId === this.userId && linkedMarket.visibility !== 'bundled'
        ? linkedMarket
        : marketById?.publisherId === this.userId && marketById.visibility !== 'bundled'
          ? marketById
          : undefined;

    if (selfMarket) {
      // Backfill the missing link so future publishes hit the fast path.
      if (localMcp.marketIdentifier !== selfMarket.identifier) {
        await this.db
          .update(userInstalledPlugins)
          .set({ marketIdentifier: selfMarket.identifier, updatedAt: new Date() })
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              eq(userInstalledPlugins.identifier, identifier),
            ),
          );
      }

      if (selfMarket.deletedAt) {
        return this._relistWithLocalSync('mcp', selfMarket.identifier, {
          category: publishCategory,
          displayName: newDisplayName,
        });
      }

      // Promote a share-created 'unlisted' record into a real public listing.
      if (selfMarket.visibility === 'unlisted') {
        await this.assertPublishNameAvailable('mcp', displayName, selfMarket.identifier);
        await this.marketMcpModel.makePublic(selfMarket.identifier);
        await this.marketMcpModel.updateByIdentifier(selfMarket.identifier, {
          category: publishCategory,
        });
      }

      return this._updateMcp(selfMarket.identifier, normalizedManifest, customParams);
    }

    const marketCustomParams = sanitizeMcpCustomParamsForMarket(customParams);

    const createMarketMcp = async (marketIdentifier: string) => {
      const marketMcp = await this.marketMcpModel.create({
        identifier: marketIdentifier,
        name: displayName,
        description: normalizedManifest.meta?.description,
        icon: await this.resolveMcpMarketIcon(normalizedManifest, {
          category: publishCategory,
          description: normalizedManifest.meta?.description || undefined,
          name: displayName,
        }),
        category: publishCategory,
        tags: normalizedManifest.meta?.tags || [],
        overview: normalizedManifest.meta?.readme,
        connectionType: getMcpConnectionType(customParams),
        manifest: normalizedManifest,
        customParams: marketCustomParams,
        capabilities: extracted.capabilities,
        toolsCount: extracted.toolsCount,
        promptsCount: extracted.promptsCount,
        resourcesCount: extracted.resourcesCount,
      });

      await this.db
        .update(userInstalledPlugins)
        .set({
          manifest: normalizedManifest as any,
          customParams: customParams as any,
          marketIdentifier,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, identifier),
          ),
        );

      return marketMcp;
    };

    // Path B: bundled → public
    if (marketById?.publisherId === this.userId && marketById.visibility === 'bundled') {
      await this.assertPublishNameAvailable('mcp', displayName, identifier);

      await this.marketMcpModel.makePublic(identifier);
      const marketMcp = await this.marketMcpModel.updateByIdentifier(identifier, {
        name: displayName,
        description: normalizedManifest.meta?.description,
        overview: normalizedManifest.meta?.readme,
        icon: await this.resolveMcpMarketIcon(normalizedManifest, {
          category: publishCategory,
          description: normalizedManifest.meta?.description || undefined,
          name: displayName,
        }),
        manifest: normalizedManifest,
        customParams: marketCustomParams,
        capabilities: extracted.capabilities,
        toolsCount: extracted.toolsCount,
        promptsCount: extracted.promptsCount,
        resourcesCount: extracted.resourcesCount,
      });

      await this.db
        .update(userInstalledPlugins)
        .set({
          manifest: normalizedManifest as any,
          customParams: customParams as any,
          marketIdentifier: identifier,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, identifier),
          ),
        );

      return marketMcp;
    }

    // Path D: fork (installed from market, not owned by current user)
    const isFork =
      Boolean(localMcp.installedFromMarketIdentifier) &&
      (!marketById || marketById.publisherId !== this.userId);

    if (isFork) {
      await this.assertPublishNameAvailable('mcp', displayName);

      const newIdentifier = `mcp_${createNanoId(8)()}`;
      return createMarketMcp(newIdentifier);
    }

    // Path C: user-built first publish
    await this.assertPublishNameAvailable('mcp', displayName);

    let marketIdentifier = identifier;
    if (marketById && marketById.publisherId !== this.userId) {
      marketIdentifier = `mcp_${createNanoId(8)()}`;
    }

    return createMarketMcp(marketIdentifier);
  };

  private _updateMcp = async (
    marketIdentifier: string,
    manifest?: McpManifest,
    customParams?: McpCustomParams,
  ) => {
    const [localMcp] = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(
        and(
          eq(userInstalledPlugins.marketIdentifier, marketIdentifier),
          eq(userInstalledPlugins.userId, this.userId),
        ),
      )
      .limit(1);

    const sourceManifest = (manifest ?? localMcp?.manifest) as McpManifest | undefined;
    const sourceCustomParams = (customParams ?? localMcp?.customParams) as
      | McpCustomParams
      | undefined;

    if (!sourceManifest) {
      throw new Error('Local MCP not found for this market identifier');
    }

    const displayName = (sourceManifest.meta?.title ?? marketIdentifier).trim();
    if (!displayName) throw new Error('MCP name is required');

    const currentMarketMcp = await this.marketMcpModel.findByIdentifier(marketIdentifier);
    if (!currentMarketMcp) throw new Error('Market MCP not found');

    const newVersion = bumpPatchVersion(currentMarketMcp.version);
    const extracted = extractMcpCapabilities(sourceManifest);

    const normalizedManifest = { ...sourceManifest };
    if (!normalizedManifest.tools && (sourceManifest as any)?.api) {
      normalizedManifest.tools = (sourceManifest as any).api;
    }
    normalizedManifest.meta = {
      ...normalizedManifest.meta,
      title: displayName,
    };

    const marketCustomParams = sanitizeMcpCustomParamsForMarket(sourceCustomParams ?? {});

    const updated = await this.marketMcpModel.updateByIdentifier(marketIdentifier, {
      name: displayName,
      description: normalizedManifest.meta?.description,
      overview: normalizedManifest.meta?.readme,
      manifest: normalizedManifest,
      customParams: marketCustomParams,
      capabilities: extracted.capabilities,
      toolsCount: extracted.toolsCount,
      promptsCount: extracted.promptsCount,
      resourcesCount: extracted.resourcesCount,
      version: newVersion,
    });

    if (!updated) throw new Error('Market MCP not found or not authorized');

    if (localMcp) {
      await this.db
        .update(userInstalledPlugins)
        .set({
          manifest: normalizedManifest as any,
          customParams: (sourceCustomParams ?? localMcp.customParams) as any,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, localMcp.identifier),
          ),
        );
    }

    return updated;
  };

  private _installMcp = async (identifier: string) => {
    const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
    if (!marketMcp) throw new Error('Market MCP not found');

    const existing = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(
        and(
          eq(userInstalledPlugins.userId, this.userId),
          eq(userInstalledPlugins.identifier, identifier),
        ),
      )
      .limit(1);

    if (existing.length > 0) return existing[0];

    await this.db.insert(userInstalledPlugins).values({
      userId: this.userId,
      identifier,
      type: 'plugin',
      manifest: marketMcp.manifest,
      customParams: marketMcp.customParams,
      source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
      installedFromMarketIdentifier: identifier,
      installedFromSnapshot: {
        manifest: marketMcp.manifest,
        customParams: marketMcp.customParams,
      },
      installedMarketVersion: marketMcp.version,
    });

    await this.marketMcpModel.incrementInstallCount(identifier);

    return { success: true, identifier };
  };

  private _updateInstalledMcp = async (identifier: string) => {
    const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
    if (!marketMcp) throw new Error('Market MCP not found');

    await this.db
      .update(userInstalledPlugins)
      .set({
        manifest: marketMcp.manifest,
        customParams: marketMcp.customParams,
        source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
        installedFromSnapshot: {
          manifest: marketMcp.manifest,
          customParams: marketMcp.customParams,
        },
        installedMarketVersion: marketMcp.version,
      })
      .where(
        and(
          eq(userInstalledPlugins.userId, this.userId),
          eq(userInstalledPlugins.identifier, identifier),
        ),
      );

    return { success: true };
  };

  private _updateAgent = async (identifier: string) => {
    const [localAgent] = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.marketIdentifier, identifier), eq(agents.userId, this.userId)))
      .limit(1);

    if (!localAgent) throw new Error('Local agent not found');

    const knowledgeBaseIds = await this.syncAgentKnowledgeBasesToMarket(localAgent.id, []);
    const agentSkillIds = await this.collectAgentSkillIdentifiers(
      localAgent.plugins || [],
      localAgent.skills || [],
    );

    return this.marketAgentModel.updateByIdentifier(identifier, {
      title: localAgent.title,
      description: localAgent.description,
      avatar: localAgent.avatar,
      backgroundColor: localAgent.backgroundColor,
      tags: localAgent.tags,
      systemRole: localAgent.systemRole,
      model: localAgent.model,
      provider: localAgent.provider,
      plugins: localAgent.plugins,
      skills: agentSkillIds,
      knowledgeBases: knowledgeBaseIds,
      chatConfig: localAgent.chatConfig,
      fewShots: localAgent.fewShots,
      openingMessage: localAgent.openingMessage,
      openingQuestions: localAgent.openingQuestions,
      editorData: localAgent.editorData,
      pluginCount: new Set([...(localAgent.plugins || []), ...agentSkillIds]).size,
      knowledgeCount: knowledgeBaseIds.length,
    });
  };

  private _updateInstalledAgent = async (identifier: string) => {
    const marketAgent = await this.marketAgentModel.getDetail(identifier);
    if (!marketAgent) throw new Error('Market agent not found');

    const [localAgent] = await this.db
      .select()
      .from(agents)
      .where(
        and(eq(agents.installedFromMarketIdentifier, identifier), eq(agents.userId, this.userId)),
      )
      .limit(1);

    if (!localAgent) throw new Error('Installed agent not found');

    const snapshot = {
      title: marketAgent.title,
      description: marketAgent.description,
      systemRole: marketAgent.systemRole,
      model: marketAgent.model,
      provider: marketAgent.provider,
      plugins: marketAgent.plugins,
      skills: marketAgent.skills,
      chatConfig: marketAgent.chatConfig,
      fewShots: marketAgent.fewShots,
      openingMessage: marketAgent.openingMessage,
      openingQuestions: marketAgent.openingQuestions,
    };

    await this.agentModel.update(localAgent.id, {
      title: marketAgent.title,
      description: marketAgent.description,
      avatar: marketAgent.avatar,
      backgroundColor: marketAgent.backgroundColor,
      tags: marketAgent.tags,
      systemRole: marketAgent.systemRole,
      model: marketAgent.model,
      provider: marketAgent.provider,
      plugins: marketAgent.plugins,
      skills: marketAgent.skills || [],
      chatConfig: marketAgent.chatConfig,
      fewShots: marketAgent.fewShots,
      openingMessage: marketAgent.openingMessage,
      openingQuestions: marketAgent.openingQuestions,
      editorData: marketAgent.editorData,
      installedFromSnapshot: snapshot,
      installedMarketVersion: marketAgent.version,
    });

    for (const skillIdentifier of marketAgent.skills || []) {
      const marketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
      if (!marketSkill) continue;

      const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
      const zipFileHash = await this.buildAndStoreMarketSkillZip({
        content: marketSkill.content,
        manifest: marketSkill.manifest,
        resources: marketSkill.resources as Record<string, unknown> | null | undefined,
      });

      if (localSkill) {
        await this.agentSkillModel.update(localSkill.id, {
          name: marketSkill.name,
          description: marketSkill.description,
          manifest: marketSkill.manifest,
          content: marketSkill.content,
          resources: marketSkill.resources,
          zipFileHash,
          installedFromSnapshot: {
            name: marketSkill.name,
            description: marketSkill.description,
            manifest: marketSkill.manifest,
            content: marketSkill.content,
          },
          installedMarketVersion: marketSkill.version,
        });
      } else {
        await this.agentSkillModel.create({
          identifier: skillIdentifier,
          name: marketSkill.name,
          description: marketSkill.description,
          source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
          manifest: marketSkill.manifest,
          content: marketSkill.content,
          resources: marketSkill.resources,
          zipFileHash,
          installedFromMarketIdentifier: skillIdentifier,
          installedFromSnapshot: {
            name: marketSkill.name,
            description: marketSkill.description,
            manifest: marketSkill.manifest,
          },
          installedMarketVersion: marketSkill.version,
        });
      }
    }

    for (const mcpIdentifier of marketAgent.plugins || []) {
      const marketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
      if (!marketMcp) continue;

      await this.db
        .update(userInstalledPlugins)
        .set({
          manifest: marketMcp.manifest,
          customParams: marketMcp.customParams,
          installedFromSnapshot: {
            manifest: marketMcp.manifest,
            customParams: marketMcp.customParams,
          },
          installedMarketVersion: marketMcp.version,
        })
        .where(
          and(
            eq(userInstalledPlugins.userId, this.userId),
            eq(userInstalledPlugins.identifier, mcpIdentifier),
          ),
        );
    }

    for (const kbIdentifier of marketAgent.knowledgeBases || []) {
      const [existingKb] = await this.db
        .select()
        .from(knowledgeBases)
        .where(
          and(
            eq(knowledgeBases.installedFromMarketIdentifier, kbIdentifier),
            eq(knowledgeBases.userId, this.userId),
          ),
        )
        .limit(1);

      if (existingKb) {
        await this.knowledgeBaseMarketService.replaceLocalFromMarket(kbIdentifier);
        await this.agentModel.createAgentKnowledgeBase(localAgent.id, existingKb.id, true);
      } else {
        const localKb = await this.knowledgeBaseMarketService.installMarketToLocal(kbIdentifier);
        await this.agentModel.createAgentKnowledgeBase(localAgent.id, localKb.id, true);
      }
    }

    return { success: true };
  };

  private _publishKnowledgeBase = async (knowledgeBaseId: string, newDisplayName?: string) => {
    const localKb = await this.knowledgeBaseModel.findById(knowledgeBaseId);
    if (!localKb) throw new Error('Knowledge base not found');

    const identifier = localKb.id;
    const displayName = (newDisplayName ?? localKb.name).trim();
    if (!displayName) throw new Error('Knowledge base name is required');

    const marketById = await this.marketKnowledgeBaseModel.findByIdentifier(identifier);

    if (localKb.marketIdentifier) {
      const published = await this.marketKnowledgeBaseModel.findByIdentifier(
        localKb.marketIdentifier,
      );
      if (published?.publisherId === this.userId) {
        if (newDisplayName) {
          await this.knowledgeBaseModel.update(knowledgeBaseId, { name: displayName });
        }
        if (published.deletedAt) {
          return this._relistWithLocalSync('knowledgeBase', localKb.marketIdentifier, {
            displayName: newDisplayName,
          });
        }
        if (published.visibility === 'public') {
          return this._updateKnowledgeBase(localKb.marketIdentifier);
        }
      }
    }

    if (marketById?.publisherId === this.userId && marketById.visibility === 'bundled') {
      await this.assertPublishNameAvailable('knowledgeBase', displayName, identifier);
      await this.marketKnowledgeBaseModel.makePublic(identifier);
      if (newDisplayName) {
        await this.knowledgeBaseModel.update(knowledgeBaseId, { name: displayName });
      }
      return this.knowledgeBaseMarketService.snapshotLocalToMarket(knowledgeBaseId, 'public');
    }

    await this.assertPublishNameAvailable('knowledgeBase', displayName, identifier);
    if (newDisplayName) {
      await this.knowledgeBaseModel.update(knowledgeBaseId, { name: displayName });
    }
    return this.knowledgeBaseMarketService.snapshotLocalToMarket(knowledgeBaseId, 'public');
  };

  private _updateKnowledgeBase = async (identifier: string) => {
    const localKb = await this.knowledgeBaseModel.findById(identifier);
    if (!localKb) throw new Error('Local knowledge base not found for this market identifier');

    return this.knowledgeBaseMarketService.snapshotLocalToMarket(
      identifier,
      (await this.marketKnowledgeBaseModel.findByIdentifier(identifier))?.visibility === 'public'
        ? 'public'
        : 'bundled',
    );
  };

  private _installKnowledgeBase = async (identifier: string) => {
    const localKb = await this.knowledgeBaseMarketService.installMarketToLocal(identifier);
    await this.marketKnowledgeBaseModel.incrementInstallCount(identifier);
    return localKb;
  };

  private _updateInstalledKnowledgeBase = async (identifier: string) => {
    return this.knowledgeBaseMarketService.replaceLocalFromMarket(identifier);
  };

  private async _relistWithLocalSync(
    type: 'agent' | 'skill' | 'mcp' | 'knowledgeBase',
    marketIdentifier: string,
    options?: { category?: string; displayName?: string },
  ) {
    const publishCategory =
      options?.category && type !== 'knowledgeBase'
        ? assertPublishCategory(type, options.category)
        : undefined;

    if (type === 'agent') {
      const [localAgent] = await this.db
        .select()
        .from(agents)
        .where(and(eq(agents.marketIdentifier, marketIdentifier), eq(agents.userId, this.userId)))
        .limit(1);

      if (!localAgent) throw new Error('Local agent not found');

      if (options?.displayName) {
        await this.agentModel.update(localAgent.id, { title: options.displayName.trim() });
      }

      await this._updateAgent(marketIdentifier);

      if (publishCategory) {
        await this.marketAgentModel.updateByIdentifier(marketIdentifier, {
          category: publishCategory,
        });
      }

      return this.marketAgentModel.relist(marketIdentifier);
    }

    if (type === 'skill') {
      const [localSkill] = await this.db
        .select()
        .from(agentSkills)
        .where(
          and(
            eq(agentSkills.marketIdentifier, marketIdentifier),
            eq(agentSkills.userId, this.userId),
          ),
        )
        .limit(1);

      if (!localSkill) throw new Error('Local skill not found');

      if (options?.displayName) {
        const displayName = options.displayName.trim();
        await this.agentSkillModel.update(localSkill.id, {
          manifest: { ...localSkill.manifest, name: displayName },
          name: displayName,
        });
      }

      await this._updateSkill(marketIdentifier);

      if (publishCategory) {
        await this.marketSkillModel.updateByIdentifier(marketIdentifier, {
          category: publishCategory,
        });
      }

      return this.marketSkillModel.relist(marketIdentifier);
    }

    if (type === 'mcp') {
      const [localMcp] = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(
            eq(userInstalledPlugins.marketIdentifier, marketIdentifier),
            eq(userInstalledPlugins.userId, this.userId),
          ),
        )
        .limit(1);

      if (!localMcp) throw new Error('Local MCP not found');

      let manifest = (localMcp.manifest || {}) as McpManifest;
      const customParams = (localMcp.customParams || {}) as McpCustomParams;

      if (options?.displayName) {
        manifest = {
          ...manifest,
          meta: { ...manifest.meta, title: options.displayName.trim() },
        };
        await this.db
          .update(userInstalledPlugins)
          .set({ manifest: manifest as any, updatedAt: new Date() })
          .where(
            and(
              eq(userInstalledPlugins.userId, this.userId),
              eq(userInstalledPlugins.identifier, localMcp.identifier),
            ),
          );
      }

      await this._updateMcp(marketIdentifier, manifest, customParams);

      if (publishCategory) {
        await this.marketMcpModel.updateByIdentifier(marketIdentifier, {
          category: publishCategory,
        });
      }

      return this.marketMcpModel.relist(marketIdentifier);
    }

    if (options?.displayName) {
      await this.knowledgeBaseModel.update(marketIdentifier, { name: options.displayName.trim() });
    }

    await this._updateKnowledgeBase(marketIdentifier);
    return this.marketKnowledgeBaseModel.relist(marketIdentifier);
  }
}
