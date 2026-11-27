import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel } from '@/database/models/agentEval';
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

beforeEach(async () => {
  await cleanupDB();
  mockExecAgent.mockReset();
});

describe('local completion finalizes an evaluation run', () => {
  it.each([false, true])(
    'finalizes three cases, concurrent callbacks=%s',
    async (concurrent: boolean) => {
      const { run, dataset, cases } = await setupMultiCaseRun(
        Array.from({ length: 3 }, () => ({ assistantOutput: '42', expected: '42' })),
        { datasetEvalMode: 'contains' },
      );
      const runModel = new AgentEvalRunModel(serverDB, userId);
      await runModel.update(run.id, { status: 'running', startedAt: new Date() });
      const callbacks: AgentHook[] = [];
      mockExecAgent.mockImplementation(async ({ hooks }: { hooks: AgentHook[] }) => {
        callbacks.push(hooks[0]);
        return { operationId: `operation-${callbacks.length}` };
      });
      const service = new AgentEvalRunService(serverDB, userId);
      for (const { testCase } of cases) {
        await service.executeTrajectory({
          run: { datasetId: dataset.id, targetAgentId: null },
          runId: run.id,
          testCase,
          testCaseId: testCase.id,
        });
      }
      const event = {
        agentId: 'local-agent',
        operationId: 'local-op',
        reason: 'done',
        status: 'done',
        userId,
      };
      if (concurrent) {
        await Promise.all(callbacks.map((hook) => hook.handler(event)));
      } else {
        await callbacks[0].handler(event);
        expect((await runModel.findById(run.id))?.status).toBe('running');
        await callbacks[1].handler(event);
        await callbacks[2].handler(event);
      }
      const completed = await runModel.findById(run.id);
      expect(completed?.status).toBe('completed');
      expect(completed?.metrics).toMatchObject({
        totalCases: 3,
        completedCases: 3,
        passedCases: 3,
        passRate: 1,
        averageScore: 1,
      });
      await callbacks[2].handler(event);
      const repeated = await runModel.findById(run.id);
      expect(repeated?.status).toBe('completed');
      expect(repeated?.metrics).toMatchObject({ passedCases: 3, passRate: 1, averageScore: 1 });
    },
  );
});
