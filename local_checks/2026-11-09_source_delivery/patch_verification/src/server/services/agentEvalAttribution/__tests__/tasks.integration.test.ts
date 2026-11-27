// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { asyncTasks, agentEvalRuns, agentEvalRunTopics, messages, users } from '@/database/schemas';
import {
  cleanupDB,
  serverDB,
  setupEvalChain,
  userId,
} from '@/server/services/agentEvalRun/__tests__/_setup';

import { AgentEvalAttributionService } from '..';
import { AttributionError } from '../contracts';
import type { Diagnostic, Trajectory } from '../contracts';
import { diagnosticFixture } from './fixtures';

beforeEach(cleanupDB);

async function failedCase() {
  const chain = await setupEvalChain({
    assistantOutput: 'Wrong answer',
    totalCases: 1,
    datasetEvalMode: 'contains',
  });
  await new AgentEvalRunModel(serverDB, userId).update(chain.run.id, {
    status: 'completed',
    metrics: { totalCases: 1, failedCases: 1, passedCases: 0, averageScore: 0, passRate: 0 },
  });
  await new AgentEvalRunTopicModel(serverDB, userId).updateByRunAndTopic(
    chain.run.id,
    chain.topic.id,
    {
      status: 'failed',
      score: 0,
      passed: false,
      evalResult: { operationId: 'original-operation', rubricScores: [] },
    },
  );
  return { chain, request: { runId: chain.run.id, caseId: chain.testCase.id } };
}
async function originalState() {
  return JSON.stringify({
    runs: await serverDB.select().from(agentEvalRuns),
    topics: await serverDB.select().from(agentEvalRunTopics),
    messages: await serverDB.select().from(messages),
  });
}
function service(runner = async (input: Trajectory) => diagnosticFixture(input)) {
  return new AgentEvalAttributionService(serverDB, userId, {
    runner,
    engineRevision: 'fixture-engine-v1',
  });
}

