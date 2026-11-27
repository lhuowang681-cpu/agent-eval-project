#!/usr/bin/env tsx
/**
 * @ctrip/qworkflow local smoke test
 *
 * Triggers a real workflow via zxqstash `POST /v1/workflows/runs`.
 * This **writes** to zxqstash PostgreSQL (`workflow_runs`, `workflow_steps`).
 *
 * Prerequisites:
 *   - zxqstash server: `pnpm start:dev` in trn-ztrip-qstash-function (:8080)
 *   - calcifer: `bun run dev` (:3010)
 *   - Env: ZXQSTASH_SERVER_URL, ZXQSTASH_TOKEN (calcifer needs these for step callbacks)
 *
 * Usage:
 *   bun run qworkflow:smoke
 *   bun run qworkflow:smoke -- --scenario hourly-dry-run
 *   bun run qworkflow:smoke -- --scenario ping --timeout 90
 *
 * Options:
 *   --scenario <ping|hourly-dry-run>  Default: ping (no calcifer DB writes)
 *   --app-url <url>                   Default: APP_URL or http://localhost:3010
 *   --zxqstash-url <url>              Default: ZXQSTASH_SERVER_URL or http://localhost:8080
 *   --token <token>                   Default: ZXQSTASH_TOKEN
 *   --timeout <seconds>               Poll timeout (default: 60)
 *   --no-poll                         Skip status polling (print workflowRunId only)
 *   --cleanup                         Delete zxqstash rows when ZXQSTASH_DATABASE_URL is set
 *   --help
 */
import { Pool } from 'pg';

type Scenario = 'hourly-dry-run' | 'ping';

interface ScenarioConfig {
  body: Record<string, unknown>;
  calciferSideEffects: string;
  path: string;
  zxqstashSideEffects: string;
}

interface CliOptions {
  appUrl: string;
  cleanup: boolean;
  poll: boolean;
  scenario: Scenario;
  timeoutMs: number;
  token: string;
  zxqstashUrl: string;
}

const SCENARIOS: Record<Scenario, (appUrl: string) => ScenarioConfig> = {
  'ping': (appUrl) => ({
    body: { label: 'qworkflow-smoke', n: 41 },
    calciferSideEffects: 'None (in-memory steps only)',
    path: '/api/internal/qworkflow-smoke',
    zxqstashSideEffects: 'workflow_runs + workflow_steps (2 steps + complete)',
  }),
  'hourly-dry-run': (appUrl) => ({
    body: { baseUrl: appUrl, dryRun: true },
    calciferSideEffects:
      'Reads eligible users from calcifer DB; may trigger pagination workflows if multiple pages',
    path: '/api/workflows/memory-user-memory/call-cron-hourly-analysis',
    zxqstashSideEffects: 'workflow_runs + workflow_steps (varies by user count / pages)',
  }),
};

const colors = {
  cyan: (s: string) => `\u001B[36m${s}\u001B[0m`,
  dim: (s: string) => `\u001B[2m${s}\u001B[0m`,
  green: (s: string) => `\u001B[32m${s}\u001B[0m`,
  red: (s: string) => `\u001B[31m${s}\u001B[0m`,
  yellow: (s: string) => `\u001B[33m${s}\u001B[0m`,
};

