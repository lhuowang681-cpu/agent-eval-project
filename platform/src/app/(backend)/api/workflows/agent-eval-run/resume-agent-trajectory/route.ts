import { serve } from '@ctrip/qworkflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeAgentTrajectoryPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:resume-agent-trajectory');

/**
 * Resume agent trajectory workflow — re-executes a single test case's agent trajectory.
 *
 * In the lobehub codebase this had a dedicated `executeResumedTrajectory` method;
 * the current project only has `executeTrajectory`, so we load the trajectory data
 * first and then delegate to the standard execution path.
 */
export const { POST } = serve<ResumeAgentTrajectoryPayload>(
  async (context) => {
    const payload = context.requestPayload ?? {};
    const { runId, testCaseId, userId } = payload;

    log('Starting: runId=%s testCaseId=%s', runId, testCaseId);

    if (!runId || !testCaseId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const db = await getServerDB();
    const service = new AgentEvalRunService(db, userId);

    // Load trajectory data (run + test case + env prompt)
    const data = await context.run('resume-agent-trajectory:load-data', () =>
      service.loadTrajectoryData(runId, testCaseId),
    );

    if ('error' in data) {
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    // Delegate to the standard executeTrajectory path
    await context.run('resume-agent-trajectory:exec-agent', () =>
      service.executeTrajectory({ envPrompt, run, runId, testCase, testCaseId }),
    );

    log('Resumed agent started (async): runId=%s testCaseId=%s', runId, testCaseId);

    return { success: true, testCaseId };
  },
  {
    flowControl: {
      key: 'agent-eval-run.resume-agent-trajectory',
      parallelism: 500,
      ratePerSecond: 20,
    },
    qstashClient,
  },
);
