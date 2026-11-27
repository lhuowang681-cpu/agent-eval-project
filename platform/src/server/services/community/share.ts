import type { LobeChatDatabase } from '@lobechat/database';
import { userInstalledPlugins } from '@lobechat/database/schemas';
import type { CustomPluginParams } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { MarketAgentModel } from '@/database/models/marketAgent';
import { MarketMcpModel } from '@/database/models/marketMcp';
import { MarketSkillModel } from '@/database/models/marketSkill';
import { ShareModel } from '@/database/models/share';
import { createNanoId } from '@/database/utils/idGenerator';
import { KnowledgeBaseMarketService } from '@/server/services/community/knowledgeBaseMarket';
import { MarketAvatarService } from '@/server/services/community/marketAvatar';
import {
  resolveMcpMarketIcon,
  resolveSkillMarketIcon,
} from '@/server/services/community/marketIcon';
import {
  extractMcpCapabilities,
  type McpManifestLike,
} from '@/server/services/community/mcpCapabilities';
import {
  getMcpConnectionType,
  sanitizeMcpCustomParamsForMarket,
} from '@/server/services/community/mcpCustomParams';

export interface ShareServiceOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

const generateToken = () => createNanoId(21)();

export class ShareService {
  protected db: LobeChatDatabase;
  protected userId: string;
  protected agentModel: AgentModel;
  protected agentSkillModel: AgentSkillModel;
  protected marketAgentModel: MarketAgentModel;
  protected marketSkillModel: MarketSkillModel;
  protected marketMcpModel: MarketMcpModel;
  protected shareModel: ShareModel;
  protected marketAvatarService: MarketAvatarService;
  protected knowledgeBaseMarketService: KnowledgeBaseMarketService;

  constructor(options: ShareServiceOptions) {
    this.db = options.serverDB;
    this.userId = options.userId;
    this.agentModel = new AgentModel(this.db, this.userId);
    this.agentSkillModel = new AgentSkillModel(this.db, this.userId);
    this.marketAgentModel = new MarketAgentModel(this.db, this.userId);
    this.marketSkillModel = new MarketSkillModel(this.db, this.userId);
    this.marketMcpModel = new MarketMcpModel(this.db, this.userId);
    this.shareModel = new ShareModel(this.db, this.userId);
    this.marketAvatarService = new MarketAvatarService(this.db, this.userId);
    this.knowledgeBaseMarketService = new KnowledgeBaseMarketService(this.db, this.userId);
  }

  createShare = async (input: {
    itemType: 'agent' | 'mcp' | 'skill';
    localId: string;
  }): Promise<{ marketIdentifier: string; token: string; url: string }> => {
    if (input.itemType === 'skill') return this.createSkillShare(input.localId);
    if (input.itemType === 'mcp') return this.createMcpShare(input.localId);
    return this.createAgentShare(input.localId);
  };

  protected createSkillShare = async (skillIdentifier: string) => {
    const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
    if (!localSkill) throw new TRPCError({ code: 'NOT_FOUND', message: 'SKILL_NOT_FOUND' });

    const identifier = localSkill.identifier || `skl_${createNanoId(8)()}`;
    const name = localSkill.name;
    const manifest = { ...(localSkill.manifest as Record<string, unknown>), name };

    // Reuse an existing market record when one already exists for this
    // identifier (e.g. a prior share, or a bundled/public copy). Creating a
    // second row would trip the `marketSkills_identifier_unique` index → 500.
    // Per spec §6, re-sharing the same item is allowed and yields a new token
    // bound to the same market record.
    const existing = await this.marketSkillModel.findByIdentifier(identifier);
    const marketIdentifier = existing
      ? existing.identifier
      : (
          await this.marketSkillModel.create({
            identifier,
            name,
            description: localSkill.description ?? '',
            icon: resolveSkillMarketIcon(manifest, undefined),
            category: null,
            tags: (localSkill.manifest as { tags?: string[] } | null | undefined)?.tags || [],
            content: localSkill.content,
            manifest: manifest as any,
            resources: localSkill.resources as any,
            editorData: localSkill.editorData as any,
            resourcesCount: Object.keys(localSkill.resources || {}).length,
            visibility: 'unlisted',
          })
        ).identifier;

    return this.recordShare('skill', marketIdentifier, name);
  };

