import type { HandleCreateVideoWebhookResult } from '../../../types';
import type { VeoPollResponse } from './createVeoVideo';
import type { GenerationsStatusResponse } from './createVideo';

export async function handleCreateVideoWebhook(payload: {
  body: unknown;
}): Promise<HandleCreateVideoWebhookResult> {
  const body = payload.body as VeoPollResponse & GenerationsStatusResponse;

  // Veo response: { done: true, name: "...operations/{id}", response: { videos: [{bytesBase64Encoded, mimeType}] } }
  if (body.done === true && body.response?.videos?.[0]?.bytesBase64Encoded) {
    const { bytesBase64Encoded, mimeType } = body.response.videos[0];
    const inferenceId = body.name?.split('/operations/').pop() ?? '';
    return {
      inferenceId,
      status: 'success',
      videoUrl: `data:${mimeType};base64,${bytesBase64Encoded}`,
    };
  }

  // Veo error response: { done: true, error: { code, message } }
  if (body.done === true && (body as VeoPollResponse).error) {
    const inferenceId = body.name?.split('/operations/').pop() ?? '';
    return {
      error: (body as VeoPollResponse).error!.message,
      inferenceId,
      status: 'error',
    };
  }

  // Seedance (TripYoYo) response
  return {
    generateAudio: body.generate_audio,
    inferenceId: body.id,
    model: body.model,
    status: 'success',
    usage: {
      completionTokens: body.usage?.completion_tokens ?? 0,
      totalTokens: body.usage?.total_tokens ?? 0,
    },
    videoUrl: body.content?.video_url ?? '',
  };
}