function printHelp() {
  console.log(`
${colors.cyan('qworkflow-smoke')} — local @ctrip/qworkflow E2E smoke test

${colors.yellow('Side effects')}
  zxqstash DB: always writes workflow_runs + workflow_steps (real E2E)
  calcifer DB: scenario-dependent (see --scenario)

${colors.yellow('Scenarios')}
  ping             Minimal 2-step workflow, no calcifer DB (default)
  hourly-dry-run   Memory hourly entry with dryRun:true (reads users)

${colors.yellow('Examples')}
  bun run qworkflow:smoke
  bun run qworkflow:smoke -- --scenario hourly-dry-run --timeout 120
  ZXQSTASH_DATABASE_URL=postgres://... bun run qworkflow:smoke -- --cleanup

${colors.yellow('Manual cleanup (zxqstash DB)')}
  DELETE FROM workflow_steps WHERE workflow_run_id = '<id>';
  DELETE FROM workflow_runs WHERE id = '<id>';
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

  const scenarioRaw = getFlag('--scenario') ?? 'ping';
  if (scenarioRaw !== 'ping' && scenarioRaw !== 'hourly-dry-run') {
    console.error(colors.red(`Unknown scenario: ${scenarioRaw}`));
    process.exit(1);
  }

  const timeoutSec = Number(getFlag('--timeout') ?? '60');
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
    scenario: scenarioRaw,
    timeoutMs: timeoutSec * 1000,
    token,
    zxqstashUrl,
  };
}

async function triggerWorkflow(
  options: CliOptions,
  targetUrl: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${options.zxqstashUrl}/v1/workflows/runs`, {
    body: JSON.stringify({ body, url: targetUrl }),
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

interface WorkflowRunRow {
  completed_at: Date | null;
  current_step_index: number;
  id: string;
  status: string;
}

interface WorkflowStepRow {
  status: string;
  step_id: string;
  step_index: number;
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
        `SELECT id, status, current_step_index, completed_at
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
         ORDER BY step_index ASC`,
        [workflowRunId],
      );

      const terminal = ['completed', 'failed', 'cancelled'].includes(run.status);
      if (terminal) {
        return { run, steps: stepsResult.rows };
      }

      await sleep(2000);
    }

    throw new Error(`timed out after ${timeoutMs}ms waiting for workflow ${workflowRunId}`);
  } finally {
    await pool.end();
  }
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printCleanupSql(workflowRunId: string) {
  console.log(colors.dim('\nManual cleanup (zxqstash PostgreSQL):'));
  console.log(
    colors.dim(`  DELETE FROM workflow_steps WHERE workflow_run_id = '${workflowRunId}';`),
  );
  console.log(colors.dim(`  DELETE FROM workflow_runs WHERE id = '${workflowRunId}';`));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = SCENARIOS[options.scenario](options.appUrl);
  const targetUrl = `${options.appUrl}${scenario.path}`;

  console.log(colors.cyan('\n=== @ctrip/qworkflow smoke ===\n'));
  console.log(`  scenario:       ${options.scenario}`);
  console.log(`  target:         ${targetUrl}`);
  console.log(`  zxqstash:       ${options.zxqstashUrl}`);
  console.log(`  calcifer FX:    ${scenario.calciferSideEffects}`);
  console.log(`  zxqstash FX:    ${scenario.zxqstashSideEffects}`);
  console.log('');

  console.log(colors.yellow('[1/3] Triggering workflow...'));
  const workflowRunId = await triggerWorkflow(options, targetUrl, scenario.body);
  console.log(colors.green(`  workflowRunId: ${workflowRunId}`));

  if (!options.poll) {
    printCleanupSql(workflowRunId);
    console.log(
      colors.dim('\nPolling skipped (--no-poll). Check zxqstash logs for delivery status.\n'),
    );
    return;
  }

  console.log(colors.yellow('\n[2/3] Polling zxqstash DB...'));
  try {
    const { run, steps } = await pollWorkflowRun(workflowRunId, options.timeoutMs);

    console.log(colors.green(`  status: ${run.status}`));
    console.log(`  steps:  ${steps.length}`);
    for (const step of steps) {
      console.log(colors.dim(`    [${step.step_index}] ${step.step_id} (${step.status})`));
    }

    if (run.status !== 'completed') {
      console.error(colors.red(`\nSmoke failed: workflow ended with status "${run.status}"`));
      printCleanupSql(workflowRunId);
      process.exit(1);
    }

    console.log(colors.green('\n[3/3] Smoke passed'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ZXQSTASH_DATABASE_URL')) {
      console.log(colors.yellow(`  ${message}`));
      printCleanupSql(workflowRunId);
      return;
    }
    throw error;
  }

  if (options.cleanup) {
    console.log(colors.yellow('\n[cleanup] Removing zxqstash test rows...'));
    await cleanupWorkflowRun(workflowRunId);
  } else {
    printCleanupSql(workflowRunId);
  }

  console.log('');
}

main().catch((error) => {
  console.error(colors.red('\nSmoke error:'), error instanceof Error ? error.message : error);
  process.exit(1);
});
