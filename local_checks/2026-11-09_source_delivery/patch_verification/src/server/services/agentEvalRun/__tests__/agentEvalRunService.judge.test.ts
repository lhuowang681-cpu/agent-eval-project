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

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanupDB();
});

describe('eval judge integration (local mocked model runtime)', () => {
  for (const evalMode of ['llm-rubric', 'answer-relevance']) {
    for (const threaded of [false, true]) {
      for (const outcome of [
        'pass',
        'zero',
        'unconfigured',
        'provider-error',
        'invalid-score',
        'invalid-rubric',
      ] as const) {
        it(`${evalMode} ${threaded ? 'thread' : 'topic'}: ${outcome}`, async () => {
          const generateObject = vi
            .fn()
            .mockResolvedValue({ reason: 'checked', score: outcome === 'zero' ? 0 : 1 });
          if (outcome === 'provider-error')
            generateObject.mockRejectedValue(new Error('Synthetic judge unavailable'));
          if (outcome === 'invalid-score')
            generateObject.mockResolvedValue({ reason: 'bad', score: NaN });
          vi.mocked(initModelRuntimeFromDB).mockResolvedValue({ generateObject } as any);
          const chain = await setupEvalChain({
            assistantOutput: '42',
            datasetEvalConfig:
              outcome === 'unconfigured'
                ? {}
                : { criteria: 'Check arithmetic', model: 'synthetic-judge', provider: 'openai' },
            datasetEvalMode: outcome === 'invalid-rubric' ? null : evalMode,
            benchmarkRubrics:
              outcome === 'invalid-rubric'
                ? [
                    {
                      id: 'bad',
                      name: 'bad',
                      type: 'contains',
                      config: { value: '42' },
                      weight: -1,
                    },
                  ]
                : [],
            totalCases: 1,
          });
          const service = new AgentEvalRunService(serverDB, userId);
          if (threaded) {
            const thread = await new ThreadModel(serverDB, userId).create({
              topicId: chain.topic.id,
              type: 'eval',
            });
            await serverDB.insert(messages).values({
              content: '42',
              role: 'assistant',
              threadId: thread!.id,
              topicId: chain.topic.id,
              userId,
            });
            const completion = await service.recordThreadCompletion({
              runId: chain.run.id,
              status: 'done',
              telemetry: {},
              testCaseId: chain.testCase.id,
              threadId: thread!.id,
              topicId: chain.topic.id,
            });
            expect(completion.allRunDone).toBe(true);
          } else {
            const completion = await service.recordTrajectoryCompletion({
              runId: chain.run.id,
              status: 'done',
              telemetry: { completionReason: 'stop' },
              testCaseId: chain.testCase.id,
            });
            expect(completion.allDone).toBe(true);
          }
          const [topic] = await new AgentEvalRunTopicModel(serverDB, userId).findByRunId(
            chain.run.id,
          );
          const expectedStatus =
            outcome === 'pass' ? 'passed' : outcome === 'zero' ? 'failed' : 'error';
          expect(topic.status).toBe(expectedStatus);
          if (expectedStatus === 'error') expect(topic.evalResult?.error).toBeTruthy();
          const run = await new AgentEvalRunModel(serverDB, userId).findById(chain.run.id);
          expect(run?.metrics?.errorCases ?? 0).toBe(expectedStatus === 'error' ? 1 : 0);
          expect(run?.metrics?.failedCases ?? 0).toBe(outcome === 'zero' ? 1 : 0);
          if (outcome === 'pass' || outcome === 'zero') {
            expect(initModelRuntimeFromDB).toHaveBeenCalledWith(serverDB, userId, 'openai');
            expect(generateObject).toHaveBeenCalledWith(
              expect.objectContaining({
                model: 'synthetic-judge',
                schema: expect.objectContaining({ name: 'eval_judge_score' }),
              }),
              expect.objectContaining({ signal: expect.any(AbortSignal) }),
            );
          }
          if (outcome === 'unconfigured' || outcome === 'invalid-rubric')
            expect(generateObject).not.toHaveBeenCalled();
        });
      }
    }
  }
});
