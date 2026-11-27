import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { watchdog } from './watchdog';

const mockFindStuckOperations = vi.fn();
const mockMarkTerminal = vi.fn();
vi.mock('@/database/models/agentOperation', () => ({
  AgentOperationModel: Object.assign(
    vi.fn().mockImplementation(() => ({
      markTerminal: (...args: unknown[]) => mockMarkTerminal(...args),
    })),
    { findStuckOperations: (...args: unknown[]) => mockFindStuckOperations(...args) },
  ),
}));

const mockFindById = vi.fn();
vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    findById: (...args: unknown[]) => mockFindById(...args),
  })),
}));

vi.mock('@/database/server', () => ({
  getServerDB: () => Promise.resolve({} as any),
}));

const mockCompleteSubAgentBridge = vi.fn();
vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    completeSubAgentBridge: (...args: unknown[]) => mockCompleteSubAgentBridge(...args),
  })),
}));

const buildContext = () => {
  const json = vi.fn((body: unknown, status?: number) => ({ body, status }));
  return { c: { json } as unknown as Context, json };
};

describe('agentOperation watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkTerminal.mockResolvedValue(undefined);
    mockCompleteSubAgentBridge.mockResolvedValue(true);
  });

  it('ignores stuck operations without a parentOperationId (top-level, out of scope)', async () => {
    mockFindStuckOperations.mockResolvedValue([
      { id: 'op-top-level', parentOperationId: null, threadId: 'thread-1', userId: 'user-1' },
    ]);

    const { c, json } = buildContext();
    await watchdog(c);

    expect(mockMarkTerminal).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ checked: 0, resolved: [], success: true });
  });

  it('marks a stuck child error and drives the completion bridge', async () => {
    mockFindStuckOperations.mockResolvedValue([
      {
        id: 'op-child-1',
        parentOperationId: 'op-parent-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
    ]);
    mockFindById.mockResolvedValue({ id: 'thread-1', sourceMessageId: 'tool-msg-1' });

    const { c, json } = buildContext();
    await watchdog(c);

    expect(mockMarkTerminal).toHaveBeenCalledWith('op-child-1', 'error');
    expect(mockCompleteSubAgentBridge).toHaveBeenCalledWith({
      operationId: 'op-child-1',
      parentOperationId: 'op-parent-1',
      reason: 'error',
      threadId: 'thread-1',
      toolMessageId: 'tool-msg-1',
    });
    expect(json).toHaveBeenCalledWith({ checked: 1, resolved: ['op-child-1'], success: true });
  });

  it('skips the bridge (but still marks terminal) when the thread has no sourceMessageId', async () => {
    mockFindStuckOperations.mockResolvedValue([
      {
        id: 'op-child-2',
        parentOperationId: 'op-parent-2',
        threadId: 'thread-2',
        userId: 'user-1',
      },
    ]);
    mockFindById.mockResolvedValue({ id: 'thread-2', sourceMessageId: null });

    const { c, json } = buildContext();
    await watchdog(c);

    expect(mockMarkTerminal).toHaveBeenCalledWith('op-child-2', 'error');
    expect(mockCompleteSubAgentBridge).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ checked: 1, resolved: [], success: true });
  });

  it('continues resolving other stuck children when one fails', async () => {
    mockFindStuckOperations.mockResolvedValue([
      { id: 'op-a', parentOperationId: 'parent-a', threadId: 'thread-a', userId: 'user-1' },
      { id: 'op-b', parentOperationId: 'parent-b', threadId: 'thread-b', userId: 'user-1' },
    ]);
    mockFindById
      .mockRejectedValueOnce(new Error('db error'))
      .mockResolvedValueOnce({ id: 'thread-b', sourceMessageId: 'tool-msg-b' });

    const { c, json } = buildContext();
    await watchdog(c);

    expect(json).toHaveBeenCalledWith({ checked: 2, resolved: ['op-b'], success: true });
  });

  it('returns a 500 with an error message when the top-level sweep throws', async () => {
    mockFindStuckOperations.mockRejectedValue(new Error('boom'));

    const { c, json } = buildContext();
    await watchdog(c);

    expect(json).toHaveBeenCalledWith({ error: 'boom' }, 500);
  });
});