  protected createMcpShare = async (identifier: string) => {
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

    if (!localMcp?.manifest) throw new TRPCError({ code: 'NOT_FOUND', message: 'MCP_NOT_FOUND' });

    const manifest = localMcp.manifest as McpManifestLike;
    const customParams = (localMcp.customParams || {}) as CustomPluginParams;
    const displayName = manifest.meta?.title || identifier;
    const normalizedManifest: McpManifestLike = {
      ...manifest,
      meta: { ...manifest.meta, title: displayName },
    };
    const extracted = extractMcpCapabilities(normalizedManifest);
    const marketCustomParams = sanitizeMcpCustomParamsForMarket(customParams as any);

    // Reuse an existing market record when one already exists for this
    // identifier (e.g. a prior share). Creating a second row would trip the
    // `marketMcps_identifier_unique` index → 500. Per spec §6, re-sharing the
    // same item is allowed and yields a new token bound to the same record.
    const existing = await this.marketMcpModel.findByIdentifier(identifier);
    const marketIdentifier = existing
      ? existing.identifier
      : (
          await this.marketMcpModel.create({
            identifier,
            name: displayName,
            description: manifest.meta?.description,
            icon: resolveMcpMarketIcon(normalizedManifest as any, undefined),
            category: null,
            tags: manifest.meta?.tags || [],
            overview: manifest.meta?.readme,
            connectionType: getMcpConnectionType(customParams as any),
            manifest: normalizedManifest as any,
            customParams: marketCustomParams as any,
            capabilities: extracted.capabilities,
            toolsCount: extracted.toolsCount,
            promptsCount: extracted.promptsCount,
            resourcesCount: extracted.resourcesCount,
            visibility: 'unlisted',
          })
        ).identifier;

    return this.recordShare('mcp', marketIdentifier, displayName);
  };

  protected recordShare = async (
    itemType: 'agent' | 'mcp' | 'skill',
    marketIdentifier: string,
    name: string,
  ) => {
    const token = generateToken();
    const share = await this.shareModel.create({
      token,
      ownerId: this.userId,
      itemType,
      marketIdentifier,
      name,
    });
    const resolvedToken = share?.token ?? token;
    return { token: resolvedToken, url: `/share/${resolvedToken}`, marketIdentifier };
  };

