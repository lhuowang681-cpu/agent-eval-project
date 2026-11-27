import debug from 'debug';
import { chunk } from 'es-toolkit/compat';

import {
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
  AgentEvalTestCaseModel,
} from '@/database/models/agentEval';
import { getServerDB } from '@/database/server';
import type { LobeChatDatabase } from '@/database/type';

import { AgentEvalRunService } from './index';
import type {
  ExecuteTestCasePayload,
  FinalizeRunPayload,
  OnThreadCompletePayload,
  OnTrajectoryCompletePayload,
  PaginateTestCasesPayload,
  RunAgentTrajectoryPayload,
  RunBenchmarkPayload,
  RunThreadTrajectoryPayload,
} from './types';

const log = debug('lobe-server:agent-eval-run:orchestrator');

const CHUNK_SIZE = 20;
const PAGE_SIZE = 50;

export class AgentEvalRunOrchestrator {
  private constructor(
    private readonly db: LobeChatDatabase,
    private readonly userId: string,
  ) {}

  static async create(userId: string) {
    return new AgentEvalRunOrchestrator(await getServerDB(), userId);
  }

  static async filterTestCasesNeedingExecution(
    db: LobeChatDatabase,
    params: { runId: string; testCaseIds: string[]; userId: string },
  ): Promise<string[]> {
    const { runId, testCaseIds, userId } = params;
    if (testCaseIds.length === 0) return [];

    const agentEvalRunTopicModel = new AgentEvalRunTopicModel(db, userId);
    const existingRunTopics = await agentEvalRunTopicModel.findByRunId(runId);

    const pendingTestCaseIds = new Set(
      existingRunTopics
        .filter((rt) => rt.status === 'pending')
        .map((rt: { testCaseId: string }) => rt.testCaseId),
    );

    return testCaseIds.filter((id) => pendingTestCaseIds.has(id));
  }

