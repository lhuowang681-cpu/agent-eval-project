// @vitest-environment node
import { AsyncTaskError, AsyncTaskErrorType, AsyncTaskStatus } from '@lobechat/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileRouter } from '../file';

const {
  mockAsyncTaskModelFindById,
  mockAsyncTaskModelUpdate,
  mockChunkModelGetChunksTextByFileId,
  mockEmbeddingModelBulkCreate,
  mockFileModelFindById,
  mockInitModelRuntimeFromDB,
  mockModelRuntimeEmbeddings,
  mockValidateInternalJWT,
  mockUserModelFindById,
  mockGetServerDB,
  mockCheckEmbeddingUsage,
} = vi.hoisted(() => ({
  mockAsyncTaskModelFindById: vi.fn(),
  mockAsyncTaskModelUpdate: vi.fn(),
  mockChunkModelGetChunksTextByFileId: vi.fn(),
  mockEmbeddingModelBulkCreate: vi.fn(),
  mockFileModelFindById: vi.fn(),
  mockInitModelRuntimeFromDB: vi.fn(),
  mockModelRuntimeEmbeddings: vi.fn(),
  mockValidateInternalJWT: vi.fn(),
  mockUserModelFindById: vi.fn(),
  mockGetServerDB: vi.fn(),
  mockCheckEmbeddingUsage: vi.fn(),
}));

// Mock TRPC async auth middleware dependencies
vi.mock('@/libs/trpc/utils/internalJwt', () => ({
  validateInternalJWT: mockValidateInternalJWT,
}));

vi.mock('@/database/models/user', () => ({
  UserModel: {
    findById: mockUserModelFindById,
  },
}));

vi.mock('@/database/core/db-adaptor', () => ({
  getServerDB: mockGetServerDB,
}));

// Mock database models used in fileProcedure middleware
vi.mock('@/database/models/asyncTask', () => ({
  AsyncTaskModel: vi.fn(() => ({
    findById: mockAsyncTaskModelFindById,
    update: mockAsyncTaskModelUpdate,
  })),
}));

vi.mock('@/database/models/chunk', () => ({
  ChunkModel: vi.fn(() => ({
    getChunksTextByFileId: mockChunkModelGetChunksTextByFileId,
  })),
}));

vi.mock('@/database/models/embedding', () => ({
  EmbeddingModel: vi.fn(() => ({
    bulkCreate: mockEmbeddingModelBulkCreate,
  })),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn(() => ({
    findById: mockFileModelFindById,
  })),
}));

vi.mock('@/server/modules/ModelRuntime', () => ({
  initModelRuntimeFromDB: mockInitModelRuntimeFromDB,
}));

