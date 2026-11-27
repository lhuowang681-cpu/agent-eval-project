import type { LobeAgentChatConfig } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const marketAgents = pgTable(
  'market_agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketAgents'))
      .notNull(),
    identifier: text('identifier').notNull(),

    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    systemRole: text('system_role'),
    model: text('model'),
    provider: text('provider'),
    plugins: jsonb('plugins').$type<string[]>(),
    skills: jsonb('skills').$type<string[]>().default([]),
    knowledgeBases: jsonb('knowledge_bases').$type<string[]>().default([]),

    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),
    fewShots: jsonb('few_shots'),
    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    editorData: jsonb('editor_data'),

    tokenUsage: integer('token_usage').default(0),
    pluginCount: integer('plugin_count').default(0),
    knowledgeCount: integer('knowledge_count').default(0),
    installCount: integer('install_count').default(0),
    usageCount: integer('usage_count').default(0),

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
    uniqueIndex('market_agents_identifier_unique').on(t.identifier),
    index('market_agents_publisher_id_idx').on(t.publisherId),
    index('market_agents_category_idx').on(t.category),
    index('market_agents_status_idx').on(t.status),
    index('market_agents_visibility_idx').on(t.visibility),
    index('market_agents_install_count_idx').on(t.installCount),
    index('market_agents_usage_count_idx').on(t.usageCount),
    index('market_agents_updated_at_idx').on(t.updatedAt),
  ],
);

export const insertMarketAgentSchema = createInsertSchema(marketAgents);

export type NewMarketAgent = typeof marketAgents.$inferInsert;
export type MarketAgentItem = typeof marketAgents.$inferSelect;
