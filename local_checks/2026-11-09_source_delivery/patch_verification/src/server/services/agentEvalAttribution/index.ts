import { and, asc, eq, lt, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { asyncTasks } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

import {
  ATTRIBUTION_TASK_TYPE,
  AttributionError,
  diagnosticSchema,
  digest,
  trajectorySchema,
  validateDiagnostic,
} from './contracts';
import type { Diagnostic, Trajectory } from './contracts';
import { getEngineRevision, runPython } from './python';
import type { PythonOptions } from './python';
import { extractTrajectory } from './trace';

interface ServiceOptions extends PythonOptions {
  runner?: (input: Trajectory, options: PythonOptions) => Promise<Diagnostic>;
  now?: () => Date;
  engineRevision?: string;
}
interface JobMetadata {
  engineRevision: string;
  input: Trajectory;
  leaseToken?: string;
  leaseStartedAt?: string;
  result?: Diagnostic;
}

/** Diagnostic tasks never write agent_eval_runs, run_topics, messages, or scoring callbacks. */
export class AgentEvalAttributionService {
  private readonly now: () => Date;
  private readonly runner: NonNullable<ServiceOptions['runner']>;

  constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
    private readonly options: ServiceOptions = {},
  ) {
    if (
      options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) ||
        options.timeoutMs < 100 ||
        options.timeoutMs > 30_000)
    ) {
      throw new AttributionError(
        'invalid_timeout',
        'Python deadline must be an integer between 100 and 30000 ms',
      );
    }
    this.now = options.now ?? (() => new Date());
    this.runner = options.runner ?? runPython;
  }

  private whereOwned() {
    return and(eq(asyncTasks.userId, this.userId), eq(asyncTasks.type, ATTRIBUTION_TASK_TYPE));
  }

  async enqueue(request: { runId: string; caseId: string; threadId?: string | null }) {
    const input = await extractTrajectory(this.db, this.userId, request);
    const engineRevision = this.options.engineRevision ?? (await getEngineRevision());
    const hash = digest({ userId: this.userId, engineRevision, inputDigest: input.inputDigest });
    // Stable UUID-shaped primary key on the existing async_tasks table provides a database uniqueness boundary.
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const metadata: JobMetadata = { engineRevision, input };
    const inserted = await this.db
      .insert(asyncTasks)
      .values({
        id,
        userId: this.userId,
        type: ATTRIBUTION_TASK_TYPE,
        status: 'pending',
        metadata,
      })
      .onConflictDoNothing()
      .returning({ id: asyncTasks.id });
    const job = await this.getJob(id);
    if (!job)
      throw new AttributionError(
        'job_conflict',
        'Diagnostic identity collided with a different job',
      );
    return { id, created: inserted.length === 1, status: job.status, scope: input.scope };
  }

  async enqueueRun(runId: string) {
    const run = await new AgentEvalRunModel(this.db, this.userId).findById(runId);
    if (!run) throw new AttributionError('not_found', 'Evaluation run not found');
    if (['pending', 'running', 'idle'].includes(run.status))
      throw new AttributionError(
        'not_terminal',
        'Finish or abort the run before requesting batch diagnosis',
      );
    const topics = await new AgentEvalRunTopicModel(this.db, this.userId).findByRunId(runId);
    const receipts = [];
    for (const topic of topics) {
      if ((run.config?.k ?? 1) > 1) {
        const threads = await new ThreadModel(this.db, this.userId).queryByTopicId(topic.topicId);
        for (const thread of threads.filter((item) => item.type === 'eval')) {
          const metadata = thread.metadata as Record<string, unknown> | null;
          if (
            metadata?.passed === false ||
            ['failed', 'error', 'timeout'].includes(String(metadata?.status))
          ) {
            receipts.push(
              await this.enqueue({ runId, caseId: topic.testCaseId, threadId: thread.id }),
            );
          }
        }
      } else if (['failed', 'error', 'timeout'].includes(topic.status ?? '')) {
        receipts.push(await this.enqueue({ runId, caseId: topic.testCaseId }));
      }
    }
    return receipts;
  }

  async getJob(id: string) {
    const [row] = await this.db
      .select()
      .from(asyncTasks)
      .where(and(this.whereOwned(), eq(asyncTasks.id, id)))
      .limit(1);
    if (!row) return undefined;
    const metadata = row.metadata as unknown as JobMetadata;
    const input = trajectorySchema.parse(metadata.input);
    const result = metadata.result ? diagnosticSchema.parse(metadata.result) : undefined;
    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      error: row.error,
      inputDigest: input.inputDigest,
      scope: input.scope,
      trajectoryId: input.trajectoryId,
      engineRevision: metadata.engineRevision,
      result,
    };
  }

  async getTrace(id: string) {
    const [row] = await this.db
      .select()
      .from(asyncTasks)
      .where(and(this.whereOwned(), eq(asyncTasks.id, id)))
      .limit(1);
    if (!row) throw new AttributionError('not_found', 'Diagnostic job not found');
    return trajectorySchema.parse((row.metadata as unknown as JobMetadata).input);
  }

  async listForRun(runId: string) {
    if (!(await new AgentEvalRunModel(this.db, this.userId).findById(runId)))
      throw new AttributionError('not_found', 'Evaluation run not found');
    const rows = await this.db
      .select({ id: asyncTasks.id })
      .from(asyncTasks)
      .where(
        and(this.whereOwned(), sql`${asyncTasks.metadata}->'input'->'scope'->>'runId' = ${runId}`),
      )
      .orderBy(asc(asyncTasks.createdAt))
      .limit(500);
    return Promise.all(rows.map((row) => this.getJob(row.id)));
  }

  /** Claim with a unique lease; recovered/duplicate workers cannot overwrite a newer attempt. */
  async processJob(id: string) {
    const leaseToken = randomUUID();
    const now = this.now();
    const timeoutMs = this.options.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
      throw new AttributionError(
        'invalid_timeout',
        'Python deadline must be an integer between 100 and 30000 ms',
      );
    const expiry = new Date(now.getTime() - timeoutMs - 5_000);
    const [claimed] = await this.db
      .update(asyncTasks)
      .set({
        status: 'processing',
        error: null,
        updatedAt: now,
        metadata: sql`jsonb_set(jsonb_set(${asyncTasks.metadata}, '{leaseToken}', ${JSON.stringify(leaseToken)}::jsonb), '{leaseStartedAt}', ${JSON.stringify(now.toISOString())}::jsonb)`,
      })
      .where(
        and(
          this.whereOwned(),
          eq(asyncTasks.id, id),
          or(
            eq(asyncTasks.status, 'pending'),
            and(eq(asyncTasks.status, 'processing'), lt(asyncTasks.updatedAt, expiry)),
          ),
        ),
      )
      .returning();
    if (!claimed) return { claimed: false, job: await this.getJob(id) };
    const metadata = claimed.metadata as unknown as JobMetadata;
    const stillOwned = and(
      this.whereOwned(),
      eq(asyncTasks.id, id),
      eq(asyncTasks.status, 'processing'),
      sql`${asyncTasks.metadata}->>'leaseToken' = ${leaseToken}`,
    );
    try {
      const input = trajectorySchema.parse(metadata.input);
      const revision = this.options.engineRevision ?? (await getEngineRevision());
      if (revision !== metadata.engineRevision)
        throw new AttributionError(
          'engine_changed',
          'Analyzer code changed after enqueue; request a new versioned diagnostic',
        );
      const result = validateDiagnostic(
        await this.runner(input, { executable: this.options.executable, timeoutMs }),
        input,
      );
      if (result.jobExecution.status !== 'completed')
        throw new AttributionError('python_analyzer', 'Analyzer returned an execution error');
      const writes = await this.db
        .update(asyncTasks)
        .set({
          status: 'success',
          updatedAt: this.now(),
          duration: Math.max(0, this.now().getTime() - now.getTime()),
          metadata: sql`jsonb_set(${asyncTasks.metadata}, '{result}', ${JSON.stringify(result)}::jsonb)`,
        })
        .where(stillOwned)
        .returning({ id: asyncTasks.id });
      return { claimed: true, stale: writes.length === 0, job: await this.getJob(id) };
    } catch (error) {
      const code = error instanceof AttributionError ? error.code : 'diagnostic_contract';
      await this.db
        .update(asyncTasks)
        .set({
          status: 'error',
          error: {
            code,
            message: 'Attribution failed; the original evaluation result was preserved',
          },
          updatedAt: this.now(),
        })
        .where(stillOwned);
      return { claimed: true, job: await this.getJob(id) };
    }
  }

  async processPending(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AttributionError('invalid_limit', 'Batch limit must be between 1 and 100');
    const expiry = new Date(this.now().getTime() - (this.options.timeoutMs ?? 15_000) - 5_000);
    const rows = await this.db
      .select({ id: asyncTasks.id })
      .from(asyncTasks)
      .where(
        and(
          this.whereOwned(),
          or(
            eq(asyncTasks.status, 'pending'),
            and(eq(asyncTasks.status, 'processing'), lt(asyncTasks.updatedAt, expiry)),
          ),
        ),
      )
      .orderBy(asc(asyncTasks.createdAt))
      .limit(limit);
    const results = [];
    for (const row of rows) results.push(await this.processJob(row.id));
    return results;
  }
}
