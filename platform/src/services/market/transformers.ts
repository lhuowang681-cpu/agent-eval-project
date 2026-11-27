import type { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';
import {
  type AgentCapabilityItem,
  AssistantCategory,
  type AssistantListResponse,
  AssistantSorts,
  type DiscoverAssistantDetail,
  type DiscoverAssistantItem,
  type DiscoverKnowledgeBaseDetail,
  type DiscoverMcpDetail,
  type DiscoverSkillDetail,
  type KnowledgeBaseListResponse,
  KnowledgeBaseSorts,
  type McpListResponse,
  McpSorts,
  type SkillListResponse,
  SkillSorts,
} from '@/types/discover';

type MarketListResult<T> = { data: T[]; total: number };

type MarketAgentRow = {
  avatar?: string | null;
  backgroundColor?: string | null;
  category?: string | null;
  chatConfig?: LobeAgentChatConfig | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
  description?: string | null;
  editorData?: unknown;
  fewShots?: unknown;
  identifier: string;
  installCount?: number | null;
  knowledgeBases?: string[] | null;
  knowledgeCount?: number | null;
  model?: string | null;
  openingMessage?: string | null;
  openingQuestions?: string[] | null;
  pluginCount?: number | null;
  plugins?: string[] | null;
  provider?: string | null;
  publisherId?: string;
  publisherName?: string | null;
  publisherUsername?: string | null;
  skills?: string[] | null;
  status?: string | null;
  systemRole?: string | null;
  tags?: string[] | null;
  title?: string | null;
  tokenUsage?: number | null;
  updatedAt?: Date | string | null;
  usageCount?: number | null;
  version?: number | null;
  capabilities?: AgentCapabilityItem[];
};

type MarketSkillRow = {
  category?: string | null;
  content?: string | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
  description?: string | null;
  editorData?: unknown;
  icon?: string | null;
  identifier: string;
  installCount?: number | null;
  manifest?: Record<string, unknown>;
  name: string;
  publisherId?: string;
  publisherName?: string | null;
  publisherUsername?: string | null;
  resources?: Record<string, unknown> | null;
  resourcesCount?: number | null;
  status?: string | null;
  tags?: string[] | null;
  updatedAt?: Date | string | null;
  usageCount?: number | null;
  version?: string | null;
  visibility?: string | null;
};

type MarketMcpRow = {
  capabilities?: Record<string, boolean> | null;
  category?: string | null;
  connectionType?: string | null;
  createdAt?: Date | string | null;
  customParams?: Record<string, unknown> | null;
  deletedAt?: Date | string | null;
  description?: string | null;
  icon?: string | null;
  identifier: string;
  installCount?: number | null;
  manifest?: Record<string, unknown> | null;
  name?: string | null;
  overview?: string | null;
  promptsCount?: number | null;
  publisherId?: string;
  publisherName?: string | null;
  publisherUsername?: string | null;
  resourcesCount?: number | null;
  status?: string | null;
  tags?: string[] | null;
  toolsCount?: number | null;
  updatedAt?: Date | string | null;
  usageCount?: number | null;
  version?: string | null;
  visibility?: string | null;
};

type MarketKnowledgeBaseRow = {
  avatar?: string | null;
  chunkCount?: number | null;
  createdAt?: Date | string | null;
  deletedAt?: Date | string | null;
  description?: string | null;
  documentCount?: number | null;
  fileCount?: number | null;
  identifier: string;
  installCount?: number | null;
  name: string;
  publisherId?: string;
  publisherName?: string | null;
  settings?: Record<string, unknown> | null;
  status?: string | null;
  type?: string | null;
  updatedAt?: Date | string | null;
  version?: number | null;
  visibility?: string | null;
};

const toIsoString = (value?: Date | string | null) => {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
};

export const mapAssistantSort = (
  sort?: AssistantSorts,
): 'recommended' | 'installCount' | 'updatedAt' | undefined => {
  switch (sort) {
    case AssistantSorts.MostUsage: {
      return 'installCount';
    }
    case AssistantSorts.UpdatedAt: {
      return 'updatedAt';
    }
    default: {
      return 'recommended';
    }
  }
};

export const mapSkillSort = (
  sort?: SkillSorts,
): 'recommended' | 'installCount' | 'updatedAt' | undefined => {
  switch (sort) {
    case SkillSorts.InstallCount: {
      return 'installCount';
    }
    case SkillSorts.UpdatedAt: {
      return 'updatedAt';
    }
    default: {
      return 'recommended';
    }
  }
};

export const mapMcpSort = (
  sort?: McpSorts,
): 'recommended' | 'installCount' | 'updatedAt' | 'createdAt' | undefined => {
  switch (sort) {
    case McpSorts.InstallCount: {
      return 'installCount';
    }
    case McpSorts.UpdatedAt: {
      return 'updatedAt';
    }
    case McpSorts.CreatedAt: {
      return 'createdAt';
    }
    default: {
      return 'recommended';
    }
  }
};

export const mapKnowledgeBaseSort = (
  sort?: KnowledgeBaseSorts,
): 'recommended' | 'installCount' | 'updatedAt' | undefined => {
  switch (sort) {
    case KnowledgeBaseSorts.InstallCount: {
      return 'installCount';
    }
    case KnowledgeBaseSorts.UpdatedAt: {
      return 'updatedAt';
    }
    default: {
      return 'recommended';
    }
  }
};

const buildAgentConfig = (row: MarketAgentRow): LobeAgentConfig =>
  ({
    chatConfig: {
      autoCreateTopicThreshold: 2,
      ...((row.chatConfig || {}) as Record<string, unknown>),
    } as LobeAgentConfig['chatConfig'],
    fewShots: Array.isArray(row.fewShots) ? row.fewShots : undefined,
    knowledgeBases: (row.knowledgeBases || []).map((id) => ({ id })),
    model: row.model || 'gpt-4o-mini',
    openingMessage: row.openingMessage || undefined,
    openingQuestions: row.openingQuestions || [],
    params: {},
    plugins: row.plugins || [],
    provider: row.provider || 'openai',
    skills: row.skills || [],
    systemRole: row.systemRole || '',
    tts: {
      sttLocale: 'auto',
      ttsService: 'openai',
      voice: { openai: 'alloy' },
    },
  }) as LobeAgentConfig;

export const transformMarketAgentToItem = (row: MarketAgentRow): DiscoverAssistantItem => ({
  author: row.publisherName || row.publisherId || 'Community',
  avatar: row.avatar || '',
  backgroundColor: row.backgroundColor || undefined,
  category: (row.category as AssistantCategory) || AssistantCategory.Other,
  config: buildAgentConfig(row),
  createdAt: toIsoString(row.createdAt),
  description: row.description || '',
  homepage: `/community/agent/${row.identifier}`,
  identifier: row.identifier,
  installCount: row.installCount || 0,
  usageCount: row.usageCount || 0,
  knowledgeCount: row.knowledgeCount || row.knowledgeBases?.length || 0,
  pluginCount:
    new Set([...(row.plugins || []), ...(row.skills || [])]).size || row.pluginCount || 0,
  deletedAt: row.deletedAt || undefined,
  publisherId: row.publisherId,
  status: (row.status as DiscoverAssistantItem['status']) || 'published',
  tags: row.tags || [],
  title: row.title || row.identifier,
  tokenUsage: row.tokenUsage || 0,
  updatedAt: toIsoString(row.updatedAt),
  userName: row.publisherUsername || undefined,
});

export const transformMarketAgentToDetail = (row: MarketAgentRow): DiscoverAssistantDetail => ({
  ...transformMarketAgentToItem(row),
  capabilities: row.capabilities,
  config: buildAgentConfig(row),
  currentVersion: String(row.version || 1),
  deletedAt: row.deletedAt || undefined,
  editorData: row.editorData as DiscoverAssistantDetail['editorData'],
  examples: Array.isArray(row.fewShots) ? row.fewShots : undefined,
  publisherId: row.publisherId,
  related: [],
  versions: [
    {
      isLatest: true,
      status: (row.status as DiscoverAssistantDetail['status']) || 'published',
      version: String(row.version || 1),
    },
  ],
});

export const transformAssistantListResponse = (
  result: MarketListResult<MarketAgentRow>,
  page: number,
  pageSize: number,
): AssistantListResponse => ({
  currentPage: page,
  items: result.data.map(transformMarketAgentToItem),
  pageSize,
  totalCount: result.total,
  totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
});

export const transformMarketSkillToItem = (row: MarketSkillRow) => ({
  author: row.publisherName || row.publisherId || 'Community',
  category: row.category || undefined,
  createdAt: toIsoString(row.createdAt),
  description: row.description || '',
  homepage: `/community/skill/${row.identifier}`,
  icon: row.icon || undefined,
  deletedAt: row.deletedAt || undefined,
  identifier: row.identifier,
  installCount: row.installCount || 0,
  name: row.name,
  publisherId: row.publisherId,
  updatedAt: toIsoString(row.updatedAt),
  usageCount: row.usageCount || 0,
  userName: row.publisherUsername || undefined,
  version: row.version || '1.0.0',
});

export const transformMarketSkillToDetail = (row: MarketSkillRow): DiscoverSkillDetail =>
  ({
    ...transformMarketSkillToItem(row),
    author: {
      name: row.publisherName || row.publisherId || 'Community',
    },
    userName: row.publisherUsername || undefined,
    content: row.content || '',
    deletedAt: row.deletedAt || undefined,
    editorData: row.editorData,
    manifest: row.manifest || {},
    publisherId: row.publisherId,
    related: [],
    resources: row.resources || {},
    resourcesCount: row.resourcesCount || 0,
    tags: row.tags || [],
    visibility: row.visibility || 'public',
  }) as unknown as DiscoverSkillDetail;

export const transformSkillListResponse = (
  result: MarketListResult<MarketSkillRow>,
  page: number,
  pageSize: number,
): SkillListResponse =>
  ({
    currentPage: page,
    items: result.data.map(transformMarketSkillToItem),
    pageSize,
    totalCount: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
  }) as unknown as SkillListResponse;

export const transformMarketMcpToItem = (row: MarketMcpRow) => ({
  author: row.publisherName || row.publisherId || 'Community',
  category: row.category || undefined,
  connectionType: row.connectionType || 'http',
  createdAt: toIsoString(row.createdAt),
  deletedAt: row.deletedAt || undefined,
  description: row.description || '',
  homepage: `/community/mcp/${row.identifier}`,
  icon: row.icon || undefined,
  identifier: row.identifier,
  installCount: row.installCount || 0,
  name: row.name || row.identifier,
  publisherId: row.publisherId,
  title: row.name || row.identifier,
  updatedAt: toIsoString(row.updatedAt),
  usageCount: row.usageCount || 0,
  userName: row.publisherUsername || undefined,
  version: row.version || '1.0.0',
});

/**
 * Build deploymentOptions from customParams.mcp connection config
 * This converts the local MCP connection data into the DeploymentOption format
 * expected by PluginItemDetail interface
 */
const buildDeploymentOptions = (customParams?: Record<string, unknown> | null) => {
  const mcp =
    (customParams?.mcp as Record<string, unknown> | undefined) ??
    (customParams?.mcpServers && typeof customParams.mcpServers === 'object'
      ? Object.values(customParams.mcpServers as Record<string, Record<string, unknown>>).find(
          (server) => server && typeof server === 'object',
        )
      : undefined);

  if (!mcp) return undefined;

  const connectionType =
    (mcp.type as string) || (mcp.command ? 'stdio' : mcp.url ? 'http' : 'http');
  const connection: Record<string, unknown> = { type: connectionType };

  if (connectionType === 'stdio') {
    if (mcp.command) connection.command = mcp.command;
    if (mcp.args) connection.args = mcp.args;
    if (mcp.env) connection.env = mcp.env;
  } else if (connectionType === 'http' || connectionType === 'streamable') {
    if (mcp.url) connection.url = mcp.url;
    if (mcp.auth) connection.auth = mcp.auth;
    if (mcp.headers) connection.headers = mcp.headers;
  }

  return [
    {
      connection,
      installationMethod: connectionType === 'stdio' ? 'npm' : 'remote',
      isRecommended: true,
    },
  ];
};

/**
 * Convert old-format LobeChatPluginManifest api array to PluginTool format
 * The 'api' array stores tool definitions in a different schema
 */
const convertApiToTools = (api: unknown[]): unknown[] => {
  if (!Array.isArray(api)) return [];
  return api.map((item) => {
    const tool = item as Record<string, unknown>;
    return {
      description: tool.description || '',
      inputSchema: tool.parameters || {},
      name: tool.name || '',
    };
  });
};

export const transformMarketMcpToDetail = (row: MarketMcpRow): DiscoverMcpDetail => {
  const manifest = (row.manifest || {}) as Record<string, unknown>;
  const mcpManifest = (manifest.mcp ?? manifest) as Record<string, unknown>;

  // Extract tools - prefer MCP format (tools array), fall back to old api format
  let tools: unknown[] | undefined;
  if (Array.isArray(mcpManifest.tools) && mcpManifest.tools.length > 0) {
    tools = mcpManifest.tools;
  } else if (Array.isArray(manifest.api) && manifest.api.length > 0) {
    tools = convertApiToTools(manifest.api);
  }

  return {
    ...transformMarketMcpToItem(row),
    agents: [],
    author: {
      name: row.publisherName || row.publisherId || 'Community',
    },
    userName: row.publisherUsername || undefined,
    customParams: row.customParams,
    deploymentOptions: buildDeploymentOptions(row.customParams),
    deletedAt: row.deletedAt || undefined,
    manifest: row.manifest,
    overview: {
      readme: row.overview || '',
    },
    publisherId: row.publisherId,
    prompts: Array.isArray(mcpManifest.prompts) ? mcpManifest.prompts : undefined,
    related: [],
    resources: Array.isArray(mcpManifest.resources) ? mcpManifest.resources : undefined,
    schema: row.manifest,
    tools,
    toolsCount: row.toolsCount || tools?.length || 0,
    promptsCount: row.promptsCount || 0,
    resourcesCount: row.resourcesCount || 0,
    visibility: row.visibility || 'public',
  } as unknown as DiscoverMcpDetail;
};

export const transformMcpListResponse = (
  result: MarketListResult<MarketMcpRow>,
  page: number,
  pageSize: number,
): McpListResponse =>
  ({
    currentPage: page,
    items: result.data.map(transformMarketMcpToItem),
    pageSize,
    totalCount: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
  }) as unknown as McpListResponse;

export const transformMarketKnowledgeBaseToItem = (row: MarketKnowledgeBaseRow) => ({
  author: row.publisherName || row.publisherId || 'Community',
  avatar: row.avatar,
  createdAt: toIsoString(row.createdAt),
  description: row.description || '',
  deletedAt: row.deletedAt || undefined,
  documentCount: row.documentCount || 0,
  fileCount: row.fileCount || 0,
  homepage: `/community/knowledge-base/${row.identifier}`,
  identifier: row.identifier,
  installCount: row.installCount || 0,
  name: row.name,
  publisherId: row.publisherId,
  type: row.type,
  updatedAt: toIsoString(row.updatedAt),
});

export const transformMarketKnowledgeBaseToDetail = (
  row: MarketKnowledgeBaseRow,
): DiscoverKnowledgeBaseDetail =>
  ({
    ...transformMarketKnowledgeBaseToItem(row),
    chunkCount: row.chunkCount || 0,
    deletedAt: row.deletedAt || undefined,
    publisherName: row.publisherName,
    settings: row.settings,
    status: row.status,
    version: row.version,
    visibility: row.visibility,
  }) as DiscoverKnowledgeBaseDetail;

export const transformKnowledgeBaseListResponse = (
  result: MarketListResult<MarketKnowledgeBaseRow>,
  page: number,
  pageSize: number,
): KnowledgeBaseListResponse => ({
  currentPage: page,
  items: result.data.map(transformMarketKnowledgeBaseToItem),
  pageSize,
  totalCount: result.total,
  totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
});
