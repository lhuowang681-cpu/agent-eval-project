import { serve } from '@ctrip/qworkflow/nextjs';
import debug from 'debug';

import { getServerDB } from '@/database/server';
import { qstashClient } from '@/libs/qstash';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { ResumeThreadTrajectoryPayload } from '@/server/workflows/agentEvalRun';

const log = debug('lobe-server:workflows:resume-thread-trajectory');

/**
 * Resume thread trajectory workflow — re-executes a single thread's agent trajectory.
 *
 * In the lobehub codebase this had a dedicated `executeResumedThreadTrajectory` method;
 * the current project only has `executeThreadTrajectory`, so we load the trajectory data
 * first and then delegate to the standard execution path.
 */
export const { POST } = serve<ResumeThreadTrajectoryPayload>(
  async (context) => {
    const payload = context.requestPayload ?? {};
    const { runId, testCaseId, threadId, topicId, userId } = payload;

    log('Starting: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

    if (!runId || !testCaseId || !threadId || !topicId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const db = await getServerDB();
    const service = new AgentEvalRunService(db, userId);

    // Load trajectory data (run + test case + env prompt)
    const data = await context.run('resume-thread-trajectory:load-data', () =>
      service.loadTrajectoryData(runId, testCaseId),
    );

    if ('error' in data) {
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    // Delegate to the standard executeThreadTrajectory path
    await context.run('resume-thread-trajectory:exec-agent', () =>
      service.executeThreadTrajectory({
        envPrompt,
        run,
        runId,
        testCase,
        testCaseId,
        threadId,
        topicId,
      }),
    );

    log(
      'Resumed thread agent started: runId=%s testCaseId=%s threadId=%s',
      runId,
      testCaseId,
      threadId,
    );

    return { success: true, testCaseId, threadId, topicId };
  },
  {
    flowControl: {
      key: 'agent-eval-run.resume-thread-trajectory',
      parallelism: 500,
      ratePerSecond: 20,
    },
    qstashClient,
  },
);
