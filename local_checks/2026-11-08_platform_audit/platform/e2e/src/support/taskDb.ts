import type { Client } from 'pg';

import { TEST_USER } from './seedTestUser';

/**
 * Lightweight direct-DB helpers for task e2e assertions.
 *
 * Task execution (Run now / scheduled dispatch) fires the LLM server-side via a
 * bespoke provider, so we assert the *observable effects* of a real run — a
 * topic row is created, status transitions, `last_heartbeat_at` is set — rather
 * than mocking the model to completion.
 */

interface TaskRow {
  automation_mode: string | null;
  id: string;
  last_heartbeat_at: Date | null;
  name: string | null;
  schedule_pattern: string | null;
  status: string;
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL not set — task DB helpers require it');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Delete all tasks owned by the test user (child rows cascade). Runs before each
 * task scenario so they are isolated — same task names don't collide across
 * scenarios and the list starts empty.
 */
export async function clearTasksForTestUser(): Promise<void> {
  await withClient(async (client) => {
    await client.query('DELETE FROM tasks WHERE created_by_user_id = $1', [TEST_USER.id]);
  });
}

/** Fetch the most recent task created by the test user with the given name. */
export async function getTaskByName(name: string): Promise<TaskRow | null> {
  return withClient(async (client) => {
    const res = await client.query(
      `SELECT id, name, status, automation_mode, schedule_pattern, last_heartbeat_at
       FROM tasks WHERE name = $1 AND created_by_user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [name, TEST_USER.id],
    );
    return (res.rows[0] as TaskRow) ?? null;
  });
}

/** Count topic rows attached to a task (each run creates one). */
export async function countTaskTopics(taskId: string): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query(
      'SELECT count(*)::int AS n FROM task_topics WHERE task_id = $1',
      [taskId],
    );
    return (res.rows[0]?.n as number) ?? 0;
  });
}

/**
 * Force a task into schedule mode with an always-due cron, so the central
 * dispatcher (`/schedule-dispatch`) picks it up immediately. Used by the
 * background-execution scenario instead of driving the schedule UI (which is
 * covered separately).
 */
export async function makeTaskDueNow(taskId: string): Promise<void> {
  await withClient(async (client) => {
    // Background dispatch has no inbox fallback, so ensure the task has an
    // assignee agent (prefer the user's inbox) before it becomes due.
    const agent = await client.query(
      `SELECT id FROM agents WHERE user_id = $1 ORDER BY (slug = 'inbox') DESC, created_at ASC LIMIT 1`,
      [TEST_USER.id],
    );
    const agentId = agent.rows[0]?.id as string | undefined;
    if (!agentId) throw new Error('No agent found for test user — inbox seed missing');

    await client.query(
      `UPDATE tasks
       SET automation_mode = 'schedule', schedule_pattern = '* * * * *',
           schedule_timezone = 'UTC', status = 'scheduled', last_heartbeat_at = NULL,
           assignee_agent_id = COALESCE(assignee_agent_id, $2)
       WHERE id = $1`,
      [taskId, agentId],
    );
  });
}

/** Poll until the predicate holds for the task row, or time out. */
export async function waitForTask(
  name: string,
  predicate: (task: TaskRow) => boolean,
  timeoutMs = 20_000,
): Promise<TaskRow> {
  const start = Date.now();
  let last: TaskRow | null = null;
  while (Date.now() - start < timeoutMs) {
    last = await getTaskByName(name);
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `waitForTask timed out for "${name}"; last seen: ${last ? JSON.stringify(last) : 'null'}`,
  );
}

/** Poll until a task has at least one topic row, or time out. */
export async function waitForTaskTopic(taskId: string, timeoutMs = 20_000): Promise<number> {
  const start = Date.now();
  let n = 0;
  while (Date.now() - start < timeoutMs) {
    n = await countTaskTopics(taskId);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`waitForTaskTopic timed out for task ${taskId}; topics=${n}`);
}
