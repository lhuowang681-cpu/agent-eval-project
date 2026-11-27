import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { AgentEvalRunService } from '@/server/services/agentEvalRun';
import { AgentEvalRunOrchestrator } from '@/server/services/agentEvalRun/orchestrator';
import { cleanupDB, serverDB, setupEvalChain, userId } from './_setup';

vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/modules/ModelRuntime', () => ({ initModelRuntimeFromDB: vi.fn() }));
vi.mock('@/database/server', async () => {
  const { getTestDB } = await import('@/database/core/getTestDB');
  return { getServerDB: getTestDB };
});
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ interruptOperation: vi.fn() })),
}));
beforeEach(cleanupDB);
afterEach(() => vi.restoreAllMocks());

async function finalizable() {
  const chain = await setupEvalChain({
    assistantOutput: '42',
    datasetEvalMode: 'contains',
    totalCases: 1,
  });
  const model = new AgentEvalRunModel(serverDB, userId);
  const topicModel = new AgentEvalRunTopicModel(serverDB, userId);
  await model.update(chain.run.id, { status: 'running', startedAt: new Date(Date.now() - 1000) });
  await new AgentEvalRunService(serverDB, userId).recordTrajectoryCompletion({
    runId: chain.run.id,
    testCaseId: chain.testCase.id,
    telemetry: { completionReason: 'stop' },
  });
  return {
    ...chain,
    model,
    topicModel,
    orchestrator: await AgentEvalRunOrchestrator.create(userId),
  };
}

describe('run finalization idempotency', () => {
  it('keeps completed metrics and duration on a delayed sequential duplicate', async () => {
    const chain = await finalizable();
    await chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    const frozen = await chain.model.findById(chain.run.id);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    await chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    const repeated = await chain.model.findById(chain.run.id);
    expect(repeated?.status).toBe('completed');
    expect(repeated?.metrics).toEqual(frozen?.metrics);
    expect(repeated?.updatedAt).toEqual(frozen?.updatedAt);
  });
  it.each(['failed', 'aborted'] as const)('preserves already terminal %s', async (status) => {
    const chain = await finalizable();
    await chain.model.update(chain.run.id, { status });
    const frozen = await chain.model.findById(chain.run.id);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    await chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    const repeated = await chain.model.findById(chain.run.id);
    expect(repeated?.status).toBe(status);
    expect(repeated?.metrics).toEqual(frozen?.metrics);
  });
  it('atomically keeps the first finalization when two callbacks computed different durations', async () => {
    const chain = await finalizable();
    const original = AgentEvalRunService.prototype.evaluateAndFinalizeRun;
    const releases: Array<() => void> = [];
    vi.spyOn(AgentEvalRunService.prototype, 'evaluateAndFinalizeRun').mockImplementation(
      async function (this: AgentEvalRunService, params) {
        const result = await original.call(this, params);
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return result;
      },
    );
    const first = chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30_000);
    const second = chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await first;
    const frozen = await chain.model.findById(chain.run.id);
    releases[1]();
    await second;
    expect((await chain.model.findById(chain.run.id))?.metrics).toEqual(frozen?.metrics);
  });
  it('does not overwrite an abort which arrives after metrics calculation', async () => {
    const chain = await finalizable();
    const original = AgentEvalRunService.prototype.evaluateAndFinalizeRun;
    let release!: () => void;
    vi.spyOn(AgentEvalRunService.prototype, 'evaluateAndFinalizeRun').mockImplementation(
      async function (this: AgentEvalRunService, params) {
        const result = await original.call(this, params);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return result;
      },
    );
    const pending = chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await chain.model.update(chain.run.id, { status: 'aborted' });
    const frozen = await chain.model.findById(chain.run.id);
    release();
    await pending;
    expect((await chain.model.findById(chain.run.id))?.status).toBe('aborted');
    expect((await chain.model.findById(chain.run.id))?.metrics).toEqual(frozen?.metrics);
  });
  it.each(['external', 'running'] as const)(
    'allows valid %s to finalize after external scoring or retry',
    async (status) => {
      const chain = await finalizable();
      await chain.model.update(chain.run.id, { status });
      await chain.orchestrator.finalizeRun({ runId: chain.run.id, userId });
      expect((await chain.model.findById(chain.run.id))?.status).toBe('completed');
    },
  );
});
