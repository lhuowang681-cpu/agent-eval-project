import { imageUrlToBase64 } from '@lobechat/utils';
import createDebug from 'debug';

import { convertImageUrlToFile } from '../../../core/contextBuilders/openai';
import type { CreateImageOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateImagePayload, CreateImageResponse } from '../../../types/image';

const log = createDebug('lobe-image:tripflow');

// Models that support image generation via chat completion
const GEMINI_IMAGE_GEN_MODELS = ['gemini-3-pro-image-preview'] as const;
const GPT_IMAGE_GEN_MODELS = ['gpt-image-2'] as const;
const IMAGE_GEN_MODELS = [...GEMINI_IMAGE_GEN_MODELS, ...GPT_IMAGE_GEN_MODELS] as const;

async function normalizeGeminiImageUrl(imageUrl: string) {
  if (imageUrl.startsWith('data:')) return imageUrl;

  const { base64, mimeType } = await imageUrlToBase64(imageUrl);
  return `data:${mimeType};base64,${base64}`;
}

function isGeminiImageModel(model: string) {
  return GEMINI_IMAGE_GEN_MODELS.includes(model as (typeof GEMINI_IMAGE_GEN_MODELS)[number]);
}

function isGptImageModel(model: string) {
  return GPT_IMAGE_GEN_MODELS.includes(model as (typeof GPT_IMAGE_GEN_MODELS)[number]);
}

async function createGeminiImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const baseURL = options.baseURL;
  const imageUrls = getImageUrls(params);

  // Build request body
  const normalizedImageUrls = await Promise.all(
    imageUrls.map((imageUrl) => normalizeGeminiImageUrl(imageUrl)),
  );

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: params.prompt || '' },
    ...normalizedImageUrls.map((imageUrl) => ({
      image_url: { url: imageUrl },
      type: 'image_url',
    })),
  ];

  const requestBody: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content }],
  };

  // Inject imageConfig if aspectRatio or resolution is provided
  if (params.aspectRatio || params.resolution) {
    const imageConfig: Record<string, string> = {};

    if (params.aspectRatio && params.aspectRatio !== 'auto') {
      imageConfig.aspectRatio = params.aspectRatio;
    }

    if (params.resolution) {
      imageConfig.imageSize = params.resolution;
    }

    if (Object.keys(imageConfig).length > 0) {
      requestBody.imageConfig = imageConfig;
    }
  }

  // Inject responseModalities to request image output
  requestBody.responseModalities = ['TEXT', 'IMAGE'];

  log('TripYoYo image request: %O', requestBody);

  // Make API call
  const response = await fetch(`${baseURL}/v1/chat/completions`, {
    body: JSON.stringify(requestBody),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('TripYoYo image API error: %s %s', response.status, errorText);
    throw new Error(`TripYoYo image API error: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        image_url?: { url?: string };
        images?: Array<{ image_url?: { url?: string }; url?: string }>;
        width?: number;
        height?: number;
      };
    }>;
  };

  log('TripYoYo image response: %O', data);

  // Extract message from response
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error('Invalid response: missing message');
  }

  // Try to extract image URL from various possible formats
  let imageUrl = '';

  // Format 1: Direct image_url field
  if (message.image_url?.url) {
    imageUrl = message.image_url.url;
  }
  // Format 1b: Base64 data URI in content
  else if (typeof message.content === 'string' && message.content.startsWith('data:image/')) {
    imageUrl = message.content;
  }
  // Format 2: Content with markdown image format ![alt](url)
  else if (typeof message.content === 'string') {
    const markdownMatch = message.content.match(/!\[.*?\]\((.*?)\)/);
    if (markdownMatch) {
      imageUrl = markdownMatch[1];
    }
    // Format 3: Content as direct URL
    else if (message.content.startsWith('http')) {
      imageUrl = message.content;
    }
  }

  if (!imageUrl) {
    log('No image found in response, content: %s', String(message.content || '').slice(0, 200));
    throw new Error('No image generated in response');
  }

  log('Successfully extracted image URL: %s', imageUrl);

  return {
    imageUrl,
    height: message.height,
    width: message.width,
  };
}

type GptImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
  }>;
};

interface NativeFormFileInput {
  arrayBuffer: () => Promise<ArrayBuffer>;
  name: string;
  type: string;
}

function extractGptImageResponse(data: GptImageResponse): CreateImageResponse {
  const image = data.data?.[0];

  if (image?.b64_json) {
    return { imageUrl: `data:image/png;base64,${image.b64_json}` };
  }

  if (image?.url) {
    return { imageUrl: image.url };
  }

  throw new Error('Invalid image response: missing both b64_json and url fields');
}

const NON_API_SIZE_VALUES = new Set(['auto', 'custom']);

const resolveGptImageSizeParam = (size?: string) => {
  if (!size || NON_API_SIZE_VALUES.has(size)) return undefined;

  return size;
};

function getImageUrls(params: CreateImagePayload['params']) {
  if (params.imageUrl && params.imageUrls && params.imageUrls.length > 0) {
    throw new TypeError('Cannot provide both imageUrl and imageUrls parameters simultaneously');
  }

  if (params.imageUrl) return [params.imageUrl];

  return params.imageUrls ?? [];
}

async function createGptImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const baseURL = options.baseURL;
  const imageUrls = getImageUrls(params);
  const isImageEdit = imageUrls.length > 0;

  if (isImageEdit) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', params.prompt || '');
    form.append('n', '1');

    const size = resolveGptImageSizeParam(params.size);
    if (size) form.append('size', size);
    if (params.quality) form.append('quality', params.quality);

    const imageFiles = await Promise.all(
      imageUrls.map((imageUrl) => convertImageUrlToFile(imageUrl)),
    );

    for (const imageFile of imageFiles) {
      const formFile = imageFile as unknown as NativeFormFileInput;
      const imageBlob = new Blob([await formFile.arrayBuffer()], { type: formFile.type });
      form.append('image', imageBlob, formFile.name);
    }

    const response = await fetch(`${baseURL}/images/edits`, {
      body: form,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
      },
      method: 'POST',
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('TripYoYo gpt-image edit API error: %s %s', response.status, errorText);
      throw new Error(`TripYoYo gpt-image edit API error: ${response.status} ${errorText}`);
    }

    return extractGptImageResponse((await response.json()) as GptImageResponse);
  }

  const size = resolveGptImageSizeParam(params.size);

  const requestBody = {
    model,
    n: 1,
    prompt: params.prompt || '',
    ...(params.quality ? { quality: params.quality } : {}),
    ...(size ? { size } : {}),
  };

  const response = await fetch(`${baseURL}/images/generations`, {
    body: JSON.stringify(requestBody),
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    const errorText = await response.text();
    log('TripYoYo gpt-image generation API error: %s %s', response.status, errorText);
    throw new Error(`TripYoYo gpt-image generation API error: ${response.status} ${errorText}`);
  }

  return extractGptImageResponse((await response.json()) as GptImageResponse);
}

export async function createTripflowImage(
  payload: CreateImagePayload,
  options: CreateImageOptions,
): Promise<CreateImageResponse> {
  const { model } = payload;

  // Validate model
  if (!IMAGE_GEN_MODELS.includes(model as (typeof IMAGE_GEN_MODELS)[number])) {
    throw new Error(
      `Unsupported model: ${model}. Only ${IMAGE_GEN_MODELS.join(', ')} are supported.`,
    );
  }

  if (isGeminiImageModel(model)) {
    return createGeminiImage(payload, options);
  }

  if (isGptImageModel(model)) {
    return createGptImage(payload, options);
  }

  throw new Error(`Unsupported model: ${model}`);
}
