#!/usr/bin/env tsx
/**
 * Parallel step E2E smoke test (@ctrip/qworkflow Promise.all alignment)
 *
 * Triggers `POST /api/internal/qworkflow-parallel-smoke` via zxqstash and validates:
 *   - workflow_runs.status = completed
 *   - parallel steps [0..2] with step_id parallel:a|b|c all success
 *   - serial step after-parallel at index 3 success
 *
 * Prerequisites:
 *   - zxqstash server with parallel wave support (:8080)
 *   - calcifer: `bun run dev:next` (:3010)
 *   - @ctrip/qworkflow >= 1.1.2 linked or installed
 *   - Env: ZXQSTASH_TOKEN, ZXQSTASH_SERVER_URL
 *   - Poll: ZXQSTASH_DATABASE_URL (zxqstash PostgreSQL)
 *
 * Usage:
 *   bun run qworkflow:parallel-smoke
 *   bun run qworkflow:parallel-smoke -- --timeout 120 --cleanup
 */
import { Pool } from 'pg';

const PARALLEL_STEP_IDS = ['parallel:a', 'parallel:b', 'parallel:c'] as const;
const AFTER_PARALLEL_STEP_ID = 'after-parallel';
const EXPECTED_WAVE_SIZE = 3;

interface CliOptions {
  appUrl: string;
  cleanup: boolean;
  poll: boolean;
  timeoutMs: number;
  token: string;
  zxqstashUrl: string;
}

interface WorkflowRunRow {
  completed_at: Date | null;
  current_step_index: number;
  final_result: unknown;
  id: string;
  status: string;
}

interface WorkflowStepRow {
  status: string;
  step_id: string;
  step_index: number;
}

const colors = {
  cyan: (s: string) => `\u001B[36m${s}\u001B[0m`,
  dim: (s: string) => `\u001B[2m${s}\u001B[0m`,
  green: (s: string) => `\u001B[32m${s}\u001B[0m`,
  red: (s: string) => `\u001B[31m${s}\u001B[0m`,
  yellow: (s: string) => `\u001B[33m${s}\u001B[0m`,
};

function printHelp() {
  console.log(`
${colors.cyan('qworkflow-parallel-smoke')} — Promise.all parallel step E2E

${colors.yellow('Validates')}
  - 3 parallel steps (indices 0-2) complete with success
  - post-wave serial step "after-parallel" at index 3
  - workflow run status completed

${colors.yellow('Examples')}
  bun run qworkflow:parallel-smoke
  ZXQSTASH_DATABASE_URL=postgres://... bun run qworkflow:parallel-smoke -- --cleanup
  bun run qworkflow:parallel-smoke -- --no-poll
`);
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const getFlag = (name: string) => {
    const idx = argv.indexOf(name);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const timeoutSec = Number(getFlag('--timeout') ?? '90');
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error(colors.red('--timeout must be a positive number'));
    process.exit(1);
  }

  const appUrl = (getFlag('--app-url') ?? process.env.APP_URL ?? 'http://localhost:3010').replace(
    /\/$/,
    '',
  );
  const zxqstashUrl = (
    getFlag('--zxqstash-url') ??
    process.env.ZXQSTASH_SERVER_URL ??
    'http://localhost:8080'
  ).replace(/\/$/, '');
  const token = getFlag('--token') ?? process.env.ZXQSTASH_TOKEN;

  if (!token) {
    console.error(colors.red('ZXQSTASH_TOKEN is required (env or --token)'));
    process.exit(1);
  }

  return {
    appUrl,
    cleanup: argv.includes('--cleanup'),
    poll: !argv.includes('--no-poll'),
    timeoutMs: timeoutSec * 1000,
    token,
    zxqstashUrl,
  };
}

