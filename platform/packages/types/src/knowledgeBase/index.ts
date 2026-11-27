import type { FilesConfigItem } from '../user/settings/filesConfig';

export enum KnowledgeBaseTabs {
  Files = 'files',
  Settings = 'Settings',
  Testing = 'testing',
}

export interface KnowledgeBaseItem {
  avatar: string | null;

  createdAt: Date;
  description?: string | null;
  enabled?: boolean;

  id: string;

  installedFromMarketIdentifier?: string | null;
  installedFromSnapshot?: Record<string, unknown> | null;
  installedMarketVersion?: number | null;
  isPublic: boolean | null;
  marketIdentifier?: string | null;
  /** Market listing visibility when this KB is published by the current user */
  marketVisibility?: 'bundled' | 'public' | null;

  name: string;

  settings: any;
  // different types of knowledge bases need to be distinguished
  type: string | null;
  updatedAt: Date;
}

export interface CreateKnowledgeBaseParams {
  avatar?: string;
  description?: string;
  name: string;
  settings?: Record<string, any>;
  /** 资源库类型，如 'feishu' 表示飞书资源库 */
  type?: string;
}

export enum KnowledgeType {
  File = 'file',
  KnowledgeBase = 'knowledgeBase',
}

export interface KnowledgeItem {
  avatar?: string | null;
  content?: string;
  description?: string | null;
  enabled?: boolean;
  fileType?: string;
  id: string;
  name: string;
  type: KnowledgeType;
}

export interface SystemEmbeddingConfig {
  embeddingModel: FilesConfigItem;
  queryMode: string;
  rerankerModel: FilesConfigItem;
}
