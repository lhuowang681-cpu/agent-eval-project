import { imageUrlToBase64 } from '@lobechat/utils';
import createDebug from 'debug';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../../types/video';
import { asyncifyPolling } from '../../../utils/asyncifyPolling';
import { parseDataUri } from '../../../utils/uriParser';
import { createVeoVideo } from './createVeoVideo';

const log = createDebug('lobe-video:tripflow');

async function processImageUrl(imageUrl: string): Promise<string> {
  const { type, base64, mimeType } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }

    return `data:${mimeType || 'image/png'};base64,${base64}`;
  }

  if (type === 'url') {
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);

    return `data:${urlMimeType};base64,${urlBase64}`;
  }

  throw new TypeError(`Currently we don't support image url: ${imageUrl}`);
}

/**
 * TripYoYo video: POST task, then poll GET /contents/generations/tasks/{id} until terminal (Hunyuan-style).
 */
export async function createVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  if (payload.model.startsWith('veo-')) {
    return createVeoVideo(payload, options);
  }

  const { model, params } = payload;
  const {
    prompt,
    imageUrl,
    endImageUrl,
    aspectRatio,
    duration,
    generateAudio,
    seed,
    resolution,
    cameraFixed,
  } = params;

  log('Creating video with TripYoYo API - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || 'http://aigw.fx.ctripcorp.com/llm/100000533';

  const content: Record<string, unknown>[] = [{ text: prompt, type: 'text' }];

  if (imageUrl) {
    content.push({
      image_url: { url: await processImageUrl(imageUrl) },
      role: 'first_frame',
      type: 'image_url',
    });
  }

  if (endImageUrl) {
    content.push({
      image_url: { url: await processImageUrl(endImageUrl) },
      role: 'last_frame',
      type: 'image_url',
    });
  }

  const body: Record<string, unknown> = {
    content,
    model,
    watermark: false,
  };

  if (aspectRatio !== undefined) body.ratio = aspectRatio;
  if (duration !== undefined) body.duration = duration;
  if (generateAudio !== undefined) body.generate_audio = generateAudio;
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (resolution !== undefined) body.resolution = resolution;
  if (cameraFixed !== undefined) body.camera_fixed = cameraFixed;

  log('TripYoYo video API submit body: %s', JSON.stringify(body, null, 2));

  const response = await fetch(`${baseURL}/contents/generations/tasks`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('TripYoYo video API error: %s %s', response.status, errorText);
    throw new Error(`TripYoYo video API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as { id?: string };

  log('TripYoYo video API submit response: %O', data);

  if (!data?.id) {
    throw new Error('Invalid response: missing task id');
  }

  const inferenceId = data.id;

  // 随机生成一个inferenceId
  // const inferenceId = Math.random().toString(36).substring(2, 15);
  // log('TripYoYo video API inferenceId: %s', inferenceId);

  asyncifyPolling<GenerationsStatusResponse, CreateVideoResponse>({
    checkStatus: (taskBody) => {
      try {
        if (taskBody.status === 'succeeded') {
          if (payload.callbackUrl) {
            fetch(payload.callbackUrl, { body: JSON.stringify(taskBody), method: 'POST' }).then(
              async (response) => {
                if (response.ok) return await response.json();

                throw new Error(
                  `TripYoYo video callback error: ${response.status} ${response.statusText}`,
                );
              },
            );
          }
          return { status: 'success' };
        }

        if (
          taskBody.status === 'cancelled' ||
          taskBody.status === 'failed' ||
          taskBody.status === 'expired'
        ) {
          const errorMsg = taskBody.error?.message || taskBody.status;
          return { error: new Error(errorMsg), status: 'failed' };
        }

        return { status: 'pending' };
      } catch (e) {
        return {
          error: e instanceof Error ? e : new Error(String(e)),
          status: 'failed',
        };
      }
    },
    initialInterval: 3000,
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    maxConsecutiveFailures: 5,
    maxInterval: 10_000,
    maxRetries: 120,
    pollingQuery: async () => getGenerationsStatus(inferenceId, payload.model, baseURL, options),
  });

  return { inferenceId };
}

export interface GenerationsStatusResponse {
  content?: {
    video_url: string;
  };
  created_at: number;
  draft?: boolean;
  duration?: number;
  error?: {
    message: string;
  };
  framespersecond?: number;
  generate_audio?: boolean;
  id: string;
  model: string;
  ratio?: string;
  resolution?: string;
  seed?: number;
  status: string;
  updated_at: number;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
}

async function getGenerationsStatus(
  inferenceId: string,
  model: string,
  baseURL: string,
  options: CreateVideoOptions,
): Promise<GenerationsStatusResponse> {
  const response = await fetch(
    `${baseURL}/contents/generations/tasks/${inferenceId}?model=${model}`,
    {
      headers: { Authorization: `Bearer ${options.apiKey}` },
      method: 'GET',
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TripYoYo video generations status API error: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<GenerationsStatusResponse>;
  // return {
  //   id: inferenceId,
  //   model: 'doubao-seedance-2-0-260128',
  //   status: 'succeeded',
  //   content: {
  //     video_url: 'https://video.c-ctrip.com/videos/8G043f000001jsus2943B.mp4',
  //   },
  //   usage: { completion_tokens: 38800, total_tokens: 38800 },
  //   created_at: 1775741444,
  //   updated_at: 1775741657,
  //   seed: 43887,
  //   resolution: '480p',
  //   ratio: '1:1',
  //   duration: 4,
  //   framespersecond: 24,
  //   generate_audio: false,
  //   draft: false,
  // };
}

// Alias for test compatibility
export const createTripFlowVideo = createVideo;
