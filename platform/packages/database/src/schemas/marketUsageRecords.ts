import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz } from './_helpers';
import { users } from './user';

export const marketAgentUsageRecords = pgTable(
  'market_agent_usage_records',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketAgentUsageRecords'))
      .notNull(),
    agentIdentifier: text('agent_identifier').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    usedAt: timestamptz('used_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('market_agent_usage_records_identifier_used_at_idx').on(t.agentIdentifier, t.usedAt),
    index('market_agent_usage_records_user_id_idx').on(t.userId),
  ],
);

export const marketSkillUsageRecords = pgTable(
  'market_skill_usage_records',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketSkillUsageRecords'))
      .notNull(),
    skillIdentifier: text('skill_identifier').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id'),
    usedAt: timestamptz('used_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('market_skill_usage_records_identifier_used_at_idx').on(t.skillIdentifier, t.usedAt),
    index('market_skill_usage_records_user_id_idx').on(t.userId),
  ],
);

export const marketMcpUsageRecords = pgTable(
  'market_mcp_usage_records',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketMcpUsageRecords'))
      .notNull(),
    mcpIdentifier: text('mcp_identifier').notNull(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id'),
    usedAt: timestamptz('used_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('market_mcp_usage_records_identifier_used_at_idx').on(t.mcpIdentifier, t.usedAt),
    index('market_mcp_usage_records_user_id_idx').on(t.userId),
  ],
);

export const insertMarketAgentUsageRecordSchema = createInsertSchema(marketAgentUsageRecords);
export const insertMarketSkillUsageRecordSchema = createInsertSchema(marketSkillUsageRecords);
export const insertMarketMcpUsageRecordSchema = createInsertSchema(marketMcpUsageRecords);

export type NewMarketAgentUsageRecord = typeof marketAgentUsageRecords.$inferInsert;
export type MarketAgentUsageRecordItem = typeof marketAgentUsageRecords.$inferSelect;
export type NewMarketSkillUsageRecord = typeof marketSkillUsageRecords.$inferInsert;
export type MarketSkillUsageRecordItem = typeof marketSkillUsageRecords.$inferSelect;
export type NewMarketMcpUsageRecord = typeof marketMcpUsageRecords.$inferInsert;
export type MarketMcpUsageRecordItem = typeof marketMcpUsageRecords.$inferSelect;
