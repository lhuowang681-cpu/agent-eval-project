import { imageUrlToBase64 } from '@lobechat/utils';
import { cleanObject } from '@lobechat/utils/object';
import createDebug from 'debug';
import type { RuntimeImageGenParamsValue } from 'model-bank';
import type OpenAI from 'openai';

import type { CreateImagePayload, CreateImageResponse } from '../../types/image';
import { getModelPricing } from '../../utils/getModelPricing';
import { parseDataUri } from '../../utils/uriParser';
import { convertImageUrlToFile } from '../contextBuilders/openai';
import { convertOpenAIImageUsage } from '../usageConverters/openai';

const log = createDebug('lobe-image:openai-compatible');

/**
 * Generate images using traditional OpenAI images API (DALL-E, etc.)
 */
async function generateByImageMode(
  client: OpenAI,
  payload: CreateImagePayload,
  provider: string,
): Promise<CreateImageResponse> {
  const { model, params } = payload;

  log('Creating image with model: %s and params: %O', model, params);

  // Map parameter names, mapping imageUrls to image
  const paramsMap = new Map<RuntimeImageGenParamsValue, string>([
    ['imageUrls', 'image'],
    ['imageUrl', 'image'],
  ]);
  const userInput: Record<string, any> = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      paramsMap.get(key as RuntimeImageGenParamsValue) ?? key,
      value,
    ]),
  );
  // unify image input to array
  if (typeof userInput.image === 'string' && userInput.image.trim() !== '') {
    userInput.image = [userInput.image];
  }

  // https://platform.openai.com/docs/api-reference/images/createEdit
  const isImageEdit = Array.isArray(userInput.image) && userInput.image.length > 0;
  log('isImageEdit: %O, userInput.image: %O', isImageEdit, userInput.image);
  // If there are imageUrls parameters, convert them to File objects
  if (isImageEdit) {
    try {
      // Convert all image URLs to File objects
      const imageFiles = await Promise.all(
        userInput.image.map((url: string) => convertImageUrlToFile(url)),
      );

      // According to official docs, if there are multiple images, pass an array; if only one, pass a single File
      userInput.image = imageFiles.length === 1 ? imageFiles[0] : imageFiles;
    } catch (error) {
      throw new Error(`Failed to convert image URLs to File objects: ${error}`);
    }
  } else {
    delete userInput.image;
  }

  if (userInput.size === 'auto') {
    delete userInput.size;
  }

  const defaultInput = {
    n: 1,
    ...(model.includes('dall-e') ? { response_format: 'b64_json' } : {}),
    // https://platform.openai.com/docs/api-reference/images/createEdit#images_createedit-input_fidelity
    ...(isImageEdit && model.includes('gpt-image-') && !model.includes('mini')
      ? { input_fidelity: 'high' }
      : {}),
  };

  const options = cleanObject({
    model,
    ...defaultInput,
    ...userInput,
  });

  log('options: %O', options);

  // Determine if it's an image editing operation
  const img = isImageEdit
    ? await client.images.edit(options as any)
    : await client.images.generate(options as any);

  // Check the integrity of response data
  if (!img || !img.data || !Array.isArray(img.data) || img.data.length === 0) {
    throw new Error('Invalid image response: missing or empty data array');
  }

  const imageData = img.data[0];
  if (!imageData) {
    throw new Error('Invalid image response: first data item is null or undefined');
  }

  let imageUrl: string;

  // Handle base64 format response
  if (imageData.b64_json) {
    // Determine the image's MIME type, default to PNG
    const mimeType = 'image/png'; // OpenAI image generation defaults to PNG format

    // Convert base64 string to complete data URL
    imageUrl = `data:${mimeType};base64,${imageData.b64_json}`;
    log('Successfully converted base64 to data URL, length: %d', imageUrl.length);
  }
  // Handle URL format response
  else if (imageData.url) {
    imageUrl = imageData.url;
    log('Using direct image URL: %s', imageUrl);
  }
  // If neither format exists, throw error
  else {
    throw new Error('Invalid image response: missing both b64_json and url fields');
  }

  return {
    imageUrl,
    ...(img.usage
      ? {
          modelUsage: convertOpenAIImageUsage(img.usage, await getModelPricing(model, provider)),
        }
      : {}),
  };
}

/**
 * Process image URL for chat model input
 */
