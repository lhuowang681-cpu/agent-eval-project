// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTripflowImage } from './createImage';

vi.mock('@lobechat/utils', () => ({
  imageUrlToBase64: vi.fn().mockResolvedValue({
    base64: 'converted-image-base64',
    mimeType: 'image/png',
  }),
}));

const options = {
  apiKey: 'test-api-key',
  baseURL: 'https://tripflow.example.com/llm/100002448',
};

const mockFetchSuccess = (data: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue(data),
    ok: true,
  });

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
};

describe('createTripflowImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps Gemini image generation on chat completions', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { image_url: { url: 'https://example.com/gemini.png' } } }],
    });

    const result = await createTripflowImage(
      {
        model: 'gemini-3-pro-image-preview',
        params: { aspectRatio: '1:1', prompt: 'a cat', resolution: '1K' },
      },
      options,
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/gemini.png' });
    const [url, init] = fetchMock.mock.calls.find(([requestUrl]) =>
      String(requestUrl).endsWith('/v1/chat/completions'),
    )!;
    expect(url).toBe('https://tripflow.example.com/llm/100002448/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a cat' }] }],
      model: 'gemini-3-pro-image-preview',
      responseModalities: ['TEXT', 'IMAGE'],
    });
  });

  it('passes reference images to Gemini chat completions', async () => {
    const fetchMock = mockFetchSuccess({
      choices: [{ message: { image_url: { url: 'https://example.com/gemini-edited.png' } } }],
    });

    const result = await createTripflowImage(
      {
        model: 'gemini-3-pro-image-preview',
        params: {
          imageUrls: ['https://example.com/input.png'],
          prompt: 'make it warmer',
        },
      },
      options,
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/gemini-edited.png' });

    const [, init] = fetchMock.mock.calls.find(([requestUrl]) =>
      String(requestUrl).endsWith('/v1/chat/completions'),
    )!;
    expect(JSON.parse(init.body as string)).toMatchObject({
      messages: [
        {
          content: [
            { text: 'make it warmer', type: 'text' },
            {
              image_url: { url: 'data:image/png;base64,converted-image-base64' },
              type: 'image_url',
            },
          ],
          role: 'user',
        },
      ],
      model: 'gemini-3-pro-image-preview',
      responseModalities: ['TEXT', 'IMAGE'],
    });
  });

  it('calls images generations for gpt-image-2 without reference images', async () => {
    const fetchMock = mockFetchSuccess({
      data: [{ b64_json: 'generated-base64' }],
    });

    const result = await createTripflowImage(
      {
        model: 'gpt-image-2',
        params: { prompt: 'a city', quality: 'auto', size: 'auto' },
      },
      options,
    );

    expect(result).toEqual({ imageUrl: 'data:image/png;base64,generated-base64' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://tripflow.example.com/llm/100002448/images/generations',
      expect.objectContaining({
        body: JSON.stringify({
          model: 'gpt-image-2',
          n: 1,
          prompt: 'a city',
          quality: 'auto',
        }),
        headers: {
          'Authorization': 'Bearer test-api-key',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      }),
    );
  });

  it('omits custom size from gpt-image-2 generations request', async () => {
    const fetchMock = mockFetchSuccess({
      data: [{ b64_json: 'generated-base64' }],
    });

    await createTripflowImage(
      {
        model: 'gpt-image-2',
        params: { prompt: 'a city', size: 'custom' },
      },
      options,
    );

    const [, init] = fetchMock.mock.calls.find(([requestUrl]) =>
      String(requestUrl).endsWith('/images/generations'),
    )!;
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'gpt-image-2',
      n: 1,
      prompt: 'a city',
    });
  });

  it('calls images edits for gpt-image-2 with reference images', async () => {
    const fetchMock = mockFetchSuccess({
      data: [{ url: 'https://example.com/edited.png' }],
    });

    const result = await createTripflowImage(
      {
        model: 'gpt-image-2',
        params: {
          imageUrls: ['data:image/png;base64,aW1hZ2U='],
          prompt: 'make it warmer',
          quality: 'high',
          size: '1024x1024',
        },
      },
      options,
    );

    expect(result).toEqual({ imageUrl: 'https://example.com/edited.png' });

    const [url, init] = fetchMock.mock.calls.find(([requestUrl]) =>
      String(requestUrl).endsWith('/images/edits'),
    )!;
    expect(url).toBe('https://tripflow.example.com/llm/100002448/images/edits');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer test-api-key' });

    const body = init.body as FormData;
    expect(body.get('model')).toBe('gpt-image-2');
    expect(body.get('prompt')).toBe('make it warmer');
    expect(body.get('size')).toBe('1024x1024');
    expect(body.get('quality')).toBe('high');
    expect(body.get('n')).toBe('1');
    expect(body.getAll('image')).toHaveLength(1);
  });

  it('rejects unsupported image models', async () => {
    await expect(
      createTripflowImage({ model: 'unknown-image-model', params: { prompt: 'test' } }, options),
    ).rejects.toThrow(
      'Unsupported model: unknown-image-model. Only gemini-3-pro-image-preview, gpt-image-2 are supported.',
    );
  });
});