  async runBenchmark(payload: RunBenchmarkPayload) {
    const { runId, dryRun, force, userId } = payload;

    log('Starting runBenchmark: runId=%s dryRun=%s force=%s', runId, dryRun, force);

    if (!runId || !userId) {
      return { error: 'Missing runId or userId in payload', success: false };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (!run) {
      return { error: 'Run not found', success: false };
    }

    if (run.status === 'running' && !force) {
      return { error: 'Run is already running', success: false };
    }

    const testCaseModel = new AgentEvalTestCaseModel(this.db, userId);
    const allTestCases = await testCaseModel.findByDatasetId(run.datasetId);
    const allTestCaseIds = allTestCases.map((tc: { id: string }) => tc.id);

    log('Total test cases: %d', allTestCaseIds.length);

    if (allTestCaseIds.length === 0) {
      return {
        error: 'No test cases in dataset',
        success: false,
        totalTestCases: 0,
      };
    }

    const testCaseIds = await AgentEvalRunOrchestrator.filterTestCasesNeedingExecution(this.db, {
      runId,
      testCaseIds: allTestCaseIds,
      userId,
    });

    const result = {
      alreadyExecuted: allTestCaseIds.length - testCaseIds.length,
      runId,
      success: true,
      toExecute: testCaseIds.length,
      totalTestCases: allTestCaseIds.length,
    };

    log('Check result: %O', result);

    if (dryRun) {
      console.info('[run-benchmark] Dry run: %d test cases would execute', testCaseIds.length);
      return {
        ...result,
        dryRun: true,
        message: `[DryRun] Would execute ${testCaseIds.length} test cases`,
      };
    }

    if (testCaseIds.length === 0) {
      console.info('[run-benchmark] All test cases already executed for run %s', runId);
      return {
        ...result,
        message: 'All test cases already executed',
      };
    }

    await runModel.update(runId, {
      metrics: {
        averageScore: 0,
        failedCases: 0,
        passRate: 0,
        passedCases: 0,
        totalCases: allTestCaseIds.length,
      },
      startedAt: new Date(),
      status: 'running',
    });

    log('Triggering paginate-test-cases for run %s', runId);
    void this.paginateTestCases({ runId, userId });

    return {
      ...result,
      message: `Triggered pagination for ${testCaseIds.length} test cases`,
    };
  }

  async paginateTestCases(payload: PaginateTestCasesPayload) {
    const { runId, cursor, testCaseIds: payloadTestCaseIds, userId } = payload;

    log(
      'paginateTestCases: runId=%s cursor=%s testCaseIds=%d',
      runId,
      cursor,
      payloadTestCaseIds?.length ?? 0,
    );

    if (!runId || !userId) {
      return { error: 'Missing runId or userId in payload', success: false };
    }

    if (payloadTestCaseIds && payloadTestCaseIds.length > 0) {
      log('Processing fanout chunk: %d items', payloadTestCaseIds.length);

      await Promise.all(
        payloadTestCaseIds.map((testCaseId) => this.executeTestCase({ runId, testCaseId, userId })),
      );

      return {
        processedTestCases: payloadTestCaseIds.length,
        success: true,
      };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (run?.status === 'aborted') {
      log('Run aborted, skipping: runId=%s', runId);
      return { cancelled: true };
    }

    const testCaseModel = new AgentEvalTestCaseModel(this.db, userId);
    const allTestCases = run ? await testCaseModel.findByDatasetId(run.datasetId) : [];

    const startIndex = cursor
      ? allTestCases.findIndex((tc: { id: string }) => tc.id === cursor) + 1
      : 0;

    const page = allTestCases.slice(startIndex, startIndex + PAGE_SIZE);
    const batchTestCaseIds = page.map((tc: { id: string }) => tc.id);
    const nextCursor = page.length > 0 ? page.at(-1)?.id : undefined;

    log('Got batch: size=%d nextCursor=%s', batchTestCaseIds.length, nextCursor ?? 'none');

    if (batchTestCaseIds.length === 0) {
      log('No more test cases, pagination complete');
      return { message: 'Pagination complete', success: true };
    }

    const testCaseIds = await AgentEvalRunOrchestrator.filterTestCasesNeedingExecution(this.db, {
      runId,
      testCaseIds: batchTestCaseIds,
      userId,
    });

    log(
      'After filtering: need=%d skipped=%d',
      testCaseIds.length,
      batchTestCaseIds.length - testCaseIds.length,
    );

    if (testCaseIds.length > 0) {
      if (testCaseIds.length > CHUNK_SIZE) {
        const chunks = chunk(testCaseIds, CHUNK_SIZE);
        log('Fanout: %d chunks of %d', chunks.length, CHUNK_SIZE);

        await Promise.all(
          chunks.map((ids) => this.paginateTestCases({ runId, testCaseIds: ids, userId })),
        );
      } else {
        log('Processing %d test cases directly', testCaseIds.length);

        await Promise.all(
          testCaseIds.map((testCaseId) => this.executeTestCase({ runId, testCaseId, userId })),
        );
      }
    }

    if (nextCursor) {
      log('Scheduling next page with cursor %s', nextCursor);
      void this.paginateTestCases({ cursor: nextCursor, runId, userId });
    } else {
      log('Last page, pagination complete');
    }

    return {
      nextCursor: nextCursor ?? null,
      processedTestCases: testCaseIds.length,
      skippedTestCases: batchTestCaseIds.length - testCaseIds.length,
      success: true,
    };
  }

  async executeTestCase(payload: ExecuteTestCasePayload) {
    const { runId, testCaseId, userId } = payload;

    log('executeTestCase: runId=%s testCaseId=%s', runId, testCaseId);

    if (!runId || !testCaseId || !userId) {
      return { error: 'Missing runId, testCaseId, or userId', success: false };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (!run) {
      return { error: 'Run not found', success: false };
    }

    if (run.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return { cancelled: true };
    }

    const k = run.config?.k ?? 1;
    log('Executing: runId=%s testCaseId=%s k=%d', runId, testCaseId, k);

    await this.runAgentTrajectory({ runId, testCaseId, userId });

    return { k, success: true, testCaseId };
  }

  async runAgentTrajectory(payload: RunAgentTrajectoryPayload) {
    const { runId, testCaseId, userId } = payload;

    log('runAgentTrajectory: runId=%s testCaseId=%s', runId, testCaseId);

    if (!runId || !testCaseId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const service = new AgentEvalRunService(this.db, userId);
    const data = await service.loadTrajectoryData(runId, testCaseId);

    if ('error' in data) {
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    if (run.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return { cancelled: true };
    }

    const k = (run.config as { k?: number } | null)?.k ?? 1;

    if (k > 1) {
      const result = await service.executeMultiThreadTrajectory({
        k,
        onThread: (threadPayload) => this.runThreadTrajectory(threadPayload),
        run,
        runId,
        testCaseId,
      });

      log(
        'Multi-thread started: runId=%s testCaseId=%s k=%d threads=%d',
        runId,
        testCaseId,
        k,
        result.threadIds.length,
      );

      return {
        k,
        success: true,
        testCaseId,
        threadIds: result.threadIds,
        topicId: result.topicId,
      };
    }

    const result = await service.executeTrajectory({ envPrompt, run, runId, testCase, testCaseId });

    if ('error' in result) {
      const { allDone } = await service.recordTrajectoryCompletion({
        runId,
        status: 'error',
        telemetry: { completionReason: 'error', errorMessage: result.error as string },
        testCaseId,
      });

      if (allDone) {
        log('All test cases done after exec error, triggering finalize: runId=%s', runId);
        void this.finalizeRun({ runId, userId });
      }

      return { error: result.error, success: false, testCaseId };
    }

    log(
      'Agent started (async): runId=%s testCaseId=%s topicId=%s',
      runId,
      testCaseId,
      result.topicId,
    );

    return {
      success: true,
      testCaseId,
      topicId: result.topicId,
    };
  }

  async runThreadTrajectory(payload: RunThreadTrajectoryPayload) {
    const { runId, testCaseId, threadId, topicId, userId } = payload;

    log('runThreadTrajectory: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

    if (!runId || !testCaseId || !threadId || !topicId || !userId) {
      return { error: 'Missing required parameters', success: false };
    }

    const service = new AgentEvalRunService(this.db, userId);
    const data = await service.loadTrajectoryData(runId, testCaseId);

    if ('error' in data) {
      await service.recordThreadCompletion({
        runId,
        status: 'error',
        telemetry: { completionReason: 'error', errorMessage: data.error },
        testCaseId,
        threadId,
        topicId,
      });
      return { error: data.error, success: false };
    }

    const { run, testCase, envPrompt } = data;

    if (run.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);
      return { cancelled: true };
    }

    const result = await service.executeThreadTrajectory({
      envPrompt,
      run,
      runId,
      testCase,
      testCaseId,
      threadId,
      topicId,
    });

    if ('error' in result) {
      const { allRunDone } = await service.recordThreadCompletion({
        runId,
        status: 'error',
        telemetry: { completionReason: 'error', errorMessage: result.error },
        testCaseId,
        threadId,
        topicId,
      });

      if (allRunDone) {
        log('All test cases done after exec error, triggering finalize: runId=%s', runId);
        void this.finalizeRun({ runId, userId });
      }

      return { error: result.error, success: false, testCaseId, threadId };
    }

    log('Thread agent started: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);

    return { success: true, testCaseId, threadId, topicId };
  }

  async finalizeRun(payload: FinalizeRunPayload) {
    const { runId, userId } = payload;

    log('finalizeRun: runId=%s', runId);

    if (!runId || !userId) {
      return { error: 'Missing runId or userId', success: false };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (!run) {
      return { error: 'Run not found', success: false };
    }

    if (run.status === 'aborted') {
      log('Run aborted, skipping finalize: runId=%s', runId);
      return { cancelled: true };
    }

    if (run.status === 'completed' || run.status === 'failed') {
      return { alreadyFinalized: true, metrics: run.metrics, runId, success: true };
    }

    const runTopicModel = new AgentEvalRunTopicModel(this.db, userId);
    const runTopics = await runTopicModel.findByRunId(runId);

    log('Total RunTopics: %d', runTopics.length);

    const service = new AgentEvalRunService(this.db, userId);
    const metrics = await service.evaluateAndFinalizeRun({
      run: { config: run.config, id: runId, metrics: run.metrics, startedAt: run.startedAt },
      runTopics,
    });

    log('Metrics: %O', metrics);

    const nonSuccessCases = (metrics.errorCases || 0) + (metrics.timeoutCases || 0);
    const externalCount = metrics.externalCases || 0;
    const runStatus =
      externalCount > 0
        ? 'external'
        : nonSuccessCases >= metrics.totalCases
          ? 'failed'
          : 'completed';

    const finalized = await runModel.finalizeIfActive(runId, { metrics, status: runStatus });
    if (!finalized) {
      const current = await runModel.findById(runId);
      return {
        alreadyFinalized: true,
        cancelled: current?.status === 'aborted',
        metrics: current?.metrics,
        runId,
        success: true,
      };
    }

    console.info(
      `[finalize-run] Run ${runId} ${runStatus}: score=${metrics.averageScore.toFixed(2)} pass=${metrics.passedCases}/${metrics.totalCases} error=${metrics.errorCases || 0}`,
    );

    return {
      metrics,
      runId,
      success: true,
    };
  }

  async onTrajectoryComplete(payload: OnTrajectoryCompletePayload) {
    const {
      runId,
      testCaseId,
      userId,
      reason,
      status,
      cost,
      duration,
      errorDetail,
      errorMessage,
      llmCalls,
      steps,
      toolCalls,
      totalTokens,
    } = payload;

    if (!runId || !testCaseId || !userId) {
      return { error: 'Missing required fields', success: false };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (run?.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s', runId, testCaseId);
      return { cancelled: true };
    }

    const service = new AgentEvalRunService(this.db, userId);
    const { allDone, completedCount } = await service.recordTrajectoryCompletion({
      runId,
      status,
      telemetry: {
        completionReason: reason,
        cost,
        duration,
        errorDetail,
        errorMessage,
        llmCalls,
        steps,
        toolCalls,
        totalTokens,
      },
      testCaseId,
    });

    log('Completion check: %d completed, allDone=%s', completedCount, allDone);

    if (allDone) {
      console.info(
        '[on-trajectory-complete] All test cases done for run %s, triggering finalize',
        runId,
      );
      void this.finalizeRun({ runId, userId });
    }

    return { success: true };
  }

  async onThreadComplete(payload: OnThreadCompletePayload) {
    const {
      runId,
      testCaseId,
      threadId,
      topicId,
      userId,
      reason,
      status,
      cost,
      duration,
      errorMessage,
      llmCalls,
      steps,
      toolCalls,
      totalTokens,
    } = payload;

    if (!runId || !testCaseId || !threadId || !topicId || !userId) {
      return { error: 'Missing required fields', success: false };
    }

    const runModel = new AgentEvalRunModel(this.db, userId);
    const run = await runModel.findById(runId);

    if (run?.status === 'aborted') {
      log('Run aborted, skipping: runId=%s testCaseId=%s threadId=%s', runId, testCaseId, threadId);
      return { cancelled: true };
    }

    const service = new AgentEvalRunService(this.db, userId);
    const { allThreadsDone, allRunDone } = await service.recordThreadCompletion({
      runId,
      status,
      telemetry: {
        completionReason: reason,
        cost,
        duration,
        errorMessage,
        llmCalls,
        steps,
        toolCalls,
        totalTokens,
      },
      testCaseId,
      threadId,
      topicId,
    });

    log(
      'Thread completion: threadId=%s allThreadsDone=%s allRunDone=%s',
      threadId,
      allThreadsDone,
      allRunDone,
    );

    if (allRunDone) {
      console.info(
        '[on-thread-complete] All test cases done for run %s, triggering finalize',
        runId,
      );
      void this.finalizeRun({ runId, userId });
    }

    return { allRunDone, allThreadsDone, success: true };
  }
}
