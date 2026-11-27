import { describe, expect, it, vi } from 'vitest';

import { type PlanDocument, PlanExecutionRuntime, type PlanRuntimeService } from './index';

const makeDoc = (overrides: Partial<PlanDocument> = {}): PlanDocument => ({
  content: 'context',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  description: 'desc',
  id: 'plan-1',
  metadata: null,
  title: 'goal',
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

const createMockService = (overrides: Partial<PlanRuntimeService> = {}): PlanRuntimeService => ({
  createPlan: vi.fn().mockResolvedValue(makeDoc()),
  findPlanById: vi.fn().mockResolvedValue(makeDoc()),
  findPlanByTopic: vi.fn().mockResolvedValue(null),
  updatePlan: vi.fn().mockResolvedValue(makeDoc()),
  updatePlanMetadata: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('PlanExecutionRuntime', () => {
  describe('createPlan', () => {
    it('fails without a topicId', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.createPlan({ description: 'desc', goal: 'goal' }, {});

      expect(result.success).toBe(false);
      expect(service.createPlan).not.toHaveBeenCalled();
    });

    it('creates a plan document scoped to the topic', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.createPlan(
        { context: 'ctx', description: 'desc', goal: 'goal' },
        { topicId: 'topic-1' },
      );

      expect(service.createPlan).toHaveBeenCalledWith({
        content: 'ctx',
        description: 'desc',
        goal: 'goal',
        topicId: 'topic-1',
      });
      expect(result.success).toBe(true);
      expect(result.state?.plan.goal).toBe('goal');
    });

    it('stops without calling the service when the signal is already aborted', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);
      const controller = new AbortController();
      controller.abort();

      const result = await runtime.createPlan(
        { description: 'desc', goal: 'goal' },
        { signal: controller.signal, topicId: 'topic-1' },
      );

      expect(result.stop).toBe(true);
      expect(service.createPlan).not.toHaveBeenCalled();
    });
  });

  describe('updatePlan', () => {
    it('fails when the plan does not exist', async () => {
      const service = createMockService({ findPlanById: vi.fn().mockResolvedValue(null) });
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.updatePlan({ planId: 'missing' }, { topicId: 'topic-1' });

      expect(result.success).toBe(false);
      expect(result.content).toContain('missing');
      expect(service.updatePlan).not.toHaveBeenCalled();
    });

    it('updates the plan fields', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.updatePlan(
        { goal: 'new goal', planId: 'plan-1' },
        { topicId: 'topic-1' },
      );

      expect(service.updatePlan).toHaveBeenCalledWith(
        'plan-1',
        { content: undefined, description: undefined, goal: 'new goal' },
        'topic-1',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('todos', () => {
    it('uses currentTodos from context without querying the plan document', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.createTodos(
        { adds: ['New task'] },
        { currentTodos: [{ status: 'todo', text: 'Existing' }] },
      );

      expect(service.findPlanByTopic).not.toHaveBeenCalled();
      expect(result.state?.todos.items).toHaveLength(2);
    });

    it('falls back to reading todos from the plan document metadata when currentTodos is absent', async () => {
      const service = createMockService({
        findPlanByTopic: vi
          .fn()
          .mockResolvedValue(
            makeDoc({ metadata: { todos: { items: [{ status: 'todo', text: 'From plan' }] } } }),
          ),
      });
      const runtime = new PlanExecutionRuntime(service);

      const result = await runtime.createTodos({ adds: ['New task'] }, { topicId: 'topic-1' });

      expect(service.findPlanByTopic).toHaveBeenCalledWith('topic-1');
      expect(result.state?.todos.items).toHaveLength(2);
      expect(result.state?.todos.items[0].text).toBe('From plan');
    });

    it('syncs todos to the plan document metadata when a topicId is present', async () => {
      const service = createMockService({
        findPlanByTopic: vi.fn().mockResolvedValue(makeDoc({ metadata: { other: 'value' } })),
      });
      const runtime = new PlanExecutionRuntime(service);

      await runtime.createTodos({ adds: ['New task'] }, { currentTodos: [], topicId: 'topic-1' });

      expect(service.updatePlanMetadata).toHaveBeenCalledWith(
        'plan-1',
        expect.objectContaining({ other: 'value', todos: expect.any(Object) }),
      );
    });

    it('does not sync todos when there is no topicId', async () => {
      const service = createMockService();
      const runtime = new PlanExecutionRuntime(service);

      await runtime.createTodos({ adds: ['New task'] }, { currentTodos: [] });

      expect(service.findPlanByTopic).not.toHaveBeenCalled();
      expect(service.updatePlanMetadata).not.toHaveBeenCalled();
    });
  });
});
