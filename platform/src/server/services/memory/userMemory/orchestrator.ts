import { LayersEnum, MemorySourceType } from '@lobechat/types';
import { chunk } from 'es-toolkit/compat';
import pMap from 'p-map';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import {
  buildUserPersonaJobInput,
  UserPersonaService,
} from '@/server/services/memory/userMemory/persona/service';

import {
  formatMemoryExtractionError,
  MemoryExtractionExecutor,
  type MemoryExtractionHourlyWorkflowPayload,
  type MemoryExtractionNormalizedPayload,
  normalizeMemoryExtractionPayload,
} from './extract';

const USER_PAGE_SIZE = 50;
const USER_BATCH_SIZE = 10;
const USER_PAGE_SIZE_HOURLY = 200;
const USER_BATCH_SIZE_HOURLY = 20;
const TOPIC_PAGE_SIZE = 50;
const TOPIC_BATCH_SIZE = 4;
const TOPIC_PARALLELISM = 5;

const CEPA_LAYERS: LayersEnum[] = [
  LayersEnum.Context,
  LayersEnum.Experience,
  LayersEnum.Preference,
  LayersEnum.Activity,
];
const IDENTITY_LAYERS: LayersEnum[] = [LayersEnum.Identity];

export interface ContinueTopicBatchPayload {
  hasTopicsFromPayload: boolean;
  params: MemoryExtractionNormalizedPayload;
  topicIdBatches: string[][];
  topicPageCursor?: NonNullable<MemoryExtractionNormalizedPayload['topicCursor']>;
  userId: string;
}

export class MemoryExtractionOrchestrator {
  private constructor(private readonly executor: MemoryExtractionExecutor) {}

  static async create() {
    return new MemoryExtractionOrchestrator(await MemoryExtractionExecutor.create());
  }

  /** Top-level entry: paginate users then fan out to per-user topic processing. */
  async runExtraction(params: MemoryExtractionNormalizedPayload): Promise<void> {
    if (params.sources.length === 0) return;

    const userCursor = params.userCursor
      ? { createdAt: new Date(params.userCursor.createdAt), id: params.userCursor.id }
      : undefined;

    const userBatch =
      params.userIds.length > 0
        ? { ids: params.userIds }
        : await this.executor.getUsers(USER_PAGE_SIZE, userCursor);

    const ids = userBatch.ids;
    if (ids.length === 0) return;

    const cursor = 'cursor' in userBatch ? userBatch.cursor : undefined;

    for (const userIds of chunk(ids, USER_BATCH_SIZE)) {
      await this.processUserTopics({
        ...params,
        topicCursor: undefined,
        topicIds: [],
        userId: userIds[0],
        userIds,
      });
    }

    if (params.userIds.length === 0 && cursor) {
      await this.runExtraction({
        ...params,
        userCursor: {
          createdAt:
            cursor.createdAt instanceof Date
              ? cursor.createdAt.toISOString()
              : String(cursor.createdAt),
          id: cursor.id,
        },
      });
    }
  }

  async processUserTopics(params: MemoryExtractionNormalizedPayload): Promise<void> {
    if (!params.userIds.length) return;
    if (!params.sources.includes(MemorySourceType.ChatTopic)) return;

    for (const userId of params.userIds) {
      const topicCursor =
        params.topicCursor && params.topicCursor.userId === userId
          ? {
              createdAt: new Date(params.topicCursor.createdAt),
              id: params.topicCursor.id,
            }
          : undefined;

      const topicsFromPayload =
        params.topicIds.length > 0
          ? await this.executor.filterTopicIdsForUser(userId, params.topicIds)
          : undefined;

      const topicBatch =
        topicsFromPayload && topicsFromPayload.length > 0
          ? { ids: topicsFromPayload }
          : await this.executor.getTopicsForUser(
              {
                cursor: topicCursor,
                forceAll: params.forceAll,
                forceTopics: params.forceTopics,
                from: params.from,
                to: params.to,
                userId,
              },
              TOPIC_PAGE_SIZE,
            );

      const ids = topicBatch.ids;
      if (!ids.length) continue;

      const pageCursor = 'cursor' in topicBatch ? topicBatch.cursor : undefined;
      const batches = chunk(ids, TOPIC_BATCH_SIZE);
      const hasTopicsFromPayload = Boolean(topicsFromPayload?.length);
      const topicPageCursor = pageCursor
        ? {
            createdAt: pageCursor.createdAt.toISOString(),
            id: pageCursor.id,
            userId,
          }
        : undefined;

      await this.processTopicBatch({
        ...params,
        topicCursor: undefined,
        topicIds: batches[0],
        userId,
        userIds: [userId],
      });

      if (batches.length > 1) {
        void this.scheduleContinueTopicBatches({
          hasTopicsFromPayload,
          params,
          topicIdBatches: batches.slice(1),
          topicPageCursor,
          userId,
        });
        continue;
      }

      await this.finishUserTopicsPage(params, userId, topicPageCursor, hasTopicsFromPayload);
    }
  }

