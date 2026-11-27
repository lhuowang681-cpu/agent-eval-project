import { imageUrlToBase64 } from '@lobechat/utils';
import createDebug from 'debug';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateVideoPayload, CreateVideoResponse } from '../../../types/video';
import { asyncifyPolling } from '../../../utils/asyncifyPolling';
import { parseDataUri } from '../../../utils/uriParser';

const log = createDebug('lobe-video:tripflow-veo');

const VEO_BASE_URL = 'http://aigw.fx.ctripcorp.com/llm/100000533';

/**
 * Maps our internal model IDs to the actual Google API model names used in the raw-proxy URL path.
 * The gateway forwards the model name in the URL directly to Google, so it must match Google's name.
 */
const VEO_MODEL_NAME_MAP: Record<string, string> = {
  'veo-3.1-generate-001': 'veo-3.1-generate-001',
  // 'veo-3.1-generate-001': 'veo-3.1-generate-preview',
};

function resolveVeoModelName(modelId: string): string {
  return VEO_MODEL_NAME_MAP[modelId] ?? modelId;
}

/** Veo only accepts 4 / 6 / 8 seconds; snap any other value to the nearest valid one */
const VALID_DURATIONS = [4, 6, 8] as const;

function snapDuration(duration: number): number {
  return VALID_DURATIONS.reduce((prev, curr) =>
    Math.abs(curr - duration) < Math.abs(prev - duration) ? curr : prev,
  );
}

interface VeoImageObject {
  bytesBase64Encoded: string;
  mimeType: string;
}

/** Convert imageUrl (data URI or HTTP URL) to Veo's { bytesBase64Encoded, mimeType } format */
async function toVeoImageObject(imageUrl: string): Promise<VeoImageObject> {
  const parsed = parseDataUri(imageUrl);

  if (parsed.type === 'base64' && parsed.base64 && parsed.mimeType) {
    return { bytesBase64Encoded: parsed.base64, mimeType: parsed.mimeType };
  }

  if (parsed.type === 'url') {
    const { base64, mimeType } = await imageUrlToBase64(imageUrl);
    return { bytesBase64Encoded: base64, mimeType };
  }

  throw new TypeError(`Cannot process image URL for Veo: ${imageUrl}`);
}

export interface VeoPollResponse {
  done?: boolean;
  error?: { code: number; message: string };
  name: string;
  response?: {
    videos?: VeoImageObject[];
  };
}

async function pollVeoOperation(
  operationName: string,
  model: string,
  baseURL: string,
  options: CreateVideoOptions,
): Promise<VeoPollResponse> {
  const response = await fetch(`${baseURL}/raw/models/${model}:fetchPredictOperation`, {
    body: JSON.stringify({ operationName }),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Veo poll error: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<VeoPollResponse>;
}

/**
 * Veo 3.x video generation via the company's raw-proxy endpoint.
 *
 * Flow: POST :predictLongRunning → asyncifyPolling :fetchPredictOperation
 * On success, the full poll response (base64 inline video) is POSTed to callbackUrl.
 */
export async function createVeoVideo(
  payload: CreateVideoPayload,
  options: CreateVideoOptions,
): Promise<CreateVideoResponse> {
  const { model, params } = payload;
  const { prompt, imageUrl, endImageUrl, aspectRatio, duration, generateAudio, resolution, seed } =
    params;

  log('Creating Veo video - model: %s, params: %O', model, params);

  const baseURL = options.baseURL || VEO_BASE_URL;
  // Use the Google API model name for URL construction (internal ID ≠ Google model name)
  const apiModelName = resolveVeoModelName(model);

  const instance: Record<string, unknown> = { prompt };

  if (imageUrl) {
    instance.image = await toVeoImageObject(imageUrl);
  }
  if (endImageUrl) {
    instance.lastFrame = await toVeoImageObject(endImageUrl);
  }

  const parameters: Record<string, unknown> = {
    compressionQuality: 'optimized',
    enhancePrompt: true,
    personGeneration: 'allow_adult',
    sampleCount: 1,
  };

  if (aspectRatio !== undefined) parameters.aspectRatio = aspectRatio;
  if (duration !== undefined) parameters.durationSeconds = snapDuration(duration);
  if (generateAudio !== undefined) parameters.generateAudio = generateAudio;
  if (resolution !== undefined) parameters.resolution = resolution;
  if (seed !== undefined && seed !== null) parameters.seed = seed;

  const submitBody = { instances: [instance], parameters };

  log('Veo submitting to %s/raw/models/%s:predictLongRunning', baseURL, apiModelName);

  const submitRes = await fetch(`${baseURL}/raw/models/${apiModelName}:predictLongRunning`, {
    body: JSON.stringify(submitBody),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!submitRes.ok) {
    const errorText = await submitRes.text();
    throw new Error(`Veo submit error: ${submitRes.status} ${errorText}`);
  }

  const submitData = (await submitRes.json()) as { name?: string };
  log('Veo submit response name: %s', submitData.name);

  if (!submitData.name) {
    throw new Error('Veo submit: missing operation name in response');
  }

  // Full path, e.g. "projects/.../publishers/google/models/{model}/operations/{uuid}"
  const operationName = submitData.name;
  // Short UUID stored as inferenceId (must match what handleCreateVideoWebhook extracts)
  const operationId = operationName.split('/operations/').pop();
  if (!operationId) {
    throw new Error(`Veo submit: cannot extract operationId from: ${operationName}`);
  }

  log('Veo operationId: %s', operationId);

  asyncifyPolling<VeoPollResponse, CreateVideoResponse>({
    checkStatus: (pollBody) => {
      if (!pollBody.done) return { status: 'pending' };

      if (pollBody.error) {
        return {
          error: new Error(pollBody.error.message || `Veo error code ${pollBody.error.code}`),
          status: 'failed',
        };
      }

      const video = pollBody.response?.videos?.[0];
      if (!video?.bytesBase64Encoded) {
        return { error: new Error('Veo: no video data in response'), status: 'failed' };
      }

      if (payload.callbackUrl) {
        fetch(payload.callbackUrl, {
          body: JSON.stringify(pollBody),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        }).then(async (res) => {
          if (!res.ok) {
            throw new Error(`Veo callback error: ${res.status} ${res.statusText}`);
          }
          return res.json();
        });
      }

      return { status: 'success' };
    },
    initialInterval: 5000,
    logger: {
      debug: (message: any, ...args: any[]) => log(message, ...args),
      error: (message: any, ...args: any[]) => log(message, ...args),
    },
    maxConsecutiveFailures: 5,
    maxInterval: 15_000,
    maxRetries: 120,
    pollingQuery: () => pollVeoOperation(operationName, apiModelName, baseURL, options),
  });

  return { inferenceId: operationId };
}
