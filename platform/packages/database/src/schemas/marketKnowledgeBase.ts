import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
  vector,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import type { LobeDocumentPage } from '@/types/document';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamps, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const marketKnowledgeBases = pgTable(
  'market_knowledge_bases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketKnowledgeBases'))
      .notNull(),
    identifier: text('identifier').notNull(),

    name: text('name').notNull(),
    description: text('description'),
    avatar: text('avatar'),
    type: text('type'),
    settings: jsonb('settings').$type<Record<string, unknown>>(),

    fileCount: integer('file_count').default(0),
    documentCount: integer('document_count').default(0),
    chunkCount: integer('chunk_count').default(0),
    installCount: integer('install_count').default(0),

    version: integer('version').notNull().default(1),
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
    status: varchar('status', { length: 20 }).notNull().default('published'),

    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('market_knowledge_bases_identifier_unique').on(t.identifier),
    index('market_knowledge_bases_publisher_id_idx').on(t.publisherId),
    index('market_knowledge_bases_status_idx').on(t.status),
    index('market_knowledge_bases_visibility_idx').on(t.visibility),
    index('market_knowledge_bases_install_count_idx').on(t.installCount),
    index('market_knowledge_bases_updated_at_idx').on(t.updatedAt),
    index('market_knowledge_bases_name_idx').on(t.name),
  ],
);

export const marketKbFiles = pgTable(
  'market_kb_files',
  {
    id: text('id').primaryKey().notNull(),
    marketKnowledgeBaseId: text('market_knowledge_base_id')
      .references(() => marketKnowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    sourceFileId: text('source_file_id').notNull(),
    name: text('name').notNull(),
    fileType: varchar('file_type', { length: 255 }).notNull(),
    size: integer('size').notNull(),
    s3Key: text('s3_key').notNull(),
    fileHash: varchar('file_hash', { length: 64 }),
    parentId: text('parent_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    source: text('source'),
    ...timestamps,
  },
  (t) => [
    index('market_kb_files_market_kb_id_idx').on(t.marketKnowledgeBaseId),
    index('market_kb_files_parent_id_idx').on(t.parentId),
  ],
);

export const marketKbDocuments = pgTable(
  'market_kb_documents',
  {
    id: text('id').primaryKey().notNull(),
    marketKnowledgeBaseId: text('market_knowledge_base_id')
      .references(() => marketKnowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    sourceDocumentId: text('source_document_id').notNull(),
    title: text('title'),
    description: text('description'),
    content: text('content'),
    fileType: varchar('file_type', { length: 255 }).notNull(),
    filename: text('filename'),
    totalCharCount: integer('total_char_count').notNull().default(0),
    totalLineCount: integer('total_line_count').notNull().default(0),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    pages: jsonb('pages').$type<LobeDocumentPage[]>(),
    sourceType: text('source_type', { enum: ['file', 'web', 'api', 'topic'] }).notNull(),
    source: text('source').notNull(),
    sourceFileId: text('source_file_id'),
    parentId: text('parent_id'),
    slug: varchar('slug', { length: 255 }),
    editorData: jsonb('editor_data').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    index('market_kb_documents_market_kb_id_idx').on(t.marketKnowledgeBaseId),
    index('market_kb_documents_parent_id_idx').on(t.parentId),
  ],
);

export const marketKbFileLinks = pgTable(
  'market_kb_file_links',
  {
    marketKnowledgeBaseId: text('market_knowledge_base_id')
      .references(() => marketKnowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    fileId: text('file_id')
      .references(() => marketKbFiles.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketKnowledgeBaseId, t.fileId] })],
);

export const marketKbChunks = pgTable(
  'market_kb_chunks',
  {
    id: uuid('id').primaryKey().notNull(),
    marketKnowledgeBaseId: text('market_knowledge_base_id')
      .references(() => marketKnowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    sourceChunkId: uuid('source_chunk_id').notNull(),
    text: text('text'),
    abstract: text('abstract'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    index: integer('index'),
    type: varchar('type'),
    ...timestamps,
  },
  (t) => [index('market_kb_chunks_market_kb_id_idx').on(t.marketKnowledgeBaseId)],
);

export const marketKbFileChunks = pgTable(
  'market_kb_file_chunks',
  {
    fileId: text('file_id')
      .references(() => marketKbFiles.id, { onDelete: 'cascade' })
      .notNull(),
    chunkId: uuid('chunk_id')
      .references(() => marketKbChunks.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.chunkId] })],
);

export const marketKbDocumentChunks = pgTable(
  'market_kb_document_chunks',
  {
    documentId: text('document_id')
      .references(() => marketKbDocuments.id, { onDelete: 'cascade' })
      .notNull(),
    chunkId: uuid('chunk_id')
      .references(() => marketKbChunks.id, { onDelete: 'cascade' })
      .notNull(),
    pageIndex: integer('page_index'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.chunkId] })],
);

export const marketKbEmbeddings = pgTable(
  'market_kb_embeddings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketKnowledgeBaseId: text('market_knowledge_base_id')
      .references(() => marketKnowledgeBases.id, { onDelete: 'cascade' })
      .notNull(),
    chunkId: uuid('chunk_id')
      .references(() => marketKbChunks.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    embeddings: vector('embeddings', { dimensions: 1024 }),
    model: text('model'),
  },
  (t) => [
    index('market_kb_embeddings_market_kb_id_idx').on(t.marketKnowledgeBaseId),
    index('market_kb_embeddings_chunk_id_idx').on(t.chunkId),
  ],
);

export const insertMarketKnowledgeBaseSchema = createInsertSchema(marketKnowledgeBases);

export type NewMarketKnowledgeBase = typeof marketKnowledgeBases.$inferInsert;
export type MarketKnowledgeBaseItem = typeof marketKnowledgeBases.$inferSelect;
