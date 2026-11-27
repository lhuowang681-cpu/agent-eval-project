import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  MemorySourceType,
} from '@lobechat/types';
import { z } from 'zod';

import { AsyncTaskModel } from '@/database/models/asyncTask';
import { getServerDB } from '@/database/server';
import { appEnv } from '@/envs/app';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { parseMemoryExtractionConfig } from '@/server/globalConfig/parseMemoryExtractionConfig';
import {
  formatMemoryExtractionError,
  type MemoryExtractionNormalizedPayload,
  normalizeMemoryExtractionPayload,
} from '@/server/services/memory/userMemory/extract';
import {
  type ContinueTopicBatchPayload,
  MemoryExtractionOrchestrator,
} from '@/server/services/memory/userMemory/orchestrator';

const runExtractionInputSchema = z.object({
  asyncTaskId: z.string().uuid().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  userIds: z.array(z.string()).optional(),
});

const continueTopicBatchInputSchema: z.ZodType<ContinueTopicBatchPayload> = z.object({
  hasTopicsFromPayload: z.boolean(),
  params: z.custom<MemoryExtractionNormalizedPayload>(),
  topicIdBatches: z.array(z.array(z.string())),
  topicPageCursor: z
    .object({
      createdAt: z.string(),
      id: z.string(),
      userId: z.string(),
    })
    .optional(),
  userId: z.string(),
});

const markExtractionFailed = async (
  userId: string,
  asyncTaskId: string | undefined,
  error: unknown,
) => {
  if (!asyncTaskId) return;

  try {
    const db = await getServerDB();
    const asyncTaskModel = new AsyncTaskModel(db, userId);
    await asyncTaskModel.update(asyncTaskId, {
      error: new AsyncTaskError(AsyncTaskErrorType.ServerError, formatMemoryExtractionError(error)),
      status: AsyncTaskStatus.Error,
    });
  } catch (updateError) {
    console.error('[memory-async] failed to mark extraction task as error', updateError);
  }
};

export const memoryRouter = router({
  continueTopicBatches: asyncAuthedProcedure
    .input(continueTopicBatchInputSchema)
    .mutation(async ({ ctx, input }) => {
      const orchestrator = await MemoryExtractionOrchestrator.create();
      void orchestrator.continueTopicBatches(input).catch((error) => {
        console.error('[memory-async] continueTopicBatches failed', error);
        void markExtractionFailed(ctx.userId, input.params.asyncTaskId, error);
      });

      return { success: true };
    }),

  runExtraction: asyncAuthedProcedure
    .input(runExtractionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const { webhook } = parseMemoryExtractionConfig();
      const baseUrl = webhook.baseUrl || appEnv.INTERNAL_APP_URL || appEnv.APP_URL;

      if (!baseUrl) {
        throw new Error('Missing baseUrl for memory extraction');
      }

      const orchestrator = await MemoryExtractionOrchestrator.create();
      const payload = normalizeMemoryExtractionPayload({
        asyncTaskId: input.asyncTaskId,
        baseUrl,
        forceAll: false,
        forceTopics: false,
        fromDate: input.fromDate,
        mode: 'direct',
        sources: [MemorySourceType.ChatTopic],
        toDate: input.toDate,
        userIds: input.userIds ?? [ctx.userId],
        userInitiated: true,
      });

      void orchestrator.runExtraction(payload).catch((error) => {
        console.error('[memory-async] runExtraction failed', error);
        void markExtractionFailed(ctx.userId, input.asyncTaskId, error);
      });

      return { success: true };
    }),
});
