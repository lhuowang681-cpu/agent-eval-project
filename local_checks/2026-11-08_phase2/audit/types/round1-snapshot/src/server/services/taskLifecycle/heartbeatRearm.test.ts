// @vitest-environment node
import type { TaskItem } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleHeartbeatTick } from '@/server/services/task/heartbeatBootstrap';

import { TaskLifecycleService } from './index';

vi.mock('@/server/services/task/heartbeatBootstrap', () => ({
  scheduleHeartbeatTick: vi.fn().mockResolvedValue(true),
}));

const baseTask = (overrides: Partial<TaskItem> = {}): TaskItem =>
  ({
    automationMode: 'heartbeat',
    config: {},
    context: {},
    error: null,
    heartbeatInterval: 30,
    heartbeatTimeout: 600,
    id: 'task-1',
    identifier: 'TASK-1',
    name: 'demo',
    status: 'paused',
    ...overrides,
  }) as unknown as TaskItem;

describe('TaskLifecycleService.maybeRearmHeartbeat', () => {
  let service: TaskLifecycleService;

  beforeEach(() => {
    vi.mocked(scheduleHeartbeatTick).mockClear().mockResolvedValue(true);
    service = new TaskLifecycleService({} as any, 'user-1');
  });

  const rearm = (task: TaskItem, reason: string) =>
    (service as any).maybeRearmHeartbeat(task, reason);

  it('delegates done reason to scheduleHeartbeatTick', async () => {
    await rearm(baseTask(), 'done');

    expect(scheduleHeartbeatTick).toHaveBeenCalledWith(
      { db: expect.anything(), userId: 'user-1' },
      baseTask(),
      { reason: 'done' },
    );
  });

  it('delegates error reason to scheduleHeartbeatTick', async () => {
    await rearm(baseTask(), 'error');

    expect(scheduleHeartbeatTick).toHaveBeenCalledWith(
      { db: expect.anything(), userId: 'user-1' },
      baseTask(),
      { reason: 'error' },
    );
  });

  it('maps interrupted reason to bootstrap semantics', async () => {
    await rearm(baseTask(), 'interrupted');

    expect(scheduleHeartbeatTick).toHaveBeenCalledWith(
      { db: expect.anything(), userId: 'user-1' },
      baseTask(),
      { reason: 'bootstrap' },
    );
  });
});