async function processImageUrlForChat(imageUrl: string): Promise<string> {
  const { type, base64, mimeType } = parseDataUri(imageUrl);

  if (type === 'base64') {
    if (!base64) {
      throw new TypeError("Image URL doesn't contain base64 data");
    }
    return `data:${mimeType || 'image/png'};base64,${base64}`;
  } else if (type === 'url') {
    // For URL type, convert to base64 first
    const { base64: urlBase64, mimeType: urlMimeType } = await imageUrlToBase64(imageUrl);
    return `data:${urlMimeType};base64,${urlBase64}`;
  } else {
    throw new TypeError(`Currently we don't support image url: ${imageUrl}`);
  }
}

/**
 * Generate images using chat completion API (OpenRouter Gemini, etc.)
 */
async function generateByChatModel(
  client: OpenAI,
  payload: CreateImagePayload,
): Promise<CreateImageResponse> {
  const { model, params } = payload;
  const actualModel = model.replace(':image', ''); // Remove :image suffix

  log('Creating image via chat API with model: %s and params: %O', actualModel, params);

  // Build message content array
  const content: Array<any> = [
    {
      text: params.prompt,
      type: 'text',
    },
  ];

  // Add image for editing mode if provided
  if (params.imageUrl && params.imageUrl !== null) {
    log('Processing image URL for editing mode: %s', params.imageUrl);
    try {
      const processedImageUrl = await processImageUrlForChat(params.imageUrl);
      content.push({
        image_url: {
          url: processedImageUrl,
        },
        type: 'image_url',
      });
      log('Successfully processed image URL for chat input');
    } catch (error) {
      throw new Error(`Failed to process image URL: ${error}`);
    }
  }

  // Build request payload with image generation config
  const requestPayload: Record<string, any> = {
    messages: [
      {
        content,
        role: 'user',
      },
    ],
    model: actualModel,
    stream: false,
  };

  // Inject imageConfig and responseModalities if aspectRatio or resolution is provided
  // This supports Gemini-style image generation models via OpenAI-compatible endpoints
  if (params.aspectRatio || params.resolution) {
    const imageConfig: Record<string, string> = {};
    if (params.aspectRatio && params.aspectRatio !== 'auto') {
      imageConfig.aspectRatio = params.aspectRatio;
    }
    if (params.resolution) {
      imageConfig.imageSize = params.resolution;
    }
    if (Object.keys(imageConfig).length > 0) {
      requestPayload.imageConfig = imageConfig;
    }
    requestPayload.responseModalities = ['TEXT', 'IMAGE'];
  }

  // Call chat completion API
  const response = await client.chat.completions.create(requestPayload as any);

  log('Chat API response: %O', response);

  // Extract image from response
  const chatMessage = response.choices[0]?.message;
  if (!chatMessage) {
    throw new Error('No message in chat completion response');
  }

  // Support multiple image response formats:
  // 1. { images: [{ image_url: { url: "..." } }] }
  // 2. { image_url: { url: "..." } }
  // 3. content with markdown image format ![alt](url)
  // 4. content as direct URL string
  if ((chatMessage as any).images && Array.isArray((chatMessage as any).images)) {
    const images = (chatMessage as any).images;
    if (images.length > 0) {
      const image = images[0];
      if (image.image_url?.url) {
        log('Successfully extracted image from chat response (images array)');
        return { imageUrl: image.image_url.url };
      }
    }
  }

  // Try extracting from image_url field directly
  if ((chatMessage as any).image_url?.url) {
    log('Successfully extracted image from chat response (image_url field)');
    return { imageUrl: (chatMessage as any).image_url.url };
  }

  // Try extracting from content (markdown format or direct URL)
  if (typeof chatMessage.content === 'string') {
    // Markdown format: ![alt](url)
    const markdownMatch = chatMessage.content.match(/!\[.*?\]\((.*?)\)/);
    if (markdownMatch) {
      log('Successfully extracted image from chat response (markdown format)');
      return { imageUrl: markdownMatch[1] };
    }
    // Direct URL string
    if (chatMessage.content.startsWith('http')) {
      log('Successfully extracted image from chat response (direct URL)');
      return { imageUrl: chatMessage.content };
    }
  }

  // If no images found, throw error
  throw new Error('No image generated in chat completion response');
}

/**
 * Create image using OpenAI Compatible API
 */
export async function createOpenAICompatibleImage(
  client: OpenAI,
  payload: CreateImagePayload,
  provider: string,
): Promise<CreateImageResponse> {
  const { model } = payload;

  // Check if it's a chat model for image generation (via :image suffix)
  if (model.endsWith(':image')) {
    return await generateByChatModel(client, payload);
  }

  // Default to traditional images API
  return await generateByImageMode(client, payload, provider);
}
