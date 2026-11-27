// @vitest-environment node
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getTestDB } from '../../core/getTestDB';
import { agentOperations, users } from '../../schemas';
import type { LobeChatDatabase } from '../../type';
import { AgentOperationModel } from '../agentOperation';

const serverDB: LobeChatDatabase = await getTestDB();

const userId = 'agent-operation-model-test-user-id';

const agentOperationModel = new AgentOperationModel(serverDB, userId);

describe('AgentOperationModel', () => {
  beforeEach(async () => {
    await serverDB.delete(users);
    await serverDB.insert(users).values({ id: userId });
  });

  afterEach(async () => {
    await serverDB.delete(agentOperations);
    await serverDB.delete(users);
  });

  describe('recordStart / findById', () => {
    it('inserts a running row with the caller-supplied id', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });

      const row = await agentOperationModel.findById('op-1');
      expect(row?.status).toBe('running');
      expect(row?.userId).toBe(userId);
    });

    it('is idempotent for the same operation id', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });
      await agentOperationModel.recordStart({ id: 'op-1' });

      const rows = await serverDB
        .select()
        .from(agentOperations)
        .where(sql`${agentOperations.id} = 'op-1'`);
      expect(rows).toHaveLength(1);
    });

    it('records parentOperationId for sub-operations', async () => {
      await agentOperationModel.recordStart({ id: 'op-parent' });
      await agentOperationModel.recordStart({ id: 'op-child', parentOperationId: 'op-parent' });

      const child = await agentOperationModel.findById('op-child');
      expect(child?.parentOperationId).toBe('op-parent');
    });
  });

  describe('tryResumeFromAsyncTool (CAS)', () => {
    it('resumes and returns true when the operation is parked', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });
      await agentOperationModel.touchHeartbeat('op-1', { status: 'waiting_for_async_tool' });

      const won = await agentOperationModel.tryResumeFromAsyncTool('op-1');

      expect(won).toBe(true);
      const row = await agentOperationModel.findById('op-1');
      expect(row?.status).toBe('running');
    });

    it('returns false when the operation is not parked (already running)', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });

      const won = await agentOperationModel.tryResumeFromAsyncTool('op-1');

      expect(won).toBe(false);
    });

    it('only lets a single concurrent caller win the race', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });
      await agentOperationModel.touchHeartbeat('op-1', { status: 'waiting_for_async_tool' });

      const [first, second] = await Promise.all([
        agentOperationModel.tryResumeFromAsyncTool('op-1'),
        agentOperationModel.tryResumeFromAsyncTool('op-1'),
      ]);

      expect([first, second].filter(Boolean)).toHaveLength(1);
    });

    it("doesn't cross user boundaries", async () => {
      const otherUserId = 'agent-operation-model-test-user-id-2';
      await serverDB.insert(users).values({ id: otherUserId });
      const otherModel = new AgentOperationModel(serverDB, otherUserId);

      await agentOperationModel.recordStart({ id: 'op-1' });
      await agentOperationModel.touchHeartbeat('op-1', { status: 'waiting_for_async_tool' });

      const won = await otherModel.tryResumeFromAsyncTool('op-1');

      expect(won).toBe(false);
      await serverDB.delete(users).where(sql`${users.id} = ${otherUserId}`);
    });
  });

  describe('markTerminal', () => {
    it('marks an operation done', async () => {
      await agentOperationModel.recordStart({ id: 'op-1' });
      await agentOperationModel.markTerminal('op-1', 'done');

      const row = await agentOperationModel.findById('op-1');
      expect(row?.status).toBe('done');
    });
  });

  describe('findStuckOperations', () => {
    it('finds operations with a stale heartbeat', async () => {
      await agentOperationModel.recordStart({ id: 'op-stale' });
      await serverDB
        .update(agentOperations)
        .set({ lastHeartbeatAt: sql`now() - interval '1 hour'` })
        .where(sql`${agentOperations.id} = 'op-stale'`);

      await agentOperationModel.recordStart({ id: 'op-fresh' });
      await agentOperationModel.touchHeartbeat('op-fresh');

      const stuck = await AgentOperationModel.findStuckOperations(serverDB, 60_000);

      expect(stuck.map((r) => r.id)).toContain('op-stale');
      expect(stuck.map((r) => r.id)).not.toContain('op-fresh');
    });

    it('ignores operations without a heartbeat yet', async () => {
      await agentOperationModel.recordStart({ id: 'op-no-heartbeat' });

      const stuck = await AgentOperationModel.findStuckOperations(serverDB, 0);

      expect(stuck.map((r) => r.id)).not.toContain('op-no-heartbeat');
    });

    it('ignores terminal operations regardless of heartbeat age', async () => {
      await agentOperationModel.recordStart({ id: 'op-done' });
      await agentOperationModel.markTerminal('op-done', 'done');
      await serverDB
        .update(agentOperations)
        .set({ lastHeartbeatAt: sql`now() - interval '1 hour'` })
        .where(sql`${agentOperations.id} = 'op-done'`);

      const stuck = await AgentOperationModel.findStuckOperations(serverDB, 60_000);

      expect(stuck.map((r) => r.id)).not.toContain('op-done');
    });
  });
});
