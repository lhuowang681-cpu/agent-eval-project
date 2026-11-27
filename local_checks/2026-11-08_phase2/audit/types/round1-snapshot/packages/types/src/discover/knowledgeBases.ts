export enum KnowledgeBaseSorts {
  InstallCount = 'installCount',
  UpdatedAt = 'updatedAt',
}

export interface DiscoverKnowledgeBaseItem {
  author?: string;
  avatar?: string | null;
  createdAt: string;
  /** Date when the library was delisted */
  deletedAt?: Date | string;
  description?: string;
  documentCount?: number;
  fileCount?: number;
  homepage?: string;
  identifier: string;
  installCount?: number;
  name: string;
  publisherId?: string;
  type?: string | null;
  updatedAt: string;
}

export interface KnowledgeBaseQueryParams {
  locale?: string;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
  q?: string;
  sort?: KnowledgeBaseSorts;
}

export interface KnowledgeBaseListResponse {
  currentPage: number;
  items: DiscoverKnowledgeBaseItem[];
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface DiscoverKnowledgeBaseDetail extends DiscoverKnowledgeBaseItem {
  chunkCount?: number;
  deletedAt?: Date | string;
  publisherName?: string | null;
  settings?: Record<string, unknown> | null;
  status?: string | null;
  version?: number | null;
  visibility?: string | null;
}