  protected createAgentShare = async (agentId: string) => {
    const localAgent = await this.agentModel.getAgentConfigById(agentId);
    if (!localAgent) throw new TRPCError({ code: 'NOT_FOUND', message: 'AGENT_NOT_FOUND' });
    if (!localAgent.title || !localAgent.systemRole) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'TITLE_AND_SYSTEMROLE_REQUIRED' });
    }

    const identifier = `agt_${createNanoId(8)()}`;

    // 内置 skill identifier（plugins 里属于本地 skill 的也算 skill）
    const skillIds = new Set<string>(localAgent.skills || []);
    for (const id of localAgent.plugins || []) {
      if (skillIds.has(id)) continue;
      const localSkill = await this.agentSkillModel.findByIdentifier(id);
      if (localSkill) skillIds.add(id);
    }
    const agentSkillIds = [...skillIds];

    // 为每个内置 skill 建 unlisted 副本（若市场已有同 id 记录则跳过，避免唯一索引冲突）
    for (const skillIdentifier of agentSkillIds) {
      const existing = await this.marketSkillModel.findByIdentifier(skillIdentifier);
      if (existing) continue;
      const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
      if (!localSkill) continue;
      const manifest = {
        ...(localSkill.manifest as Record<string, unknown>),
        name: localSkill.name,
      };
      await this.marketSkillModel.create({
        identifier: skillIdentifier,
        name: localSkill.name,
        description: localSkill.description ?? '',
        icon: resolveSkillMarketIcon(manifest, undefined),
        category: null,
        tags: (localSkill.manifest as { tags?: string[] } | null | undefined)?.tags || [],
        content: localSkill.content,
        manifest,
        resources: localSkill.resources,
        editorData: localSkill.editorData,
        resourcesCount: Object.keys(localSkill.resources || {}).length,
        visibility: 'unlisted',
      } as any);
    }

    // 为每个内置 mcp 建 unlisted 副本（排除已识别为 skill 的 identifier，
    // 避免拿 skill id 去查 userInstalledPlugins 做无意义查询）
    const mcpIdentifiers = (localAgent.plugins || []).filter((id) => !agentSkillIds.includes(id));
    for (const mcpIdentifier of mcpIdentifiers) {
      const existing = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
      if (existing) continue;
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
      const manifest = localMcp.manifest as McpManifestLike;
      const customParams = (localMcp.customParams || {}) as CustomPluginParams;
      const displayName = manifest.meta?.title || mcpIdentifier;
      const normalizedManifest: McpManifestLike = {
        ...manifest,
        meta: { ...manifest.meta, title: displayName },
      };
      const extracted = extractMcpCapabilities(normalizedManifest);
      await this.marketMcpModel.create({
        identifier: mcpIdentifier,
        name: displayName,
        description: normalizedManifest.meta?.description,
        icon: resolveMcpMarketIcon(normalizedManifest as any, undefined),
        category: null,
        tags: normalizedManifest.meta?.tags || [],
        overview: normalizedManifest.meta?.readme,
        connectionType: getMcpConnectionType(customParams as any),
        manifest: normalizedManifest as any,
        customParams: sanitizeMcpCustomParamsForMarket(customParams as any),
        capabilities: extracted.capabilities,
        toolsCount: extracted.toolsCount,
        promptsCount: extracted.promptsCount,
        resourcesCount: extracted.resourcesCount,
        visibility: 'unlisted',
      } as any);
    }

    // 为每个内置知识库建 bundled 市场副本（已有则复用），让安装方经
    // installAgent 的 KB 级联（installMarketToLocal）装到本地。market KB
    // identifier 即本地 KB id，与 snapshotLocalToMarket 内部一致。
    const knowledgeBaseIds = ((localAgent as any).knowledgeBases || [])
      .map((kb: { id?: string }) => kb?.id)
      .filter(Boolean) as string[];
    for (const kbId of knowledgeBaseIds) {
      await this.knowledgeBaseMarketService.snapshotLocalToMarket(kbId, 'bundled');
    }

    const marketAgent = await this.marketAgentModel.create({
      identifier,
      title: localAgent.title,
      description: localAgent.description,
      avatar: localAgent.avatar,
      backgroundColor: localAgent.backgroundColor,
      category: null,
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
      visibility: 'unlisted',
    } as any);

    return this.recordShare('agent', marketAgent.identifier, localAgent.title);
  };

  getByToken = async (
    token: string,
  ): Promise<{
    itemType: 'skill' | 'mcp' | 'agent';
    marketIdentifier: string;
    name: string | null;
  }> => {
    const row = await this.shareModel.findByToken(token);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'SHARE_NOT_FOUND' });
    if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      throw new TRPCError({ code: 'CONFLICT', message: 'SHARE_EXPIRED_OR_REVOKED' });
    }
    await this.shareModel.incrementViewCount(token).catch(() => undefined);
    return {
      itemType: row.itemType as 'skill' | 'mcp' | 'agent',
      marketIdentifier: row.marketIdentifier,
      name: row.name,
    };
  };

  revoke = async (token: string): Promise<void> => {
    const row = await this.shareModel.findByToken(token);
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'SHARE_NOT_FOUND' });
    if (row.ownerId !== this.userId)
      throw new TRPCError({ code: 'FORBIDDEN', message: 'FORBIDDEN' });
    await this.shareModel.setRevoked(token);
    await this.reclaimOrphanedShareRecord(row.itemType, row.marketIdentifier);
  };

  /**
   * A share can point at a purpose-built 'unlisted' market record — e.g. the
   * `agt_*` row minted by createAgentShare, which never surfaces in the public
   * market yet lingers in the publisher's resource states. Once the last active
   * share for that record is revoked, the row has no remaining purpose, so drop
   * it. Real listings (public/bundled) and records still backing another active
   * share are left untouched (deleteUnlistedByIdentifier's visibility guard +
   * the active-count check).
   */
  protected reclaimOrphanedShareRecord = async (itemType: string, marketIdentifier: string) => {
    const remaining = await this.shareModel.countActiveByMarketIdentifier(
      itemType,
      marketIdentifier,
    );
    if (remaining > 0) return;

    if (itemType === 'agent') {
      await this.marketAgentModel.deleteUnlistedByIdentifier(marketIdentifier);
    } else if (itemType === 'skill') {
      await this.marketSkillModel.deleteUnlistedByIdentifier(marketIdentifier);
    } else if (itemType === 'mcp') {
      await this.marketMcpModel.deleteUnlistedByIdentifier(marketIdentifier);
    }
  };

  myShares = async () => this.shareModel.findMyList();

  recordInstall = async (token: string): Promise<void> => {
    await this.shareModel.incrementInstallCount(token).catch(() => undefined);
  };
}
