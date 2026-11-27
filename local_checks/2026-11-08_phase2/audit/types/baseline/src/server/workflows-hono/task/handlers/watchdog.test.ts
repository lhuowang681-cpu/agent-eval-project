// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

import { watchdog } from './watchdog';

vi.mock('@/database/server', () => ({ getServerDB: vi.fn().mockResolvedValue({}) }));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));

describe('task watchdog', () => {
  const mockTaskModel = { updateStatus: vi.fn() };
  const mockBriefModel = { create: vi.fn() };
  const mockLifecycle = { onTopicComplete: vi.fn() };
  const findStuckTasks = vi.fn();

  // Minimal hono Context stub — only c.json is used.
  const ctx = { json: vi.fn((body: unknown, status?: number) => ({ body, status })) } as any;

  const baseTask = (overrides: Partial<Record<string, unknown>> = {}) => ({
    assigneeAgentId: 'agt_x',
    automationMode: 'schedule',
    createdByUserId: 'user-1',
    currentTopicId: 'tpc_1',
    heartbeatTimeout: 1800,
    id: 'task-1',
    identifier: 'T-1',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskModel as any).findStuckTasks = findStuckTasks;
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskLifecycleService as any).mockImplementation(() => mockLifecycle);
  });

  it('recovers a stuck schedule task via the interrupted lifecycle path (no fail)', async () => {
    findStuckTasks.mockResolvedValue([baseTask({ automationMode: 'schedule' })]);

    const res = await watchdog(ctx);

    expect(mockLifecycle.onTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'interrupted', taskId: 'task-1', topicId: 'tpc_1' }),
    );
    // must NOT fail the task — that would kill the schedule
    expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ failed: [], recovered: ['T-1'] });
  });

  it('recovers a stuck heartbeat task the same way', async () => {
    findStuckTasks.mockResolvedValue([baseTask({ automationMode: 'heartbeat' })]);

    await watchdog(ctx);

    expect(mockLifecycle.onTopicComplete).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'interrupted' }),
    );
    expect(mockTaskModel.updateStatus).not.toHaveBeenCalled();
  });

  it('fails a stuck manual task and raises an urgent brief', async () => {
    findStuckTasks.mockResolvedValue([baseTask({ automationMode: null })]);

    const res = await watchdog(ctx);

    expect(mockLifecycle.onTopicComplete).not.toHaveBeenCalled();
    expect(mockTaskModel.updateStatus).toHaveBeenCalledWith('task-1', 'failed', {
      completedAt: expect.any(Date),
      error: 'Heartbeat timeout',
    });
    expect(mockBriefModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 'urgent', type: 'error' }),
    );
    expect(res.body).toMatchObject({ failed: ['T-1'], recovered: [] });
  });

  it('handles a mixed batch', async () => {
    findStuckTasks.mockResolvedValue([
      baseTask({ automationMode: 'schedule', id: 'task-a', identifier: 'A' }),
      baseTask({ automationMode: null, id: 'task-b', identifier: 'B' }),
    ]);

    const res = await watchdog(ctx);

    expect(mockLifecycle.onTopicComplete).toHaveBeenCalledTimes(1);
    expect(mockTaskModel.updateStatus).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({ checked: 2, failed: ['B'], recovered: ['A'] });
  });
});
