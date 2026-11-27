import debug from 'debug';
import type { Context } from 'hono';

import { AgentOperationModel } from '@/database/models/agentOperation';
import { ThreadModel } from '@/database/models/thread';
import { getServerDB } from '@/database/server';
import { AgentRuntimeService } from '@/server/services/agentRuntime';

const log = debug('lobe-server:workflows:agent-operation:watchdog');

// Without a heartbeat for this long, a `running` child operation is
// presumed dead (process killed / Redis state lost before its own
// completion hook could fire the sub-agent bridge).
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Cron-style watchdog for `callSubAgent`'s dead-child bridge. Scans stuck
 * operations (`running` / `waiting_for_async_tool` with a stale heartbeat)
 * and, for those that are sub-agent children (`parentOperationId` set),
 * marks them `error` and drives `completeSubAgentBridge` — otherwise the
 * parent would stay parked in `waiting_for_async_tool` forever, since the
 * dead child's own completion hook never gets to fire.
 *
 * Parked PARENT rows are expected to show a stale heartbeat while waiting
 * (heartbeats stop ticking once parked — see `AgentRuntimeService.executeStep`,
 * which only calls `touchHeartbeat` on operations it's actively stepping).
 * That's normal, not a failure signal, so this only acts on rows that are
 * themselves a child (`parentOperationId` set) — a legitimate child ticks
 * its own heartbeat via its own `executeStep` calls, so staleness there is
 * a real liveness signal. Nesting is blocked (`isSubAgent` guard), so a
 * child can never itself be a parked parent.
 *
 * No per-user authentication: this is a global sweep registered as a QStash
 * Schedule (cron). Auth is handled by the `qstashAuth` middleware mounted
 * on the route.
 */
export async function watchdog(c: Context) {
  try {
    const db = await getServerDB();
    const stuckOperations = await AgentOperationModel.findStuckOperations(db, STALE_THRESHOLD_MS);
    const stuckChildren = stuckOperations.filter((op) => !!op.parentOperationId);

    const resolved: string[] = [];

    for (const op of stuckChildren) {
      try {
        const operationModel = new AgentOperationModel(db, op.userId);
        await operationModel.markTerminal(op.id, 'error');

        if (!op.threadId || !op.parentOperationId) {
          log(
            '[%s] stuck child missing threadId/parentOperationId — cannot resolve bridge, skipping',
            op.id,
          );
          continue;
        }

        const threadModel = new ThreadModel(db, op.userId);
        const thread = await threadModel.findById(op.threadId);
        if (!thread?.sourceMessageId) {
          log('[%s] stuck child thread has no sourceMessageId — skipping bridge', op.id);
          continue;
        }

        const agentRuntimeService = new AgentRuntimeService(db, op.userId);
        await agentRuntimeService.completeSubAgentBridge({
          operationId: op.id,
          parentOperationId: op.parentOperationId,
          reason: 'error',
          threadId: op.threadId,
          toolMessageId: thread.sourceMessageId,
        });

        resolved.push(op.id);
      } catch (error) {
        console.error('[agentOperation/watchdog] Failed to resolve stuck child %s:', op.id, error);
      }
    }

    log('Watchdog scan: checked=%d resolved=%d', stuckChildren.length, resolved.length);
    return c.json({
      checked: stuckChildren.length,
      resolved,
      success: true,
    });
  } catch (error) {
    console.error('[agentOperation/watchdog] Error:', error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  }
}