async function triggerWorkflow(options: CliOptions, targetUrl: string): Promise<string> {
  const res = await fetch(`${options.zxqstashUrl}/v1/workflows/runs`, {
    body: JSON.stringify({
      body: { items: ['a', 'b', 'c'] },
      url: targetUrl,
    }),
    headers: {
      'Authorization': `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`trigger failed HTTP ${res.status}: ${text}`);
  }

  const data = JSON.parse(text) as { workflowRunId?: string };
  if (!data.workflowRunId) {
    throw new Error(`trigger response missing workflowRunId: ${text}`);
  }

  return data.workflowRunId;
}

async function pollWorkflowRun(
  workflowRunId: string,
  timeoutMs: number,
): Promise<{ run: WorkflowRunRow; steps: WorkflowStepRow[] }> {
  const databaseUrl = process.env.ZXQSTASH_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Set ZXQSTASH_DATABASE_URL to poll workflow status (or pass --no-poll to skip)',
    );
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const runResult = await pool.query<WorkflowRunRow>(
        `SELECT id, status, current_step_index, completed_at, final_result
         FROM workflow_runs WHERE id = $1`,
        [workflowRunId],
      );

      const run = runResult.rows[0];
      if (!run) {
        throw new Error(`workflow run not found: ${workflowRunId}`);
      }

      const stepsResult = await pool.query<WorkflowStepRow>(
        `SELECT step_id, step_index, status
         FROM workflow_steps WHERE workflow_run_id = $1
         ORDER BY step_index ASC, step_id ASC`,
        [workflowRunId],
      );

      const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
      if (terminal) {
        return { run, steps: stepsResult.rows };
      }

      await sleep(1500);
    }

    throw new Error(`timed out after ${timeoutMs}ms waiting for workflow ${workflowRunId}`);
  } finally {
    await pool.end();
  }
}

function validateParallelRun(run: WorkflowRunRow, steps: WorkflowStepRow[]): string[] {
  const errors: string[] = [];

  if (run.status !== 'completed') {
    errors.push(`expected workflow status "completed", got "${run.status}"`);
  }

  const parallelSteps = steps.filter((step) =>
    PARALLEL_STEP_IDS.includes(step.step_id as (typeof PARALLEL_STEP_IDS)[number]),
  );

  if (parallelSteps.length !== EXPECTED_WAVE_SIZE) {
    errors.push(
      `expected ${EXPECTED_WAVE_SIZE} parallel steps (${PARALLEL_STEP_IDS.join(', ')}), got ${parallelSteps.length}`,
    );
  }

  for (const expectedId of PARALLEL_STEP_IDS) {
    const step = parallelSteps.find((row) => row.step_id === expectedId);
    if (!step) {
      errors.push(`missing parallel step: ${expectedId}`);
      continue;
    }
    if (step.status !== 'success') {
      errors.push(`step ${expectedId} expected success, got ${step.status}`);
    }
  }

  const parallelIndices = parallelSteps.map((step) => step.step_index).sort((a, b) => a - b);
  const expectedIndices = Array.from({ length: EXPECTED_WAVE_SIZE }, (_, i) => i);

  if (JSON.stringify(parallelIndices) !== JSON.stringify(expectedIndices)) {
    errors.push(
      `parallel step indices expected ${JSON.stringify(expectedIndices)}, got ${JSON.stringify(parallelIndices)}`,
    );
  }

  const afterStep = steps.find((step) => step.step_id === AFTER_PARALLEL_STEP_ID);
  if (!afterStep) {
    errors.push(`missing post-wave step: ${AFTER_PARALLEL_STEP_ID}`);
  } else {
    if (afterStep.step_index !== EXPECTED_WAVE_SIZE) {
      errors.push(
        `after-parallel expected index ${EXPECTED_WAVE_SIZE}, got ${afterStep.step_index}`,
      );
    }
    if (afterStep.status !== 'success') {
      errors.push(`after-parallel expected success, got ${afterStep.status}`);
    }
  }

  if (run.final_result && typeof run.final_result === 'object') {
    const finalResult = run.final_result as {
      ok?: boolean;
      summary?: { waveSize?: number };
    };
    if (finalResult.ok !== true) {
      errors.push('final_result.ok is not true');
    }
    if (finalResult.summary?.waveSize !== EXPECTED_WAVE_SIZE) {
      errors.push(
        `final_result.summary.waveSize expected ${EXPECTED_WAVE_SIZE}, got ${finalResult.summary?.waveSize}`,
      );
    }
  }

  const successSteps = steps.filter((step) => step.status === 'success');
  if (successSteps.length < EXPECTED_WAVE_SIZE + 1) {
    errors.push(
      `expected at least ${EXPECTED_WAVE_SIZE + 1} successful steps (wave + after-parallel), got ${successSteps.length}`,
    );
  }

  return errors;
}

async function cleanupWorkflowRun(workflowRunId: string): Promise<void> {
  const databaseUrl = process.env.ZXQSTASH_DATABASE_URL;
  if (!databaseUrl) {
    console.log(colors.yellow('  --cleanup skipped: ZXQSTASH_DATABASE_URL not set'));
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query('DELETE FROM workflow_steps WHERE workflow_run_id = $1', [workflowRunId]);
    const result = await pool.query('DELETE FROM workflow_runs WHERE id = $1', [workflowRunId]);
    console.log(colors.green(`  Cleaned up ${result.rowCount ?? 0} workflow_runs row`));
  } finally {
    await pool.end();
  }
}

function printCleanupSql(workflowRunId: string) {
  console.log(colors.dim('\nManual cleanup (zxqstash PostgreSQL):'));
  console.log(
    colors.dim(`  DELETE FROM workflow_steps WHERE workflow_run_id = '${workflowRunId}';`),
  );
  console.log(colors.dim(`  DELETE FROM workflow_runs WHERE id = '${workflowRunId}';`));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const targetUrl = `${options.appUrl}/api/internal/qworkflow-parallel-smoke`;

  console.log(colors.cyan('\n=== @ctrip/qworkflow parallel step E2E ===\n'));
  console.log(`  target:     ${targetUrl}`);
  console.log(`  zxqstash:   ${options.zxqstashUrl}`);
  console.log(`  wave:       Promise.all x ${EXPECTED_WAVE_SIZE} + 1 serial step`);
  console.log('');

  console.log(colors.yellow('[1/4] Triggering parallel smoke workflow...'));
  const workflowRunId = await triggerWorkflow(options, targetUrl);
  console.log(colors.green(`  workflowRunId: ${workflowRunId}`));

  if (!options.poll) {
    printCleanupSql(workflowRunId);
    console.log(
      colors.dim('\nPolling skipped (--no-poll). Inspect zxqstash DB / logs manually.\n'),
    );
    return;
  }

  console.log(colors.yellow('\n[2/4] Polling zxqstash DB until terminal status...'));
  let run: WorkflowRunRow;
  let steps: WorkflowStepRow[];

  try {
    ({ run, steps } = await pollWorkflowRun(workflowRunId, options.timeoutMs));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ZXQSTASH_DATABASE_URL')) {
      console.log(colors.yellow(`  ${message}`));
      printCleanupSql(workflowRunId);
      return;
    }
    throw error;
  }

  console.log(colors.green(`  status: ${run.status}`));
  console.log(`  steps:  ${steps.length}`);
  for (const step of steps) {
    console.log(colors.dim(`    [${step.step_index}] ${step.step_id} (${step.status})`));
  }

  console.log(colors.yellow('\n[3/4] Validating parallel wave semantics...'));
  const errors = validateParallelRun(run, steps);

  if (errors.length > 0) {
    console.error(colors.red('\nParallel smoke failed:'));
    for (const error of errors) {
      console.error(colors.red(`  - ${error}`));
    }
    console.error(
      colors.yellow(
        '\nHint: ensure @ctrip/qworkflow >= 1.1.2 and zxqstash server has parallel wave support.',
      ),
    );
    printCleanupSql(workflowRunId);
    process.exit(1);
  }

  console.log(colors.green('  parallel wave [0-2]: ok'));
  console.log(colors.green(`  ${AFTER_PARALLEL_STEP_ID} @ index 3: ok`));
  console.log(colors.green('  final_result: ok'));

  console.log(colors.green('\n[4/4] Parallel smoke passed'));

  if (options.cleanup) {
    console.log(colors.yellow('\n[cleanup] Removing zxqstash test rows...'));
    await cleanupWorkflowRun(workflowRunId);
  } else {
    printCleanupSql(workflowRunId);
  }

  console.log('');
}

main().catch((error) => {
  console.error(
    colors.red('\nParallel smoke error:'),
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
