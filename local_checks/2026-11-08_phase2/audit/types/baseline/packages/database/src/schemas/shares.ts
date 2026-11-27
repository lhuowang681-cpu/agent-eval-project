import { index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const shares = pgTable(
  'shares',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('shares'))
      .notNull(),
    token: varchar('token', { length: 32 }).notNull(),
    ownerId: text('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    itemType: varchar('item_type', { length: 16 }).notNull(), // 'skill' | 'mcp' | 'agent'
    marketIdentifier: varchar('market_identifier', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamptz('revoked_at'),
    expiresAt: timestamptz('expires_at'),
    viewCount: integer('view_count').default(0),
    installCount: integer('install_count').default(0),
  },
  (t) => [
    uniqueIndex('shares_token_unique').on(t.token),
    index('shares_owner_id_idx').on(t.ownerId),
    index('shares_market_identifier_idx').on(t.marketIdentifier),
  ],
);

export const insertShareSchema = createInsertSchema(shares);

export type NewShare = typeof shares.$inferInsert;
export type ShareItem = typeof shares.$inferSelect;
