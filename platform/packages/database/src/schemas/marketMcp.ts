import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const marketMcps = pgTable(
  'market_mcps',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketMcps'))
      .notNull(),
    identifier: text('identifier').notNull(),

    name: text('name'),
    description: text('description'),
    icon: text('icon'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    overview: text('overview'),
    connectionType: varchar('connection_type', { length: 10 }).notNull().default('http'),
    manifest: jsonb('manifest'),
    customParams: jsonb('custom_params'),
    capabilities: jsonb('capabilities').$type<{
      tools?: boolean;
      prompts?: boolean;
      resources?: boolean;
    }>(),

    toolsCount: integer('tools_count').default(0),
    promptsCount: integer('prompts_count').default(0),
    resourcesCount: integer('resources_count').default(0),
    installCount: integer('install_count').default(0),
    usageCount: integer('usage_count').default(0),

    version: varchar('version', { length: 20 }).notNull().default('1.0.0'),
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
    uniqueIndex('market_mcps_identifier_unique').on(t.identifier),
    index('market_mcps_publisher_id_idx').on(t.publisherId),
    index('market_mcps_category_idx').on(t.category),
    index('market_mcps_connection_type_idx').on(t.connectionType),
    index('market_mcps_status_idx').on(t.status),
    index('market_mcps_visibility_idx').on(t.visibility),
    index('market_mcps_install_count_idx').on(t.installCount),
    index('market_mcps_usage_count_idx').on(t.usageCount),
    index('market_mcps_updated_at_idx').on(t.updatedAt),
  ],
);

export const insertMarketMcpSchema = createInsertSchema(marketMcps);

export type NewMarketMcp = typeof marketMcps.$inferInsert;
export type MarketMcpItem = typeof marketMcps.$inferSelect;
