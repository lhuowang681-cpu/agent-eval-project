import type { PluginItem, PluginListResponse } from '@lobehub/market-sdk';
import type { PluginItemDetail } from '@lobehub/market-types';

import type { DiscoverAssistantItem } from './assistants';

export enum McpCategory {
  All = 'all',
  BusinessSystem = 'business-system',
  Coding = 'coding',
  Collaboration = 'collaboration',
  DataStorage = 'data-storage',
  DesignAssets = 'design-assets',
  InfoFetch = 'info-fetch',
  Other = 'other',
  ProjectManagement = 'project-management',
  UserFeedback = 'user-feedback',
}

export enum McpSorts {
  CreatedAt = 'createdAt',
  InstallCount = 'installCount',
  IsFeatured = 'isFeatured',
  IsValidated = 'isValidated',
  RatingCount = 'ratingCount',
  Recommended = 'recommended',
  UpdatedAt = 'updatedAt',
}

export enum McpNavKey {
  Agents = 'agents',
  Deployment = 'deployment',
  Overview = 'overview',
  Related = 'related',
  Schema = 'schema',
  Score = 'score',
  Settings = 'settings',
  Version = 'version',
}

export enum McpConnectionType {
  http = 'http',
  stdio = 'stdio',
}

export type DiscoverMcpItem = PluginItem & {
  /** Date when the MCP was delisted */
  deletedAt?: Date | string;
  /** Publisher's user ID, used to show "Mine" tag on list items */
  publisherId?: string;
  usageCount?: number;
  userName?: string;
};

export interface McpQueryParams {
  category?: string;
  connectionType?: McpConnectionType;
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: McpSorts;
}

export type McpListResponse = PluginListResponse;

export interface DiscoverMcpDetail extends PluginItemDetail {
  agents?: DiscoverAssistantItem[];
  /** Custom params for MCP connection configuration */
  customParams?: Record<string, unknown>;
  /** Date when the MCP was delisted (soft deleted) */
  deletedAt?: Date | string;
  haveCloudEndpoint?: boolean;
  isClaimed?: boolean;
  /** Publisher's user ID, used to determine if current user is the publisher */
  publisherId?: string;
  related: DiscoverMcpItem[];
  usageCount?: number;
  userName?: string;
}
