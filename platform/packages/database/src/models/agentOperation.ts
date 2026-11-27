import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';

import type { AgentOperationItem, NewAgentOperationItem } from '../schemas';
import { agentOperations } from '../schemas';
import type { LobeChatDatabase } from '../type';

/**
 * Durable, lightweight tracking for `AgentRuntimeService` operations.
 *
 * This is deliberately NOT the source of truth for the full `AgentState`
 * blob (that lives in Redis, see `AgentRuntimeCoordinator`) — it exists so
 * that `callSubAgent`'s parent-resume can CAS atomically at the SQL level,
 * and so the dead-child watchdog can find stuck operations even after their
 * Redis state has expired.
 */
export class AgentOperationModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  /**
   * Record the start of an operation. `id` must equal the `operationId`
   * already established by the caller (Redis coordinator key), not
   * generated here.
   */
  recordStart = async (
    params: Omit<NewAgentOperationItem, 'userId' | 'status' | 'stepCount'>,
  ): Promise<void> => {
    await this.db
      .insert(agentOperations)
      .values({ ...params, status: 'running', userId: this.userId })
      .onConflictDoNothing({ target: agentOperations.id });
  };

  /**
   * Atomically flip a parked parent op from `waiting_for_async_tool` back to
   * `running`. Returns true only for the single winner, so concurrent
   * sub-operation completions racing to resume the same parent don't
   * double-resume it.
   */
  tryResumeFromAsyncTool = async (operationId: string): Promise<boolean> => {
    const rows = await this.db
      .update(agentOperations)
      .set({ status: 'running' })
      .where(
        and(
          eq(agentOperations.id, operationId),
          eq(agentOperations.userId, this.userId),
          eq(agentOperations.status, 'waiting_for_async_tool'),
        ),
      )
      .returning({ id: agentOperations.id });

    return rows.length === 1;
  };

  /**
   * Refresh the heartbeat + status + stepCount for an in-flight operation.
   * Called once per `executeStep`.
   */
  touchHeartbeat = async (
    operationId: string,
    fields?: { status?: AgentOperationItem['status']; stepCount?: number },
  ): Promise<void> => {
    await this.db
      .update(agentOperations)
      .set({ lastHeartbeatAt: new Date(), ...fields })
      .where(and(eq(agentOperations.id, operationId), eq(agentOperations.userId, this.userId)));
  };

  /**
   * Mark an operation as having reached a terminal status
   * (`done` / `error` / `interrupted`).
   */
  markTerminal = async (
    operationId: string,
    status: 'done' | 'error' | 'interrupted',
  ): Promise<void> => {
    await this.db
      .update(agentOperations)
      .set({ status })
      .where(and(eq(agentOperations.id, operationId), eq(agentOperations.userId, this.userId)));
  };

  findById = async (operationId: string): Promise<AgentOperationItem | undefined> => {
    return this.db.query.agentOperations.findFirst({
      where: and(eq(agentOperations.id, operationId), eq(agentOperations.userId, this.userId)),
    });
  };

  /**
   * Find operations that are `running` or `waiting_for_async_tool` but
   * haven't sent a heartbeat within `staleThresholdMs` — candidates for the
   * dead-operation watchdog. Static + unscoped (like `TaskModel.findStuckTasks`)
   * since the watchdog is a global cron sweep across all users, not a
   * per-request/per-user operation; each returned row carries its own
   * `userId` for the handler to act on.
   */
  static findStuckOperations = async (
    db: LobeChatDatabase,
    staleThresholdMs: number,
  ): Promise<AgentOperationItem[]> => {
    return db
      .select()
      .from(agentOperations)
      .where(
        and(
          sql`${agentOperations.status} IN ('running', 'waiting_for_async_tool')`,
          isNotNull(agentOperations.lastHeartbeatAt),
          lt(
            agentOperations.lastHeartbeatAt,
            sql`now() - make_interval(secs => ${staleThresholdMs / 1000})`,
          ),
        ),
      );
  };
}