  /** Resume topic batches in a fresh async invocation to avoid long-running HTTP timeouts. */
  async continueTopicBatches(payload: ContinueTopicBatchPayload): Promise<void> {
    const { params, topicIdBatches, topicPageCursor, hasTopicsFromPayload, userId } = payload;
    const [current, ...rest] = topicIdBatches;

    if (!current?.length) {
      await this.finishUserTopicsPage(params, userId, topicPageCursor, hasTopicsFromPayload);
      return;
    }

    await this.processTopicBatch({
      ...params,
      topicCursor: undefined,
      topicIds: current,
      userId,
      userIds: [userId],
    });

    if (rest.length > 0) {
      void this.scheduleContinueTopicBatches({
        hasTopicsFromPayload,
        params,
        topicIdBatches: rest,
        topicPageCursor,
        userId,
      });
      return;
    }

    await this.finishUserTopicsPage(params, userId, topicPageCursor, hasTopicsFromPayload);
  }

  async processTopicBatch(params: MemoryExtractionNormalizedPayload): Promise<void> {
    if (!params.userIds.length || !params.topicIds.length) return;
    if (!params.sources.includes(MemorySourceType.ChatTopic)) return;

    const userId = params.userIds[0];
    const layers = params.layers.length > 0 ? params.layers : [...CEPA_LAYERS, ...IDENTITY_LAYERS];

    await pMap(
      params.topicIds,
      async (topicId) => {
        await this.processSingleTopic({
          ...params,
          layers,
          topicIds: [topicId],
          userId,
          userIds: [userId],
        });
      },
      { concurrency: TOPIC_PARALLELISM },
    );
  }

  async processSingleTopic(params: MemoryExtractionNormalizedPayload): Promise<void> {
    const topicId = params.topicIds[0];
    const userId = params.userIds[0];

    if (!userId || !topicId) return;
    if (!params.sources.includes(MemorySourceType.ChatTopic)) return;

    try {
      const cepaLayers = params.layers.length
        ? params.layers.filter((layer) => CEPA_LAYERS.includes(layer))
        : CEPA_LAYERS;

      if (cepaLayers.length > 0) {
        await this.executor.extractTopic({
          asyncTaskId: params.asyncTaskId,
          forceAll: params.forceAll,
          forceTopics: params.forceTopics,
          from: params.from,
          layers: cepaLayers,
          markTopicExtracted: false,
          reportProgress: false,
          source: MemorySourceType.ChatTopic,
          to: params.to,
          topicId,
          userId,
          userInitiated: params.userInitiated,
        });
      }

      const identityLayers = params.layers.length
        ? params.layers.filter((layer) => IDENTITY_LAYERS.includes(layer))
        : IDENTITY_LAYERS;

      if (identityLayers.length > 0) {
        await this.executor.extractTopic({
          asyncTaskId: params.asyncTaskId,
          forceAll: params.forceAll,
          forceTopics: params.forceTopics,
          from: params.from,
          layers: identityLayers,
          markTopicExtracted: true,
          reportProgress: false,
          source: MemorySourceType.ChatTopic,
          to: params.to,
          topicId,
          userId,
          userInitiated: params.userInitiated,
        });
      }

      if (params.asyncTaskId && params.userInitiated) {
        await this.reportTopicProgress(params.asyncTaskId, userId);
      }
    } catch (error) {
      if (params.asyncTaskId && params.userInitiated) {
        await this.reportTopicProgress(params.asyncTaskId, userId);
      }

      console.error(
        `[memory-orchestrator] extract failed user=${userId} topic=${topicId}: ${formatMemoryExtractionError(error)}`,
        error,
      );
    }
  }

