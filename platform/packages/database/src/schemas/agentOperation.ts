import { index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { createdAt, timestamptz, updatedAt } from './_helpers';
import { agents } from './agent';
import { threads } from './topic';
import { users } from './user';

/**
 * Durable, lightweight tracking row for a server-side `AgentRuntimeService`
 * operation. The full `AgentState` blob lives in Redis (`AgentRuntimeCoordinator`)
 * and can expire; this table exists specifically so that:
 * - `callSubAgent`'s parent-resume CAS (`tryResumeFromAsyncTool`) has an
 *   atomic, race-free `UPDATE ... WHERE status = X RETURNING` target.
 * - the dead-child watchdog can find/join stuck operations even after their
 *   Redis state has expired (via `parentOperationId`/`threadId`).
 *
 * Not used for interactive browser chat — that runs entirely client-side
 * (`internal_execAgentRuntime`) and never persists an operation row at all.
 */
export const agentOperations = pgTable(
  'agent_operations',
  {
    id: text('id').primaryKey(),

    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    topicId: text('topic_id'),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),

    /** Self-reference — set when this operation was forked by `callSubAgent`. */
    parentOperationId: text('parent_operation_id'),

    status: text('status', {
      enum: [
        'idle',
        'running',
        'waiting_for_human',
        'waiting_for_async_tool',
        'done',
        'error',
        'interrupted',
      ],
    })
      .notNull()
      .default('idle'),

    stepCount: integer('step_count').notNull().default(0),
    lastHeartbeatAt: timestamptz('last_heartbeat_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('agent_operations_parent_operation_id_idx').on(t.parentOperationId),
    index('agent_operations_user_id_status_idx').on(t.userId, t.status),
    index('agent_operations_status_heartbeat_idx').on(t.status, t.lastHeartbeatAt),
  ],
);

export type NewAgentOperationItem = typeof agentOperations.$inferInsert;
export type AgentOperationItem = typeof agentOperations.$inferSelect;
