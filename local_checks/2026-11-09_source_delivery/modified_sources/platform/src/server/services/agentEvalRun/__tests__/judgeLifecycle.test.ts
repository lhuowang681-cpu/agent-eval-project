import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { ThreadModel } from '@/database/models/thread';
import { messages } from '@/database/schemas';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ interruptOperation: vi.fn() })),
}));
const generate = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  generate.mockReset();
  vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ generateObject: generate } as any);
  await cleanupDB();
});

async function chainFor(
  threadCount: number,
  mode = 'llm-rubric',
  config: Record<string, unknown> = {},
) {
  const chain = await setupEvalChain({
    assistantOutput: '42',
    datasetEvalMode: mode,
    datasetEvalConfig: {
      model: 'synthetic-judge',
      provider: 'openai',
      criteria: 'Check arithmetic',
      ...config,
    },
    totalCases: 1,
  });
  const threadModel = new ThreadModel(serverDB, userId);
  const threadIds: string[] = [];
  for (let i = 0; i < threadCount; i++) {
    const thread = await threadModel.create({ topicId: chain.topic.id, type: 'eval' });
    threadIds.push(thread!.id);
    await serverDB.insert(messages).values({
      content: '42',
      role: 'assistant',
      threadId: thread!.id,
      topicId: chain.topic.id,
      userId,
    });
  }
  const service = new AgentEvalRunService(serverDB, userId);
  const model = new AgentEvalRunTopicModel(serverDB, userId);
  const complete = (index = 0) =>
    threadCount
      ? service.recordThreadCompletion({
          runId: chain.run.id,
          testCaseId: chain.testCase.id,
          topicId: chain.topic.id,
          threadId: threadIds[index],
          status: 'completed',
          telemetry: { completionReason: 'stop' },
        })
      : service.recordTrajectoryCompletion({
          runId: chain.run.id,
          testCaseId: chain.testCase.id,
          status: 'completed',
          telemetry: { completionReason: 'stop' },
        });
  return {
    ...chain,
    complete,
    model,
    service,
    threadIds,
    threadModel,
    read: () => model.findByRunAndTestCase(chain.run.id, chain.testCase.id),
  };
}

describe('Judge result provenance and late callback protection', () => {
  for (const threaded of [false, true]) {
    for (const outcome of ['empty-reason', 'binary-half', 'timeout', 'parse'] as const) {
      it(`${threaded ? 'thread' : 'topic'} classifies ${outcome} as scoring error`, async () => {
        if (outcome === 'timeout') generate.mockImplementation(() => new Promise(() => {}));
        else if (outcome === 'parse') {
          const error = new Error('synthetic');
          error.name = 'StructuredOutputParseError';
          generate.mockRejectedValue(error);
        } else
          generate.mockResolvedValue({
            score: outcome === 'binary-half' ? 0.5 : 1,
            reason: outcome === 'empty-reason' ? '' : 'synthetic',
          });
        const chain = await chainFor(
          threaded ? 1 : 0,
          outcome === 'binary-half' ? 'answer-relevance' : 'llm-rubric',
          { timeoutMs: 100 },
        );
        await chain.complete();
        const topic = await chain.read();
        expect(topic?.status).toBe('error');
        expect(topic?.evalResult?.scoringSource).toBe('llm');
        expect(topic?.evalResult?.errorCode).toBe(
          outcome === 'timeout'
            ? 'judge_timeout'
            : outcome === 'parse'
              ? 'judge_parse'
              : 'judge_invalid_result',
        );
        const run = await new AgentEvalRunModel(serverDB, userId).findById(chain.run.id);
        expect(run?.metrics?.errorCases).toBe(1);
        expect(run?.metrics?.failedCases).toBe(0);
      });
    }
    for (const status of ['timeout', 'error', 'passed', 'failed'] as const) {
      it(`${threaded ? 'thread' : 'topic'} does not overwrite ${status} with late Judge success or duplicate`, async () => {
        let finish!: (value: { score: number; reason: string }) => void;
        generate.mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        );
        const chain = await chainFor(threaded ? 1 : 0);
        const pending = chain.complete();
        await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
        await chain.model.updateByRunAndTopic(chain.run.id, chain.topic.id, {
          status,
          score: status === 'passed' ? 1 : 0,
          passed: status === 'passed',
          evalResult: {
            completionReason: 'frozen',
            ...(status === 'error' ? { error: 'Aborted' } : {}),
          },
        });
        const frozen = await chain.read();
        const frozenThread = threaded ? await chain.threadModel.findById(chain.threadIds[0]) : null;
        finish({ score: 1, reason: 'late synthetic answer' });
        await pending;
        await chain.complete();
        const final = await chain.read();
        expect(final?.status).toBe(frozen?.status);
        expect(final?.score).toBe(frozen?.score);
        expect(final?.evalResult).toEqual(frozen?.evalResult);
        if (threaded)
          expect((await chain.threadModel.findById(chain.threadIds[0]))?.metadata).toEqual(
            frozenThread?.metadata,
          );
        expect(generate).toHaveBeenCalledTimes(1);
      });
    }
    it(`${threaded ? 'thread' : 'topic'} retains the first result for concurrent duplicate callbacks`, async () => {
      const finishes: Array<(value: { score: number; reason: string }) => void> = [];
      generate.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishes.push(resolve);
          }),
      );
      const chain = await chainFor(threaded ? 1 : 0);
      const first = chain.complete();
      const second = chain.complete();
      await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
      finishes[0]({ score: 1, reason: 'first' });
      await first;
      const frozen = await chain.read();
      finishes[1]({ score: 0, reason: 'late duplicate' });
      await second;
      expect((await chain.read())?.evalResult).toEqual(frozen?.evalResult);
      expect((await chain.read())?.status).toBe('passed');
    });
  }
  for (const firstScore of [0, 1]) {
    it(`K=2 score=${firstScore} plus Judge failure preserves pass@k and per-thread diagnostics`, async () => {
      generate
        .mockResolvedValueOnce({ score: firstScore, reason: 'synthetic answer judgement' })
        .mockRejectedValueOnce(new Error('synthetic provider unavailable'));
      const chain = await chainFor(2);
      await chain.complete(0);
      await chain.complete(1);
      const topic = await chain.read();
      expect(topic?.status).toBe(firstScore ? 'passed' : 'error');
      expect(topic?.evalResult?.scoringSource).toBe('llm');
      expect(
        topic?.evalResult?.threads?.find((thread) => thread.threadId === chain.threadIds[1])
          ?.errorCode,
      ).toBe('judge_provider');
      expect(
        topic?.evalResult?.threads?.find((thread) => thread.threadId === chain.threadIds[1])
          ?.scoringSource,
      ).toBe('llm');
      expect(topic?.evalResult?.passAtK).toBe(Boolean(firstScore));
    });
  }
  it('retains whole case config override instead of silently inheriting missing credentials', async () => {
    const chain = await chainFor(0);
    const { agentEvalTestCases } = await import('@/database/schemas');
    const { eq } = await import('drizzle-orm');
    await serverDB
      .update(agentEvalTestCases)
      .set({ evalConfig: { judgePrompt: 'case-specific criterion' } })
      .where(eq(agentEvalTestCases.id, chain.testCase.id));
    await chain.complete();
    expect((await chain.read())?.evalResult?.errorCode).toBe('judge_config');
    expect(generate).not.toHaveBeenCalled();
  });
});
