import { type LobeChatDatabase } from '@lobechat/database';
import { type NewChunkItem } from '@lobechat/database/schemas';
import { MarkdownTextSplitter } from 'langchain/text_splitter';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { ChunkModel } from '@/database/models/chunk';
import { FileModel } from '@/database/models/file';
import { loaderConfig } from '@/libs/langchain/loaders/config';
import { ContentChunk } from '@/server/modules/ContentChunk';
import { type ChunkContentParams } from '@/server/modules/ContentChunk';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  AsyncTaskType,
} from '@/types/asyncTask';
import { sanitizeUTF8 } from '@/utils/sanitizeUTF8';

export class ChunkService {
  private userId: string;
  private chunkClient: ContentChunk;
  private chunkModel: ChunkModel;
  private fileModel: FileModel;
  private asyncTaskModel: AsyncTaskModel;

  constructor(serverDB: LobeChatDatabase, userId: string) {
    this.userId = userId;

    this.chunkClient = new ContentChunk();
    this.chunkModel = new ChunkModel(serverDB, userId);
    this.fileModel = new FileModel(serverDB, userId);
    this.asyncTaskModel = new AsyncTaskModel(serverDB, userId);
  }

  async chunkContent(params: ChunkContentParams) {
    return this.chunkClient.chunkContent(params);
  }

  /**
   * Chunk document content (Markdown text) directly and save to the database.
   * Used for imported documents (e.g., Feishu) where content is already available
   * as text rather than stored as a binary file on S3.
   *
   * After chunking, automatically triggers embedding if CHUNKS_AUTO_EMBEDDING is enabled.
   */
  async chunkDocumentContent(
    fileId: string,
    content: string,
    options?: { autoEmbed?: boolean },
  ): Promise<string[]> {
    // 1. Create chunking async task
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Processing,
      type: AsyncTaskType.Chunking,
    });

    await this.fileModel.update(fileId, { chunkTaskId: asyncTaskId });

    try {
      // 2. Use MarkdownTextSplitter to chunk the content
      const splitter = new MarkdownTextSplitter(loaderConfig);
      const docs = await splitter.createDocuments([content]);

      // 3. Map to NewChunkItem format
      const chunkItems: NewChunkItem[] = docs.map((doc, index) => ({
        id: doc.id as string,
        index,
        metadata: doc.metadata,
        text: sanitizeUTF8(doc.pageContent),
        type: 'LangChainElement',
        userId: this.userId,
      }));

      if (chunkItems.length === 0) {
        await this.asyncTaskModel.update(asyncTaskId, {
          error: new AsyncTaskError(
            AsyncTaskErrorType.NoChunkError,
            'No chunk found in this document content',
          ),
          status: AsyncTaskStatus.Error,
        });
        return [];
      }

      // 4. Save chunks to database
      const createdChunks = await this.chunkModel.bulkCreate(chunkItems, fileId);
      const chunkIds = createdChunks.map((c) => c.id);

      // 5. Mark chunking task as success
      await this.asyncTaskModel.update(asyncTaskId, {
        status: AsyncTaskStatus.Success,
      });

      // 6. Trigger embedding if auto-embedding is enabled.
      // Bulk importers pass autoEmbed=false and drive embedding themselves with
      // bounded concurrency (see importFromFeishu) to avoid a rate-limit burst.
      if (options?.autoEmbed ?? true) {
        const { getFileConfig } = await import('@/envs/file');
        const fileEnv = getFileConfig();

        if (fileEnv.CHUNKS_AUTO_EMBEDDING) {
          await this.asyncEmbeddingFileChunks(fileId);
        }
      }

      return chunkIds;
    } catch (e) {
      console.error('[chunkDocumentContent] error:', e);
      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(AsyncTaskErrorType.TaskTriggerError, (e as Error).message),
        status: AsyncTaskStatus.Error,
      });
      return [];
    }
  }

  async asyncEmbeddingFileChunks(fileId: string, options?: { wait?: boolean }) {
    const result = await this.fileModel.findById(fileId);

    if (!result) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Pending,
      type: AsyncTaskType.Embedding,
    });

    await this.fileModel.update(fileId, { embeddingTaskId: asyncTaskId });

    // Async router will read keyVaults from DB, no need to pass jwtPayload
    // Dynamic import to avoid circular dependency
    const { createAsyncCaller } = await import('@/server/routers/async');
    const asyncCaller = await createAsyncCaller({ userId: this.userId });

    const markTriggerError = () =>
      this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });

    const triggerPromise = asyncCaller.file.embeddingChunks({ fileId, taskId: asyncTaskId });

    // Synchronous path (bulk import): await completion so the caller can bound
    // concurrency and avoid overwhelming the embedding provider's rate limit.
    // A single document's failure is recorded but not rethrown, so it doesn't
    // abort the rest of the import.
    if (options?.wait) {
      try {
        await triggerPromise;
      } catch (e) {
        console.error('[embeddingFileChunks] error:', e);
        await markTriggerError();
      }
      return asyncTaskId;
    }

    // Fire-and-forget (default), consistent with asyncParseFileToChunks.
    triggerPromise.catch(async (e) => {
      console.error('[embeddingFileChunks] error:', e);
      await markTriggerError();
    });

    return asyncTaskId;
  }

  /**
   * parse file to chunks with async task
   */
  async asyncParseFileToChunks(fileId: string, skipExist?: boolean) {
    const result = await this.fileModel.findById(fileId);

    if (!result) return;

    // skip if already exist chunk tasks
    if (skipExist && result.chunkTaskId) return;

    // 1. create a asyncTaskId
    const asyncTaskId = await this.asyncTaskModel.create({
      status: AsyncTaskStatus.Processing,
      type: AsyncTaskType.Chunking,
    });

    await this.fileModel.update(fileId, { chunkTaskId: asyncTaskId });

    // Async router will read keyVaults from DB, no need to pass jwtPayload
    // Dynamic import to avoid circular dependency
    const { createAsyncCaller } = await import('@/server/routers/async');
    const asyncCaller = await createAsyncCaller({ userId: this.userId });

    // trigger parse file task asynchronously
    asyncCaller.file.parseFileToChunks({ fileId, taskId: asyncTaskId }).catch(async (e) => {
      console.error('[ParseFileToChunks] error:', e);

      await this.asyncTaskModel.update(asyncTaskId, {
        error: new AsyncTaskError(
          AsyncTaskErrorType.TaskTriggerError,
          'trigger chunk embedding async task error. Please make sure the APP_URL is available from your server. You can check the proxy config or WAF blocking',
        ),
        status: AsyncTaskStatus.Error,
      });
    });

    return asyncTaskId;
  }
}