  async runHourlyScan(payload: MemoryExtractionHourlyWorkflowPayload & { baseUrl: string }) {
    const { cursor, dryRun = false, baseUrl } = payload;

    const parsedCursor = cursor
      ? { createdAt: new Date(cursor.createdAt), id: cursor.id }
      : undefined;

    if (parsedCursor && Number.isNaN(parsedCursor.createdAt.getTime())) {
      throw new Error('Invalid cursor date for hourly memory extraction');
    }

    const userBatch = await this.executor.getUsersForHourlyExtraction(
      USER_PAGE_SIZE_HOURLY,
      parsedCursor,
    );

    const userIds = userBatch.ids;
    if (userIds.length === 0) {
      return { message: 'No eligible users for hourly memory extraction.', processedUsers: 0 };
    }

    const nextCursor = userBatch.cursor
      ? {
          createdAt:
            userBatch.cursor.createdAt instanceof Date
              ? userBatch.cursor.createdAt.toISOString()
              : String(userBatch.cursor.createdAt),
          id: userBatch.cursor.id,
        }
      : undefined;

    if (!dryRun) {
      for (const batchUserIds of chunk(userIds, USER_BATCH_SIZE_HOURLY)) {
        await this.runExtraction(
          normalizeMemoryExtractionPayload({
            baseUrl,
            mode: 'direct',
            sources: [MemorySourceType.ChatTopic],
            userIds: batchUserIds,
          }),
        );
      }
    }

    return {
      dryRun: !!dryRun,
      hasNextPage: !!nextCursor,
      nextCursor,
      processedUsers: userIds.length,
      scheduledBatches: dryRun ? 0 : chunk(userIds, USER_BATCH_SIZE_HOURLY).length,
    };
  }

  async updatePersona(userIds: string[]): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds)).filter(Boolean);
    if (uniqueUserIds.length === 0) return;

    const db = await getServerDB();
    const service = new UserPersonaService(db);

    await Promise.all(
      uniqueUserIds.map(async (userId) => {
        const context = await buildUserPersonaJobInput(db, userId);
        await service.composeWriting({ ...context, userId });
      }),
    );
  }

  private async finishUserTopicsPage(
    params: MemoryExtractionNormalizedPayload,
    userId: string,
    topicPageCursor: ContinueTopicBatchPayload['topicPageCursor'],
    hasTopicsFromPayload: boolean,
  ) {
    if (!hasTopicsFromPayload && topicPageCursor) {
      await this.processUserTopics({
        ...params,
        topicCursor: topicPageCursor,
        topicIds: [],
        userId,
        userIds: [userId],
      });
      return;
    }

    void this.safeUpdatePersona([userId]);
  }

  private async reportTopicProgress(asyncTaskId: string, userId: string) {
    try {
      const db = await getServerDB();
      const asyncTaskModel = new AsyncTaskModel(db, userId);
      await asyncTaskModel.incrementUserMemoryExtractionProgress(asyncTaskId);
    } catch (progressError) {
      console.error('[memory-orchestrator] failed to record async task progress', progressError);
    }
  }

  private async safeUpdatePersona(userIds: string[]) {
    try {
      await this.updatePersona(userIds);
    } catch (error) {
      console.error('[memory-orchestrator] persona update failed (non-blocking)', error);
    }
  }

  private async scheduleContinueTopicBatches(payload: ContinueTopicBatchPayload) {
    try {
      const { createAsyncCaller } = await import('@/server/routers/async/caller');
      const caller = await createAsyncCaller({ userId: payload.userId });
      void caller.memory.continueTopicBatches(payload);
    } catch (error) {
      console.error('[memory-orchestrator] failed to schedule topic batch continuation', error);
    }
  }
}
