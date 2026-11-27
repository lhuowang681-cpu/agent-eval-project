import type { HandleCreateVideoWebhookResult } from '@lobechat/model-runtime';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  FileSource,
  type VideoGenerationAsset,
  type VideoGenerationTaskMetadata,
} from '@lobechat/types';
import { eq } from 'drizzle-orm';
import { type RuntimeVideoGenParams } from 'model-bank';

import { chargeAfterGenerate } from '@/business/server/video-generation/chargeAfterGenerate';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { GenerationModel } from '@/database/models/generation';
import { generationBatches } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { VideoGenerationService } from '@/server/services/generation/video';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

type AsyncTaskRow = NonNullable<Awaited<ReturnType<AsyncTaskModel['findById']>>>;

export interface ApplyVideoGenerationWebhookResultParams {
  asyncTask: AsyncTaskRow;
  db: LobeChatDatabase;
  provider: string;
  result: HandleCreateVideoWebhookResult;
}

/**
 * Shared finalization for video generation: webhook callback and TripYoYo polling both produce the same parsed result.
 */
export async function applyVideoGenerationWebhookResult(
  params: ApplyVideoGenerationWebhookResultParams,
): Promise<void> {
  const { asyncTask, db, provider, result } = params;

  if (result.status === 'pending') return;

  if (result.inferenceId !== asyncTask.inferenceId) {
    throw new Error('TripYoYo poll inferenceId mismatch');
  }

  if (asyncTask.status === AsyncTaskStatus.Success || asyncTask.status === AsyncTaskStatus.Error) {
    return;
  }

  const generationModel = new GenerationModel(db, asyncTask.userId);
  const generation = await generationModel.findByAsyncTaskId(asyncTask.id);
  if (!generation) {
    throw new Error(`Generation not found for asyncTaskId: ${asyncTask.id}`);
  }

  const asyncTaskModel = new AsyncTaskModel(db, asyncTask.userId);
  const metadata = asyncTask.metadata as VideoGenerationTaskMetadata | undefined;

  const batch = await db.query.generationBatches.findFirst({
    where: eq(generationBatches.id, generation.generationBatchId!),
  });
  const resolvedModel =
    result.status === 'success' ? (result.model ?? batch?.model ?? '') : (batch?.model ?? '');

  if (result.status === 'error') {
    await asyncTaskModel.update(asyncTask.id, {
      error: new AsyncTaskError(AsyncTaskErrorType.ServerError, result.error),
      status: AsyncTaskStatus.Error,
    });

    try {
      await chargeAfterGenerate({
        isError: true,
        metadata: {
          asyncTaskId: asyncTask.id,
          generationBatchId: generation.generationBatchId!,
          modelId: resolvedModel,
          topicId: batch?.generationTopicId,
        },
        model: resolvedModel,
        prechargeResult: metadata?.precharge as any,
        provider,
        userId: asyncTask.userId,
      });
    } catch (refundError) {
      console.error('[video-generation] Failed to refund precharge on error:', refundError);
    }
    return;
  }

  const videoService = new VideoGenerationService(db, asyncTask.userId);
  const processResult = await videoService.processVideoForGeneration(result.videoUrl);

  const asset: VideoGenerationAsset = {
    coverUrl: processResult.coverKey,
    duration: processResult.duration,
    height: processResult.height,
    // data URIs (Veo base64 inline) are not persisted as originalUrl to avoid storing 15-20MB in DB
    originalUrl: result.videoUrl.startsWith('data:') ? '' : result.videoUrl,
    thumbnailUrl: processResult.thumbnailKey,
    type: 'video',
    url: processResult.videoKey,
    width: processResult.width,
  };

  await generationModel.createAssetAndFile(
    generation.id,
    asset,
    {
      fileHash: processResult.fileHash,
      fileType: processResult.mimeType,
      name: `${sanitizeFileName(batch?.prompt ?? '', generation.id)}.mp4`,
      size: processResult.fileSize,
      url: processResult.videoKey,
    },
    FileSource.VideoGeneration,
  );

  const duration = Date.now() - asyncTask.createdAt.getTime();

  await asyncTaskModel.update(asyncTask.id, {
    duration,
    status: AsyncTaskStatus.Success,
  });

  try {
    const videoCfg = batch?.config as RuntimeVideoGenParams | undefined;
    await chargeAfterGenerate({
      computePriceParams: {
        generateAudio: videoCfg?.generateAudio,
        includesVideo: Boolean(videoCfg?.imageUrl || videoCfg?.endImageUrl),
      },
      latency: duration,
      metadata: {
        asyncTaskId: asyncTask.id,
        generationBatchId: generation.generationBatchId!,
        modelId: resolvedModel,
        topicId: batch?.generationTopicId,
      },
      model: resolvedModel,
      prechargeResult: metadata?.precharge as any,
      provider,
      usage: result.usage,
      userId: asyncTask.userId,
    });
  } catch (chargeError) {
    console.error('[video-generation] Failed to charge after generate:', chargeError);
  }
}
