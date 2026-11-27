// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentModel } from '@/database/models/agent';
import { BriefModel } from '@/database/models/brief';
import { TaskModel } from '@/database/models/task';
import { TaskTopicModel } from '@/database/models/taskTopic';
import { TopicModel } from '@/database/models/topic';
import { AiAgentService } from '@/server/services/aiAgent';
import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';
import { TaskLifecycleService } from '@/server/services/taskLifecycle';

import { buildTaskPrompt } from './buildTaskPrompt';
import { DEFAULT_AUTOMATION_HEARTBEAT_TIMEOUT, TaskRunnerService } from './index';

vi.mock('@/database/models/agent', () => ({ AgentModel: vi.fn() }));
vi.mock('@/database/models/brief', () => ({ BriefModel: vi.fn() }));
vi.mock('@/database/models/task', () => ({ TaskModel: vi.fn() }));
vi.mock('@/database/models/taskTopic', () => ({ TaskTopicModel: vi.fn() }));
vi.mock('@/database/models/topic', () => ({ TopicModel: vi.fn() }));
vi.mock('@/server/services/aiAgent', () => ({ AiAgentService: vi.fn() }));
vi.mock('@/server/services/taskLifecycle', () => ({ TaskLifecycleService: vi.fn() }));
vi.mock('@/server/services/queue/impls', () => ({ isQueueAgentRuntimeEnabled: vi.fn() }));
vi.mock('./buildTaskPrompt', () => ({ buildTaskPrompt: vi.fn() }));

describe('TaskRunnerService.runTask — heartbeatTimeout backfill', () => {
  const taskId = 'task-1';
  const userId = 'user-1';

  const mockTaskModel = {
    resolve: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    updateHeartbeat: vi.fn(),
    updateCurrentTopic: vi.fn(),
    incrementTopicCount: vi.fn(),
    updateTaskConfig: vi.fn(),
    getCheckpointConfig: vi.fn().mockReturnValue({}),
    getReviewConfig: vi.fn().mockReturnValue(null),
    getAgentModelConfig: vi.fn().mockResolvedValue(null),
  };
  const mockTaskTopicModel = { findByTaskId: vi.fn().mockResolvedValue([]), add: vi.fn() };
  const mockTopicModel = { updateMetadata: vi.fn() };
  const mockAgentModel = { getBuiltinAgent: vi.fn(), getAgentModelConfig: vi.fn() };
  const mockBriefModel = {};
  const mockLifecycle = {};
  const mockAiAgent = {
    execAgent: vi.fn().mockResolvedValue({
      assistantMessageId: 'msg_1',
      operationId: 'op_1',
      success: true,
      topicId: 'tpc_new',
    }),
  };

  const baseTask = (overrides: Partial<Record<string, unknown>> = {}) => ({
    assigneeAgentId: 'agt_x',
    automationMode: 'schedule',
    config: { model: 'gpt', provider: 'openai' },
    error: null,
    heartbeatTimeout: null,
    id: taskId,
    identifier: 'T-1',
    name: 'T-1',
    status: 'scheduled',
    totalTopics: 0,
    ...overrides,
  });

  const makeRunner = () => new TaskRunnerService({} as any, userId);

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskModel.getCheckpointConfig.mockReturnValue({});
    mockTaskModel.getReviewConfig.mockReturnValue(null);
    mockTaskModel.getAgentModelConfig.mockResolvedValue(null);
    mockTaskTopicModel.findByTaskId.mockResolvedValue([]);
    mockAiAgent.execAgent.mockResolvedValue({
      assistantMessageId: 'msg_1',
      operationId: 'op_1',
      success: true,
      topicId: 'tpc_new',
    });
    (TaskModel as any).mockImplementation(() => mockTaskModel);
    (TaskTopicModel as any).mockImplementation(() => mockTaskTopicModel);
    (TopicModel as any).mockImplementation(() => mockTopicModel);
    (AgentModel as any).mockImplementation(() => mockAgentModel);
    (BriefModel as any).mockImplementation(() => mockBriefModel);
    (TaskLifecycleService as any).mockImplementation(() => mockLifecycle);
    (AiAgentService as any).mockImplementation(() => mockAiAgent);
    (isQueueAgentRuntimeEnabled as any).mockReturnValue(false);
    (buildTaskPrompt as any).mockResolvedValue({ fileIds: [], prompt: 'do it' });
  });

  it('backfills a default watchdog timeout for a schedule task that has none', async () => {
    mockTaskModel.resolve.mockResolvedValue(baseTask({ heartbeatTimeout: null }));

    await makeRunner().runTask({ taskId });

    expect(mockTaskModel.update).toHaveBeenCalledWith(taskId, {
      heartbeatTimeout: DEFAULT_AUTOMATION_HEARTBEAT_TIMEOUT,
    });
  });

  it('does not override a user-configured heartbeatTimeout', async () => {
    mockTaskModel.resolve.mockResolvedValue(baseTask({ heartbeatTimeout: 120 }));

    await makeRunner().runTask({ taskId });

    const backfilled = mockTaskModel.update.mock.calls.some(
      ([, data]) => data && 'heartbeatTimeout' in data,
    );
    expect(backfilled).toBe(false);
  });

  it('does not backfill for non-automation (manual) tasks', async () => {
    mockTaskModel.resolve.mockResolvedValue(
      baseTask({ automationMode: null, heartbeatTimeout: null, status: 'pending' }),
    );

    await makeRunner().runTask({ taskId });

    const backfilled = mockTaskModel.update.mock.calls.some(
      ([, data]) => data && 'heartbeatTimeout' in data,
    );
    expect(backfilled).toBe(false);
  });
});
