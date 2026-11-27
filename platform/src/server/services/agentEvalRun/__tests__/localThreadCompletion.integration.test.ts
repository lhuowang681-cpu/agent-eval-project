import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentEvalDatasetModel,
  AgentEvalRunModel,
  AgentEvalRunTopicModel,
} from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messages } from '@/database/schemas';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import type { AgentHook } from '@/server/services/agentRuntime/hooks/types';
import { cleanupDB, serverDB, setupMultiCaseRun, userId } from './_setup';

const { mockExecAgent } = vi.hoisted(() => ({ mockExecAgent: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({
  AiAgentService: vi.fn().mockImplementation(() => ({ execAgent: mockExecAgent })),
}));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/database/server', async () => {
  const { getTestDB } = await import('@/database/core/getTestDB');
  return { getServerDB: getTestDB };
});
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ interruptOperation: vi.fn() })),
}));
const event = {
  agentId: 'local-agent',
  operationId: 'local-op',
  reason: 'done',
  status: 'done',
  userId,
};
beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
  vi.mocked(initModelRuntimeFromDB).mockResolvedValue({
    generateObject: vi.fn().mockResolvedValue({ score: 1, reason: 'synthetic judge fixture' }),
  } as any);
});

describe('local K=2 completion hook finalizes run', () => {
  it.each(['first', 'last', 'both'] as const)(
    'terminates K2 when startup failure arrives %s',
    async (failure) => {
      const { run, dataset, cases } = await setupMultiCaseRun([{ expected: '42' }], {
        datasetEvalMode: 'contains',
      });
      const model = new AgentEvalRunModel(serverDB, userId);
      await model.update(run.id, { status: 'running', startedAt: new Date(), config: { k: 2 } });
      let executions = 0;
      mockExecAgent.mockImplementation(
        async ({
          hooks,
          appContext,
        }: {
          hooks: AgentHook[];
          appContext: { topicId: string; threadId: string };
        }) => {
          const order = executions++;
          if (
            failure === 'both' ||
            (failure === 'first' && order === 0) ||
            (failure === 'last' && order === 1)
          )
            throw new Error('Synthetic startup failure');
          await serverDB
            .insert(messages)
            .values({ content: '42', role: 'assistant', ...appContext, userId });
          await hooks[0].handler(event);
          return { operationId: 'synthetic' };
        },
      );
      const service = new AgentEvalRunService(serverDB, userId);
      let releaseFirst!: () => void;
      const firstFinished = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let dispatched = 0;
      await service.executeMultiThreadTrajectory({
        k: 2,
        run: { datasetId: dataset.id },
        runId: run.id,
        testCaseId: cases[0].testCase.id,
        onThread: async (payload) => {
          const order = dispatched++;
          if (order > 0) await firstFinished;
          try {
            return await service.executeThreadTrajectory({
              ...payload,
              run: {},
              testCase: cases[0].testCase,
            });
          } finally {
            if (order === 0) releaseFirst();
          }
        },
      });
      const final = await model.findById(run.id);
      expect(final?.status).toBe(failure === 'both' ? 'failed' : 'completed');
      expect(final?.metrics).toMatchObject({
        totalCases: 1,
        completedCases: 1,
        errorCases: failure === 'both' ? 1 : 0,
        passedCases: failure === 'both' ? 0 : 1,
      });
    },
  );
  it.each([false, true])(
    'keeps existing pending metadata when operationId arrives, threaded=%s',
    async (threaded) => {
      const { run, dataset, cases } = await setupMultiCaseRun([{ expected: '42' }], {
        datasetEvalMode: 'contains',
      });
      const topicModel = new AgentEvalRunTopicModel(serverDB, userId);
      const threadModel = new ThreadModel(serverDB, userId);
      mockExecAgent.mockImplementation(
        async ({ appContext }: { appContext: { topicId: string; threadId?: string } }) => {
          if (threaded)
            await threadModel.update(appContext.threadId!, {
              metadata: { traceMarker: 'preserve-existing' },
            });
          else
            await topicModel.updateByRunAndTopic(run.id, appContext.topicId, {
              evalResult: { duration: 123 },
            });
          return { operationId: 'synthetic-operation' };
        },
      );
      const service = new AgentEvalRunService(serverDB, userId);
      if (threaded) {
        const result = await service.executeMultiThreadTrajectory({
          k: 2,
          run: { datasetId: dataset.id },
          runId: run.id,
          testCaseId: cases[0].testCase.id,
          onThread: (payload) =>
            service.executeThreadTrajectory({ ...payload, run: {}, testCase: cases[0].testCase }),
        });
        for (const id of result.threadIds)
          expect((await threadModel.findById(id))?.metadata).toMatchObject({
            traceMarker: 'preserve-existing',
            operationId: 'synthetic-operation',
          });
      } else {
        await service.executeTrajectory({
          run: { datasetId: dataset.id },
          runId: run.id,
          testCaseId: cases[0].testCase.id,
          testCase: cases[0].testCase,
        });
        expect(
          (await topicModel.findByRunAndTestCase(run.id, cases[0].testCase.id))?.evalResult,
        ).toMatchObject({ duration: 123, operationId: 'synthetic-operation' });
      }
    },
  );
  it('retains K1 scoring when execAgent resolves after onComplete', async () => {
    const { run, dataset, cases } = await setupMultiCaseRun(
      [{ expected: '42', assistantOutput: '42' }],
      { datasetEvalMode: 'contains' },
    );
    await new AgentEvalRunModel(serverDB, userId).update(run.id, {
      status: 'running',
      startedAt: new Date(),
    });
    mockExecAgent.mockImplementation(async ({ hooks }: { hooks: AgentHook[] }) => {
      await hooks[0].handler(event);
      return { operationId: 'delayed-operation-id' };
    });
    await new AgentEvalRunService(serverDB, userId).executeTrajectory({
      run: { datasetId: dataset.id },
      runId: run.id,
      testCase: cases[0].testCase,
      testCaseId: cases[0].testCase.id,
    });
    const topic = await new AgentEvalRunTopicModel(serverDB, userId).findByRunAndTestCase(
      run.id,
      cases[0].testCase.id,
    );
    expect(topic?.evalResult).toMatchObject({
      scoringSource: 'rule',
      rubricScores: [expect.objectContaining({ score: 1 })],
    });
  });
  for (const evalMode of ['contains', 'llm-rubric']) {
    for (const concurrent of [false, true]) {
      it(`${evalMode}: three cases, concurrent callbacks=${concurrent}`, async () => {
        const { run, dataset, cases } = await setupMultiCaseRun(
          Array.from({ length: 3 }, () => ({ expected: '42' })),
          { datasetEvalMode: evalMode },
        );
        await new AgentEvalDatasetModel(serverDB, userId).update(dataset.id, {
          evalConfig: { model: 'synthetic', provider: 'openai', criteria: 'arithmetic' },
        });
        const runModel = new AgentEvalRunModel(serverDB, userId);
        await runModel.update(run.id, {
          status: 'running',
          startedAt: new Date(),
          config: { k: 2 },
        });
        const callbacks: AgentHook[] = [];
        mockExecAgent.mockImplementation(
          async ({
            hooks,
            appContext,
          }: {
            hooks: AgentHook[];
            appContext: { threadId: string; topicId: string };
          }) => {
            await serverDB.insert(messages).values({
              content: '42',
              role: 'assistant',
              topicId: appContext.topicId,
              threadId: appContext.threadId,
              userId,
            });
            callbacks.push(hooks[0]);
            return { operationId: `local-${callbacks.length}` };
          },
        );
        const service = new AgentEvalRunService(serverDB, userId);
        for (const { testCase } of cases) {
          await service.executeMultiThreadTrajectory({
            k: 2,
            run: { datasetId: dataset.id },
            runId: run.id,
            testCaseId: testCase.id,
            onThread: (payload) =>
              service.executeThreadTrajectory({ ...payload, run: {}, testCase }),
          });
        }
        expect(callbacks).toHaveLength(6);
        if (concurrent) await Promise.all(callbacks.map((hook) => hook.handler(event)));
        else {
          for (const hook of callbacks.slice(0, 5)) await hook.handler(event);
          expect((await runModel.findById(run.id))?.status).toBe('running');
          await callbacks[5].handler(event);
        }
        const completed = await runModel.findById(run.id);
        expect(completed?.status).toBe('completed');
        expect(completed?.metrics).toMatchObject({
          totalCases: 3,
          completedCases: 3,
          passedCases: 3,
          averageScore: 1,
          passRate: 1,
          passAtK: 1,
          passAllK: 1,
        });
      });
    }
  }
  it('retains completed thread metadata when execAgent resolves after onComplete', async () => {
    const { run, dataset, cases } = await setupMultiCaseRun([{ expected: '42' }], {
      datasetEvalMode: 'contains',
    });
    const runModel = new AgentEvalRunModel(serverDB, userId);
    await runModel.update(run.id, { status: 'running', startedAt: new Date(), config: { k: 2 } });
    mockExecAgent.mockImplementation(
      async ({
        hooks,
        appContext,
      }: {
        hooks: AgentHook[];
        appContext: { threadId: string; topicId: string };
      }) => {
        await serverDB
          .insert(messages)
          .values({ content: '42', role: 'assistant', ...appContext, userId });
        await hooks[0].handler(event);
        return { operationId: 'delayed-operation-id' };
      },
    );
    const service = new AgentEvalRunService(serverDB, userId);
    const result = await service.executeMultiThreadTrajectory({
      k: 2,
      run: { datasetId: dataset.id },
      runId: run.id,
      testCaseId: cases[0].testCase.id,
      onThread: (payload) =>
        service.executeThreadTrajectory({ ...payload, run: {}, testCase: cases[0].testCase }),
    });
    for (const threadId of result.threadIds) {
      expect((await new ThreadModel(serverDB, userId).findById(threadId))?.metadata).toMatchObject({
        passed: true,
        score: 1,
        completedAt: expect.any(String),
      });
    }
    expect((await runModel.findById(run.id))?.status).toBe('completed');
  });
});