vi.mock('@/server/globalConfig', () => ({
  getServerDefaultFilesConfig: vi.fn(() => ({
    embeddingModel: { model: 'text-embedding-3-small', provider: 'openai' },
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(() => ({})),
}));

vi.mock('@/server/services/chunk', () => ({
  ChunkService: vi.fn(() => ({})),
}));

vi.mock('@/business/server/trpc-middlewares/async', () => ({
  checkEmbeddingUsage: mockCheckEmbeddingUsage,
}));

vi.mock('@/envs/file', () => ({
  fileEnv: {
    EMBEDDING_BATCH_SIZE: 50,
    EMBEDDING_CONCURRENCY: 10,
  },
}));

vi.mock('@/config/db', () => ({
  serverDBEnv: {},
}));

describe('fileRouter - embeddingChunks mutation (batch upload vectorization failure)', () => {
  const userId = 'test-user-id';
  const fileId = 'test-file-id';
  const taskId = 'test-task-id';
  const authorizationToken = 'valid-internal-jwt';
  const mockServerDB = Symbol('mock-server-db');

  beforeEach(() => {
    vi.clearAllMocks();

    // Auth middleware: bypass auth checks
    mockValidateInternalJWT.mockResolvedValue(true);
    mockUserModelFindById.mockResolvedValue({ id: userId });
    mockGetServerDB.mockResolvedValue(mockServerDB);
    mockCheckEmbeddingUsage.mockImplementation(async (opts) => opts.next());

    // Default setup: file exists, task exists, chunks available
    mockFileModelFindById.mockResolvedValue({ id: fileId, name: 'test.txt' });
    mockAsyncTaskModelFindById.mockResolvedValue({ id: taskId });
    mockAsyncTaskModelUpdate.mockResolvedValue(undefined);
    mockEmbeddingModelBulkCreate.mockResolvedValue(undefined);
    mockModelRuntimeEmbeddings.mockImplementation(async ({ input }) =>
      // Return embeddings matching the number of inputs
      Array.from({ length: input.length }, (_, i) => [0.1 * i, 0.2 * i, 0.3 * i]),
    );
    mockInitModelRuntimeFromDB.mockResolvedValue({
      embeddings: mockModelRuntimeEmbeddings,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createCaller = () =>
    fileRouter.createCaller({
      authorizationToken,
      userId,
    } as any);

  describe('initModelRuntimeFromDB called repeatedly inside pMap loop', () => {
    it('should call initModelRuntimeFromDB only once (optimized: outside pMap loop)', async () => {
      // Create 120 chunks → 3 batches with EMBEDDING_BATCH_SIZE=50
      const chunks = Array.from({ length: 120 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      // FIX: initModelRuntimeFromDB is now called ONCE before the pMap loop,
      // instead of being called for each batch (was 3 times before the fix)
      expect(mockInitModelRuntimeFromDB).toHaveBeenCalledTimes(1);
      expect(mockInitModelRuntimeFromDB).toHaveBeenCalledWith(mockServerDB, userId, 'openai');

      expect(result.success).toBe(true);
    });

    it('should call initModelRuntimeFromDB once even for single-batch files', async () => {
      // 30 chunks → 1 batch with EMBEDDING_BATCH_SIZE=50
      const chunks = Array.from({ length: 30 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      // initModelRuntimeFromDB is called once (consistent with the optimization)
      expect(mockInitModelRuntimeFromDB).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });
  });

  describe('rate limit error causes entire embedding task to fail', () => {
    it('should fail entire task when embedding API returns rate limit error on any batch', async () => {
      // 100 chunks → 2 batches
      const chunks = Array.from({ length: 100 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      mockInitModelRuntimeFromDB.mockResolvedValue({
        embeddings: mockModelRuntimeEmbeddings,
      });
      // First batch succeeds, second batch hits rate limit
      // Default mockImplementation from beforeEach handles batch sizes dynamically
      mockModelRuntimeEmbeddings
        .mockImplementationOnce(async ({ input }) =>
          Array.from({ length: input.length }, (_, i) => [0.1 * i]),
        ) // batch 1 succeeds
        .mockRejectedValueOnce({
          errorType: 'RateLimitError',
          message: 'Rate limit exceeded - insufficient GPU memory',
        }); // batch 2 rate limited

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      // Task fails - no partial success mechanism
      expect(result.success).toBe(false);
      // BUG: inner catch prioritizes e.errorType over e.message, losing detailed error info
      // So "RateLimitError" appears instead of "Rate limit exceeded - insufficient GPU memory"
      expect(result.message).toContain('RateLimitError');

      // Task status should be updated to Error
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(taskId, {
        error: expect.objectContaining({
          name: AsyncTaskErrorType.EmbeddingError,
        }),
        status: AsyncTaskStatus.Error,
      });
    });

    it('should fail when first batch already hits rate limit (concurrent load from other files)', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      mockInitModelRuntimeFromDB.mockResolvedValue({
        embeddings: mockModelRuntimeEmbeddings,
      });
      // Rate limit error immediately (other files already consuming capacity)
      mockModelRuntimeEmbeddings.mockRejectedValueOnce({
        errorType: 'RateLimitError',
        message: 'TokenRateLimited. The server GPU memory is insufficient, please try again later.',
      });

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      expect(result.success).toBe(false);
      // BUG: errorType is prioritized over message, detailed error info is lost
      expect(result.message).toContain('RateLimitError');
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(taskId, {
        error: expect.objectContaining({
          name: AsyncTaskErrorType.EmbeddingError,
        }),
        status: AsyncTaskStatus.Error,
      });
    });

    it('should fail entire task when initModelRuntimeFromDB itself fails', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      // initModelRuntimeFromDB now runs BEFORE pMap, so failure is caught by outer catch
      mockInitModelRuntimeFromDB.mockRejectedValueOnce(
        new Error('Database connection pool exhausted'),
      );

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      expect(result.success).toBe(false);
      // Error name is "Error" (from Error constructor), not "EmbeddingError"
      // because initModelRuntimeFromDB failure is now caught by the outer catch block
      // instead of the inner pMap catch that wraps it as EmbeddingError
      expect(result.message).toContain('Database connection pool exhausted');
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(taskId, {
        error: new AsyncTaskError('Error', 'Database connection pool exhausted'),
        status: AsyncTaskStatus.Error,
      });
    });
  });

  describe('no partial success - single batch failure kills entire task', () => {
    it('should discard all previously successful embeddings when a later batch fails', async () => {
      // 150 chunks → 3 batches (50 each)
      const chunks = Array.from({ length: 150 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);

      mockInitModelRuntimeFromDB.mockResolvedValue({
        embeddings: mockModelRuntimeEmbeddings,
      });

      // Batch 1 and 2 succeed, batch 3 fails with rate limit
      mockModelRuntimeEmbeddings
        .mockImplementationOnce(async ({ input }) =>
          Array.from({ length: input.length }, (_, i) => [0.1 * i]),
        )
        .mockImplementationOnce(async ({ input }) =>
          Array.from({ length: input.length }, (_, i) => [0.1 * i]),
        )
        .mockRejectedValueOnce({
          errorType: 'RateLimitError',
          message: 'Rate limit exceeded',
        });

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      // Task failed - even though batch 1 and 2 succeeded
      expect(result.success).toBe(false);
      expect(result.message).toContain('RateLimitError');

      // BulkCreate was called for successful batches before the failure
      // But the task is marked as Error, so those embeddings are orphaned
      // (no cleanup mechanism for partial embeddings)
      expect(mockEmbeddingModelBulkCreate.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe('successful embedding (baseline)', () => {
    it('should successfully embed all chunks for a single file', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => ({
        id: `chunk-${i}`,
        text: `chunk text ${i}`,
      }));
      mockChunkModelGetChunksTextByFileId.mockResolvedValue(chunks);
      mockInitModelRuntimeFromDB.mockResolvedValue({
        embeddings: mockModelRuntimeEmbeddings,
      });

      const result = await createCaller().embeddingChunks({ fileId, taskId });

      expect(result.success).toBe(true);
      expect(mockAsyncTaskModelUpdate).toHaveBeenCalledWith(taskId, {
        duration: expect.any(Number),
        status: AsyncTaskStatus.Success,
      });
    });
  });
});