describe('independent durable attribution tasks', () => {
  it('deduplicates concurrent requests and processing, while preserving original scoring rows', async () => {
    const { request } = await failedCase();
    const before = await originalState();
    const runner = vi.fn(async (input: Trajectory) => diagnosticFixture(input));
    const instance = service(runner);
    const receipts = await Promise.all([instance.enqueue(request), instance.enqueue(request)]);
    expect(receipts[0].id).toBe(receipts[1].id);
    expect(receipts.filter((item) => item.created)).toHaveLength(1);
    const work = await Promise.all([
      instance.processJob(receipts[0].id),
      instance.processJob(receipts[0].id),
    ]);
    expect(work.filter((item) => item.claimed)).toHaveLength(1);
    expect(runner).toHaveBeenCalledTimes(1);
    const result = await instance.getJob(receipts[0].id);
    expect(result?.status).toBe('success');
    expect(result?.result?.diagnosis.status).toBe('unknown');
    expect(await originalState()).toBe(before);
    expect((await instance.processJob(receipts[0].id)).claimed).toBe(false);
    expect((await instance.getTrace(receipts[0].id)).scope.caseId).toBe(request.caseId);
  });

  it.each(['python_timeout', 'python_exit', 'python_spawn', 'python_contract'])(
    'persists %s independently and never changes the failed case',
    async (code) => {
      const { request } = await failedCase();
      const before = await originalState();
      const instance = service(async () => {
        throw new AttributionError(code, 'Controlled boundary failure');
      });
      const receipt = await instance.enqueue(request);
      await instance.processJob(receipt.id);
      expect(await instance.getJob(receipt.id)).toMatchObject({ status: 'error', error: { code } });
      expect(await originalState()).toBe(before);
    },
  );

  it('rejects a plausible analyzer output for a different source identity', async () => {
    const { request } = await failedCase();
    const before = await originalState();
    const instance = service(async (input) => ({
      ...diagnosticFixture(input),
      inputDigest: 'other-input',
    }));
    const receipt = await instance.enqueue(request);
    await instance.processJob(receipt.id);
    expect(await instance.getJob(receipt.id)).toMatchObject({
      status: 'error',
      error: { code: 'identity_mismatch' },
    });
    expect(await originalState()).toBe(before);
  });

  it('reclaims an expired lease and fences a late first attempt from overwriting its result', async () => {
    const { request } = await failedCase();
    let clock = new Date('2030-01-01T00:00:00Z');
    let release: (output: Diagnostic) => void = () => {
      throw new Error('First runner not started');
    };
    let started: () => void = () => {};
    const start = new Promise<void>((resolve) => {
      started = resolve;
    });
    let captured: Trajectory | undefined;
    const first = new AgentEvalAttributionService(serverDB, userId, {
      engineRevision: 'lease-test',
      now: () => clock,
      runner: async (input) => {
        captured = input;
        started();
        return new Promise<Diagnostic>((resolve) => {
          release = resolve;
        });
      },
    });
    const receipt = await first.enqueue(request);
    const pending = first.processJob(receipt.id);
    await start;
    clock = new Date(clock.getTime() + 60_000);
    const second = new AgentEvalAttributionService(serverDB, userId, {
      engineRevision: 'lease-test',
      now: () => clock,
      runner: async (input) => {
        const output = diagnosticFixture(input);
        output.diagnosis.summary = 'Second valid lease';
        return output;
      },
    });
    await second.processJob(receipt.id);
    const late = diagnosticFixture(captured!);
    late.diagnosis.summary = 'Stale first lease';
    release(late);
    expect((await pending).stale).toBe(true);
    expect((await second.getJob(receipt.id))?.result?.diagnosis.summary).toBe('Second valid lease');
  });

  it('recovers abandoned processing tasks from a later batch without reprocessing successful jobs', async () => {
    const { request } = await failedCase();
    const instance = service();
    const receipt = await instance.enqueue(request);
    await serverDB
      .update(asyncTasks)
      .set({ status: 'processing', updatedAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(asyncTasks.id, receipt.id));
    expect((await instance.processPending()).filter((item) => item.claimed)).toHaveLength(1);
    expect((await instance.getJob(receipt.id))?.status).toBe('success');
    expect(await instance.processPending()).toEqual([]);
  });

  it('keeps code revisions separate and refuses a changed engine for an already queued source', async () => {
    const { request } = await failedCase();
    const original = service();
    const first = await original.enqueue(request);
    const next = new AgentEvalAttributionService(serverDB, userId, {
      engineRevision: 'new-engine',
      runner: async (input) => diagnosticFixture(input),
    });
    const second = await next.enqueue(request);
    expect(first.id).not.toBe(second.id);
    await next.processJob(first.id);
    expect(await next.getJob(first.id)).toMatchObject({
      status: 'error',
      error: { code: 'engine_changed' },
    });
    await next.processJob(second.id);
    expect(await next.listForRun(request.runId)).toHaveLength(2);
  });

  it('enforces owner scope on jobs, raw evidence, listing and batch processing', async () => {
    const { request } = await failedCase();
    const receipt = await service().enqueue(request);
    await serverDB.insert(users).values({ id: 'other-diagnostic-user' });
    const foreign = new AgentEvalAttributionService(serverDB, 'other-diagnostic-user', {
      engineRevision: 'fixture-engine-v1',
    });
    expect(await foreign.getJob(receipt.id)).toBeUndefined();
    await expect(foreign.getTrace(receipt.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(foreign.listForRun(request.runId)).rejects.toMatchObject({ code: 'not_found' });
    expect((await foreign.processJob(receipt.id)).claimed).toBe(false);
    expect(await foreign.processPending()).toEqual([]);
    expect((await service().getJob(receipt.id))?.status).toBe('pending');
  });

  it('runs the actual Python rule adapter as a durable job for an unknown quality failure', async () => {
    const { request } = await failedCase();
    const before = await originalState();
    const instance = new AgentEvalAttributionService(serverDB, userId);
    const receipt = await instance.enqueue(request);
    await instance.processJob(receipt.id);
    const result = await instance.getJob(receipt.id);
    expect(result).toMatchObject({
      status: 'success',
      result: { diagnosis: { status: 'unknown' } },
    });
    expect(result?.result?.provenance.rulesVersion).toBe('round1-structured-v1');
    expect(await originalState()).toBe(before);
  });
});
