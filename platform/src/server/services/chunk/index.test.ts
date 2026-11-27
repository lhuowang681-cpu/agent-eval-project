// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';

import { ChunkService } from './index';

const {
  mockAsyncTaskModelCreate,
  mockAsyncTaskModelUpdate,
  mockChunkContent,
  mockChunkModelBulkCreate,
  mockCreateAsyncCaller,
  mockEmbeddingChunks,
  mockFileEnvGetFileConfig,
  mockFileModelFindById,
  mockFileModelUpdate,
  mockParseFileToChunks,
} = vi.hoisted(() => ({
  mockAsyncTaskModelCreate: vi.fn(),
  mockAsyncTaskModelUpdate: vi.fn(),
  mockChunkContent: vi.fn(),
  mockChunkModelBulkCreate: vi.fn(),
  mockCreateAsyncCaller: vi.fn(),
  mockEmbeddingChunks: vi.fn(),
  mockFileEnvGetFileConfig: vi.fn(),
  mockFileModelFindById: vi.fn(),
  mockFileModelUpdate: vi.fn(),
  mockParseFileToChunks: vi.fn(),
}));

vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    create: mockAsyncTaskModelCreate,
    update: mockAsyncTaskModelUpdate,
  })),
}));

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: vi.fn(() => ({
    bulkCreate: mockChunkModelBulkCreate,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFileModelFindById,
    update: mockFileModelUpdate,
  })),
}));

vi.mock('@/server/modules/ContentChunk', () => ({
  ContentChunk: vi.fn(() => ({
    chunkContent: mockChunkContent,
  })),
}));

vi.mock('@/server/routers/async', () => ({
  createAsyncCaller: mockCreateAsyncCaller,
}));

vi.mock('@/envs/file', () => ({
  getFileConfig: mockFileEnvGetFileConfig,
}));

