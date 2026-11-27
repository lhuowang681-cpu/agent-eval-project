// @vitest-environment node
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTestDB } from '@/database/core/getTestDB';
import { AgentEvalRunModel, AgentEvalRunTopicModel } from '@/database/models/agentEval';
import { agents, topics, users } from '@/database/schemas';
import {
  cleanupDB,
  setupMultiCaseRun,
  userId,
} from '@/server/services/agentEvalRun/__tests__/_setup';

import { agentEvalRouter } from '../../agentEval';
import { createTestContext } from './setup';

vi.mock('@/database/core/db-adaptor', () => ({ getServerDB: getTestDB }));
vi.mock('@/server/services/file', () => ({ FileService: vi.fn() }));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({ interruptOperation: vi.fn() })),
}));

const serverDB = await getTestDB();
beforeEach(cleanupDB);

async function createInbox(ownerId: string, model: string) {
  const [agent] = await serverDB
    .insert(agents)
    .values({
      model,
      provider: 'openai',
      slug: 'inbox',
      systemRole: `${model} instructions`,
      userId: ownerId,
      virtual: true,
    })
    .returning();
  return agent;
}

describe('evaluation default Inbox alias through tRPC', () => {
  it('creates a run and topics using the current user real Inbox id and config snapshot', async () => {
    const { dataset } = await setupMultiCaseRun([{ expected: '42' }]);
    await serverDB.insert(users).values({ id: 'other-inbox-user' });
    await createInbox('other-inbox-user', 'other-model');
    const ownInbox = await createInbox(userId, 'own-model');
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const run = await caller.createRun({ datasetId: dataset.id, targetAgentId: 'inbox' });
    expect(run.targetAgentId).toBe(ownInbox.id);
    expect(run.config?.agentSnapshot).toMatchObject({
      model: 'own-model',
      systemRole: 'own-model instructions',
    });
    const links = await new AgentEvalRunTopicModel(serverDB, userId).findByRunId(run.id);
    expect(links).toHaveLength(1);
    const [topic] = await serverDB.select().from(topics).where(eq(topics.id, links[0].topicId));
    expect(topic.agentId).toBe(ownInbox.id);
  });

  it('uses the existing builtin resolver when Inbox has not been persisted yet', async () => {
    const { dataset } = await setupMultiCaseRun([]);
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const run = await caller.createRun({ datasetId: dataset.id, targetAgentId: 'inbox' });
    const [persisted] = await serverDB.select().from(agents).where(eq(agents.userId, userId));
    expect(persisted.slug).toBe('inbox');
    expect(run.targetAgentId).toBe(persisted.id);
  });

  it('resolves the same alias on update and preserves omitted and null target semantics', async () => {
    const { run } = await setupMultiCaseRun([]);
    const ownInbox = await createInbox(userId, 'own-model');
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    await caller.updateRun({ id: run.id, targetAgentId: 'inbox' });
    const model = new AgentEvalRunModel(serverDB, userId);
    expect((await model.findById(run.id))?.targetAgentId).toBe(ownInbox.id);
    await caller.updateRun({ id: run.id, name: 'renamed' });
    expect((await model.findById(run.id))?.targetAgentId).toBe(ownInbox.id);
    await caller.updateRun({ id: run.id, targetAgentId: null });
    expect((await model.findById(run.id))?.targetAgentId).toBeNull();
  });

  it('keeps explicit real agent ids unchanged', async () => {
    const { dataset } = await setupMultiCaseRun([]);
    const agent = await createInbox(userId, 'explicit-model');
    const caller = agentEvalRouter.createCaller(createTestContext(userId));
    const run = await caller.createRun({ datasetId: dataset.id, targetAgentId: agent.id });
    expect(run.targetAgentId).toBe(agent.id);
    expect(run.config?.agentSnapshot?.model).toBe('explicit-model');
  });
});
