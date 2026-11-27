import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerTaskCommand } from './task';

const { mockTrpcClient } = vi.hoisted(() => ({
  mockTrpcClient: {
    task: {
      create: { mutate: vi.fn() },
      update: { mutate: vi.fn() },
    },
  },
}));

const { getTrpcClient: mockGetTrpcClient } = vi.hoisted(() => ({
  getTrpcClient: vi.fn(),
}));

vi.mock('../api/client', () => ({ getTrpcClient: mockGetTrpcClient }));
vi.mock('../utils/logger', () => ({
  log: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  setVerbose: vi.fn(),
}));

describe('task command', () => {
  beforeEach(() => {
    mockGetTrpcClient.mockResolvedValue(mockTrpcClient);
    mockTrpcClient.task.create.mutate.mockReset();
    mockTrpcClient.task.update.mutate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerTaskCommand(program);
    return program;
  }

  describe('create', () => {
    it('should map --schedule/--timezone to schedulePattern/scheduleTimezone + automationMode=schedule', async () => {
      mockTrpcClient.task.create.mutate.mockResolvedValue({
        data: { identifier: 'T-1', name: 'News' },
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'task',
        'create',
        '-i',
        'Fetch news',
        '--schedule',
        '0 8 * * *',
        '--timezone',
        'Asia/Shanghai',
      ]);

      expect(mockTrpcClient.task.create.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          automationMode: 'schedule',
          instruction: 'Fetch news',
          schedulePattern: '0 8 * * *',
          scheduleTimezone: 'Asia/Shanghai',
        }),
      );
    });

    it('should not set automationMode when no schedule/heartbeat given', async () => {
      mockTrpcClient.task.create.mutate.mockResolvedValue({
        data: { identifier: 'T-2' },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'task', 'create', '-i', 'Plain']);

      const call = mockTrpcClient.task.create.mutate.mock.calls[0][0];
      expect(call.automationMode).toBeUndefined();
      expect(call.schedulePattern).toBeUndefined();
    });
  });

  describe('edit', () => {
    it('should map --schedule to schedulePattern + automationMode=schedule', async () => {
      mockTrpcClient.task.update.mutate.mockResolvedValue({
        data: { identifier: 'T-1' },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', 'task', 'edit', 'T-1', '--schedule', '0 8 * * *']);

      expect(mockTrpcClient.task.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          automationMode: 'schedule',
          id: 'T-1',
          schedulePattern: '0 8 * * *',
        }),
      );
    });

    it('should clear automation + schedule when --automation-mode none', async () => {
      mockTrpcClient.task.update.mutate.mockResolvedValue({
        data: { identifier: 'T-1' },
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'task',
        'edit',
        'T-1',
        '--automation-mode',
        'none',
      ]);

      expect(mockTrpcClient.task.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          automationMode: null,
          id: 'T-1',
          schedulePattern: null,
        }),
      );
    });

    it('should set automationMode=heartbeat when --heartbeat-interval given alone', async () => {
      mockTrpcClient.task.update.mutate.mockResolvedValue({
        data: { identifier: 'T-1' },
      });

      const program = createProgram();
      await program.parseAsync([
        'node',
        'test',
        'task',
        'edit',
        'T-1',
        '--heartbeat-interval',
        '600',
      ]);

      expect(mockTrpcClient.task.update.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          automationMode: 'heartbeat',
          heartbeatInterval: 600,
          id: 'T-1',
        }),
      );
    });
  });
});
