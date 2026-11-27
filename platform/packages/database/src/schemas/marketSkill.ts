import type { SkillManifest, SkillResourceMeta } from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const marketSkills = pgTable(
  'market_skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketSkills'))
      .notNull(),
    identifier: text('identifier').notNull(),

    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    content: text('content'),
    manifest: jsonb('manifest')
      .$type<SkillManifest>()
      .notNull()
      .default({} as SkillManifest),
    resources: jsonb('resources').$type<Record<string, SkillResourceMeta>>().default({}),
    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    installCount: integer('install_count').default(0),
    usageCount: integer('usage_count').default(0),
    resourcesCount: integer('resources_count').default(0),

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
    uniqueIndex('market_skills_identifier_unique').on(t.identifier),
    index('market_skills_publisher_id_idx').on(t.publisherId),
    index('market_skills_category_idx').on(t.category),
    index('market_skills_status_idx').on(t.status),
    index('market_skills_visibility_idx').on(t.visibility),
    index('market_skills_install_count_idx').on(t.installCount),
    index('market_skills_usage_count_idx').on(t.usageCount),
    index('market_skills_updated_at_idx').on(t.updatedAt),
    index('market_skills_name_idx').on(t.name),
  ],
);

export const insertMarketSkillSchema = createInsertSchema(marketSkills);

export type NewMarketSkill = typeof marketSkills.$inferInsert;
export type MarketSkillItem = typeof marketSkills.$inferSelect;
