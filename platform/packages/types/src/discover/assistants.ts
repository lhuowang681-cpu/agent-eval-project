import type { FewShots } from '../llm';
import type { MetaData } from '../meta';
import type { LobeAgentSettings } from '../session';

export enum AssistantCategory {
  All = 'all',
  Coding = 'coding',
  DataAnalytics = 'data-analytics',
  Designer = 'designer',
  HrFinance = 'hr-finance',
  Marketing = 'marketing',
  NewMedia = 'new-media',
  Other = 'other',
  ProductManager = 'product-manager',
  UserResearch = 'user-research',
}

export enum AssistantSorts {
  HaveSkills = 'haveSkills',
  MostUsage = 'mostUsage',
  Recommended = 'recommended',
  UpdatedAt = 'updatedAt',
}

export enum AssistantNavKey {
  Capabilities = 'capabilities',
  Overview = 'overview',
  Related = 'related',
  SystemRole = 'systemRole',
  Version = 'version',
}

export type AgentStatus = 'published' | 'unpublished' | 'archived' | 'deprecated';

export type AgentType = 'agent' | 'agent-group';

export interface DiscoverAssistantItem extends Omit<LobeAgentSettings, 'meta'>, MetaData {
  author: string;
  category?: AssistantCategory;
  createdAt: string;
  /** Date when the assistant was delisted (soft deleted) */
  deletedAt?: Date | string;
  /**
   * Fork count - number of times this agent has been forked
   */
  forkCount?: number;
  /**
   * Forked from agent ID - ID of the source agent if this is a fork
   * null means this is an original agent
   */
  forkedFromAgentId?: number | null;
  homepage: string;
  identifier: string;
  installCount?: number;
  isValidated?: boolean;
  knowledgeCount: number;
  pluginCount: number;
  /** Publisher's user ID, used to show "Mine" tag on list items */
  publisherId?: string;
  status?: AgentStatus;
  tokenUsage: number;
  type?: AgentType;
  updatedAt?: string;
  usageCount?: number;
  userName?: string;
}

export type AssistantMarketSource = 'legacy' | 'new';

export interface AssistantQueryParams {
  category?: string;
  haveSkills?: boolean;
  includeAgentGroup?: boolean;
  locale?: string;
  order?: 'asc' | 'desc';
  ownerId?: string;
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: AssistantSorts;
  source?: AssistantMarketSource;
}

export interface AssistantListResponse {
  currentPage: number;
  items: DiscoverAssistantItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export type AgentCapabilityKind = 'mcp' | 'skill';

export interface AgentCapabilityItem {
  avatar?: string | null;
  description?: string;
  identifier: string;
  kind: AgentCapabilityKind;
  name: string;
  visibility: 'bundled' | 'public';
}

export interface DiscoverAssistantDetail extends DiscoverAssistantItem {
  capabilities?: AgentCapabilityItem[];
  currentVersion?: string;
  /** Date when the assistant was delisted (soft deleted) */
  deletedAt?: Date | string;
  editorData?: any;
  examples?: FewShots;
  isValidated?: boolean;
  /** Publisher's user ID, used to determine if current user is the publisher */
  publisherId?: string;
  related: DiscoverAssistantItem[];
  summary?: string;
  versions?: DiscoverAssistantVersion[];
}

export interface DiscoverAssistantVersion {
  createdAt?: string;
  isLatest?: boolean;
  isValidated?: boolean;
  status?: AgentStatus;
  version: string;
}