describe('ChunkService', () => {
  const userId = 'test-user-id';
  const mockDb = {} as any;
  let service: ChunkService;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAsyncTaskModelCreate.mockResolvedValue('task-1');
    mockAsyncTaskModelUpdate.mockResolvedValue(undefined);
    mockChunkContent.mockResolvedValue({ chunks: [{ id: 'chunk-1', index: 0, text: 'chunk' }] });
    mockCreateAsyncCaller.mockResolvedValue({
      file: {
        embeddingChunks: mockEmbeddingChunks,
        parseFileToChunks: mockParseFileToChunks,
      },
    });
    mockEmbeddingChunks.mockResolvedValue(undefined);
    mockFileModelFindById.mockResolvedValue({ id: 'file-1' });
    mockFileModelUpdate.mockResolvedValue(undefined);
    mockParseFileToChunks.mockResolvedValue(undefined);
    mockChunkModelBulkCreate.mockResolvedValue([
      { id: 'chunk-1', index: 0, text: 'chunk text', type: 'LangChainElement', userId },
    ]);
    mockFileEnvGetFileConfig.mockReturnValue({ CHUNKS_AUTO_EMBEDDING: true });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    service = new ChunkService(mockDb, userId);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('chunkContent', () => {
    it('should delegate chunking to ContentChunk', async () => {
      const params = {
        content: new Uint8Array([1, 2, 3]),
        filename: 'test.md',
        fileType: 'text/markdown',
      };

      const result = await service.chunkContent(params);

      expect(mockChunkContent).toHaveBeenCalledWith(params);
      expect(result).toEqual({ chunks: [{ id: 'chunk-1', index: 0, text: 'chunk' }] });
    });
  });

  describe('asyncEmbeddingFileChunks', () => {
    it('should return undefined when file is not found', async () => {
      mockFileModelFindById.mockResolvedValue(undefined);

      await expect(service.asyncEmbeddingFileChunks('missing-file')).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should create task, update file, and trigger embedding successfully', async () => {
      const taskId = await service.asyncEmbeddingFileChunks('file-1');

      expect(taskId).toBe('task-1');
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Pending,
        type: AsyncTaskType.Embedding,
      });
      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { embeddingTaskId: 'task-1' });
      expect(mockCreateAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockEmbeddingChunks).toHaveBeenCalledWith({ fileId: 'file-1', taskId: 'task-1' });
      expect(mockAsyncTaskModelUpdate).not.toHaveBeenCalled();
    });

    it('should mark task as error when embedding trigger fails asynchronously', async () => {
      const triggerError = new Error('embedding trigger failed');
      mockEmbeddingChunks.mockRejectedValue(triggerError);

      const taskId = await service.asyncEmbeddingFileChunks('file-1');

      expect(taskId).toBe('task-1');

      // Fire-and-forget: need to wait for async .catch() handler to complete
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('[embeddingFileChunks] error:', triggerError);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });

    // 验收标准 2 (B): wait=true 时同步等待 embedding 执行完成(供导入受控并发削峰)
    it('should await embedding completion when wait is true', async () => {
      let completed = false;
      mockEmbeddingChunks.mockImplementation(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 5);
        });
        completed = true;
      });

      await service.asyncEmbeddingFileChunks('file-1', { wait: true });

      // returned only after embeddingChunks actually finished
      expect(completed).toBe(true);
      expect(mockEmbeddingChunks).toHaveBeenCalledWith({ fileId: 'file-1', taskId: 'task-1' });
    });

    // wait=true 且执行失败时: 标记 task error,但不抛出(单个文档失败不阻断整批导入)
    it('should mark task error without throwing when wait embedding rejects', async () => {
      mockEmbeddingChunks.mockRejectedValue(new Error('rate limited'));

      await expect(service.asyncEmbeddingFileChunks('file-1', { wait: true })).resolves.toBe(
        'task-1',
      );

      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: AsyncTaskStatus.Error }),
      );
    });
  });

  describe('asyncParseFileToChunks', () => {
    it('should return undefined when file is not found', async () => {
      mockFileModelFindById.mockResolvedValue(undefined);

      await expect(service.asyncParseFileToChunks('missing-file')).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should skip creating a new task when skipExist is true and task already exists', async () => {
      mockFileModelFindById.mockResolvedValue({ chunkTaskId: 'existing-task', id: 'file-1' });

      await expect(service.asyncParseFileToChunks('file-1', true)).resolves.toBeUndefined();

      expect(mockAsyncTaskModelCreate).not.toHaveBeenCalled();
      expect(mockFileModelUpdate).not.toHaveBeenCalled();
      expect(mockCreateAsyncCaller).not.toHaveBeenCalled();
    });

    it('should create task, update file, and trigger chunk parsing successfully', async () => {
      const taskId = await service.asyncParseFileToChunks('file-1');

      expect(taskId).toBe('task-1');
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });
      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { chunkTaskId: 'task-1' });
      expect(mockCreateAsyncCaller).toHaveBeenCalledWith({ userId });
      expect(mockParseFileToChunks).toHaveBeenCalledWith({ fileId: 'file-1', taskId: 'task-1' });
      expect(mockAsyncTaskModelUpdate).not.toHaveBeenCalled();
    });

    it('should mark task as error when parse trigger fails asynchronously', async () => {
      const triggerError = new Error('parse trigger failed');
      mockParseFileToChunks.mockRejectedValue(triggerError);

      const taskId = await service.asyncParseFileToChunks('file-1');

      expect(taskId).toBe('task-1');

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith('[ParseFileToChunks] error:', triggerError);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });
  });

  describe('batch upload vectorization failure - concurrent embedding stress', () => {
    it('should mark all tasks as error when embedding fails under concurrent load', async () => {
      // Reproduces: when batch-uploading multiple files, concurrent embedding API calls
      // hit rate limits. With fire-and-forget, errors are caught by .catch() handler.
      const fileIds = ['file-1', 'file-2', 'file-3'];
      let taskIndex = 0;

      mockFileModelFindById.mockResolvedValue({ id: 'file-1' });
      mockAsyncTaskModelCreate.mockResolvedValue(`task-${taskIndex++}`);
      mockFileModelUpdate.mockResolvedValue(undefined);

      // All embedding calls fail with rate limit error (simulates API overload)
      mockEmbeddingChunks.mockRejectedValue(
        new Error('RateLimitError: The server GPU memory is insufficient'),
      );

      // Process files - fire-and-forget returns immediately
      for (const id of fileIds) {
        mockFileModelFindById.mockResolvedValue({ id });
        mockAsyncTaskModelCreate.mockResolvedValue(`task-${taskIndex++}`);

        await service.asyncEmbeddingFileChunks(id);
      }

      // Wait for all .catch() handlers to complete
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });

      // All 3 files' embedding tasks should have been marked as Error
      const errorUpdates = mockAsyncTaskModelUpdate.mock.calls.filter(
        (call) => call[1]?.status === AsyncTaskStatus.Error,
      );
      expect(errorUpdates.length).toBe(3);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should show intermittent pattern where some files succeed and others fail', async () => {
      // This reproduces the "偶尔会出现向量化失败" behavior:
      // Under concurrent load, rate limits kick in intermittently,
      // so some files succeed while others fail.
      let callIndex = 0;

      mockFileModelFindById.mockResolvedValue({ id: 'file-x' });
      mockAsyncTaskModelCreate.mockImplementation(async () => `task-${callIndex++}`);
      mockFileModelUpdate.mockResolvedValue(undefined);

      // Intermittent rate limiting: succeed, fail, succeed, fail
      mockEmbeddingChunks
        .mockResolvedValueOnce(undefined) // file-1: succeeds
        .mockRejectedValueOnce(new Error('Rate limit - GPU memory insufficient')) // file-2: fails
        .mockResolvedValueOnce(undefined) // file-3: succeeds (rate limit recovered)
        .mockRejectedValueOnce(new Error('Rate limit - capacity exceeded')); // file-4: fails again

      const results = [];
      for (let i = 0; i < 4; i++) {
        mockFileModelFindById.mockResolvedValue({ id: `file-${i}` });
        const taskId = await service.asyncEmbeddingFileChunks(`file-${i}`);
        results.push(taskId);
      }

      // Wait for all .catch() handlers to complete
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });

      // All 4 files got task IDs
      expect(results).toEqual(['task-0', 'task-1', 'task-2', 'task-3']);

      // Check error vs success updates
      const errorUpdates = mockAsyncTaskModelUpdate.mock.calls.filter(
        (call) => call[1]?.status === AsyncTaskStatus.Error,
      );

      // 2 files failed (rate limited) - intermittent pattern
      expect(errorUpdates.length).toBe(2);
    }, 10000);
  });

  describe('chunkDocumentContent', () => {
    it('should chunk Markdown content, save chunks, and trigger embedding', async () => {
      const content = '# Title\n\nSome paragraph text here.\n\n## Subtitle\n\nMore text.';
      const chunkIds = await service.chunkDocumentContent('file-1', content);

      // 1. Created chunking async task
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledWith({
        status: AsyncTaskStatus.Processing,
        type: AsyncTaskType.Chunking,
      });

      // 2. Updated file with chunkTaskId
      expect(mockFileModelUpdate).toHaveBeenCalledWith('file-1', { chunkTaskId: 'task-1' });

      // 3. bulkCreate was called with the chunked content
      expect(mockChunkModelBulkCreate).toHaveBeenCalled();
      const bulkCreateArgs = mockChunkModelBulkCreate.mock.calls[0];
      expect(bulkCreateArgs[0].length).toBeGreaterThan(0);
      expect(bulkCreateArgs[1]).toBe('file-1');

      // 4. Chunking task marked as success
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        status: AsyncTaskStatus.Success,
      });

      // 5. Triggered embedding (auto-embedding enabled)
      expect(mockFileEnvGetFileConfig).toHaveBeenCalled();
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledTimes(2); // 1 chunking + 1 embedding

      // 6. Returns chunk IDs
      expect(chunkIds.length).toBeGreaterThan(0);
    });

    it('should return empty array and mark task as error when content produces no chunks', async () => {
      // Empty content should produce no chunks
      const chunkIds = await service.chunkDocumentContent('file-1', '');

      expect(chunkIds).toEqual([]);

      // Task should be marked as error with NoChunkError
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(
          AsyncTaskErrorType.NoChunkError,
          'No chunk found in this document content',
        ),
        status: AsyncTaskStatus.Error,
      });

      // Embedding should NOT be triggered
      // asyncTaskModelCreate was called only 1 time (chunking only)
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledTimes(1);
    });

    it('should skip embedding when CHUNKS_AUTO_EMBEDDING is disabled', async () => {
      mockFileEnvGetFileConfig.mockReturnValue({ CHUNKS_AUTO_EMBEDDING: false });

      const content = '# Title\n\nSome content.';
      const chunkIds = await service.chunkDocumentContent('file-1', content);

      // Chunking still happens
      expect(mockChunkModelBulkCreate).toHaveBeenCalled();

      // Embedding task should NOT be created
      // Only 1 call to asyncTaskModelCreate (for chunking)
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledTimes(1);

      expect(chunkIds.length).toBeGreaterThan(0);
    });

    it('should mark chunking task as error and return empty array on failure', async () => {
      mockChunkModelBulkCreate.mockRejectedValue(new Error('DB connection failed'));

      const chunkIds = await service.chunkDocumentContent('file-1', '# Test\n\nContent.');

      expect(chunkIds).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[chunkDocumentContent] error:',
        expect.any(Error),
      );
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith('task-1', {
        error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, 'DB connection failed'),
        status: AsyncTaskStatus.Error,
      });
    });

    // 验收标准 2 (B): autoEmbed=false 时只分块,不自动触发 embedding
    // (导入流程改为分块后再受控并发 embedding,以削平并发洪峰)
    it('should skip auto-embedding when autoEmbed option is false', async () => {
      const content = '# Title\n\nSome content.';

      const chunkIds = await service.chunkDocumentContent('file-1', content, { autoEmbed: false });

      expect(mockChunkModelBulkCreate).toHaveBeenCalled();
      // only the chunking task is created, no embedding task
      expect(mockAsyncTaskModelCreate).toHaveBeenCalledTimes(1);
      expect(chunkIds.length).toBeGreaterThan(0);
    });
  });
});
