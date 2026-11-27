import type {
  MarketSkillCategory,
  MarketSkillDetail,
  MarketSkillListItem,
  MarketSkillListResponse,
  SkillCommentListResponse,
  SkillRatingDistribution,
} from '@lobehub/market-sdk';

export enum SkillCategory {
  All = 'all',
  ContentCreation = 'content-creation',
  DataAnalytics = 'data-analytics',
  DeepThinking = 'deep-thinking',
  DesignCreation = 'design-creation',
  Marketing = 'marketing',
  OpsAnalytics = 'ops-analytics',
  Other = 'other',
  ProductPlanning = 'product-planning',
  ReportWriting = 'report-writing',
  ResearchInsight = 'research-insight',
}

export enum SkillSorts {
  CreatedAt = 'createdAt',
  InstallCount = 'installCount',
  Name = 'name',
  Relevance = 'relevance',
  Stars = 'stars',
  UpdatedAt = 'updatedAt',
}

export enum SkillNavKey {
  Installation = 'installation',
  Overview = 'overview',
  Related = 'related',
  Resources = 'resources',
  Skill = 'skill',
  Version = 'version',
}

export interface DiscoverSkillItem extends Omit<MarketSkillListItem, 'commentCount'> {
  commentCount?: number;
  /** Date when the skill was delisted */
  deletedAt?: Date | string;
  homepage?: string;
  /** Publisher's user ID, used to show "Mine" tag on list items */
  publisherId?: string;
  ratingAvg?: number;
  usageCount?: number;
  userName?: string;
}

export interface SkillQueryParams {
  category?: string;
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: SkillSorts;
}

export interface SkillListResponse extends MarketSkillListResponse {
  categories?: SkillCategoryItem[];
}

export interface DiscoverSkillDetail extends MarketSkillDetail {
  comments?: SkillCommentListResponse;
  /** Date when the skill was delisted (soft deleted) */
  deletedAt?: Date | string;
  downloadUrl?: string;
  github?: {
    stars?: number;
    url?: string;
  };
  homepage?: string;
  /** Publisher's user ID, used to determine if current user is the publisher */
  publisherId?: string;
  ratingDistribution?: SkillRatingDistribution;
  related?: DiscoverSkillItem[];
  usageCount?: number;
  userName?: string;
}

export type SkillCategoryItem = MarketSkillCategory;
