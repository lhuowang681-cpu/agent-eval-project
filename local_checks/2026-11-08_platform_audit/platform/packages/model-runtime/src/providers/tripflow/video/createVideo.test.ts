import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateVideoOptions } from '../../../core/openaiCompatibleFactory';
import type { CreateVideoPayload } from '../../../types/video';
import { createTripFlowVideo } from './createVideo';

vi.mock('debug', () => ({
  default: vi.fn(() => vi.fn()),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

/** POST returns task id; subsequent GETs use the resolver. */
function stubSubmitThenPoll(
  id: string,
  getResolver: (callIndexAfterPost: number) => { json: () => Promise<unknown>; ok: boolean },
) {
  let call = 0;
  mockFetch.mockImplementation(() => {
    const i = call++;
    if (i === 0) {
      return Promise.resolve({
        json: () => Promise.resolve({ id }),
        ok: true,
      });
    }
    return Promise.resolve(getResolver(i - 1));
  });
}

describe('createTripFlowVideo', () => {
  let payload: CreateVideoPayload;
  let options: CreateVideoOptions;

  beforeEach(() => {
    vi.clearAllMocks();

    payload = {
      model: 'doubao-video-model',
      params: {
        prompt: 'a beautiful sunset over the ocean',
      },
    };

    options = {
      apiKey: 'test-api-key',
      provider: 'tripflow',
    };
  });

  describe('successful creation (submit + poll)', () => {
    it('should return inferenceId and inlineComplete when task succeeds on first poll', async () => {
      stubSubmitThenPoll('task-abc-123', () => ({
        json: () =>
          Promise.resolve({
            content: { video_url: 'https://cdn.example.com/video.mp4' },
            id: 'task-abc-123',
            status: 'succeeded',
          }),
        ok: true,
      }));

      const result = await createTripFlowVideo(payload, options);

      expect(result).toEqual({
        inferenceId: 'task-abc-123',
        inlineComplete: { videoUrl: 'https://cdn.example.com/video.mp4' },
      });
    });

    it('should send minimal POST body with only prompt', async () => {
      stubSubmitThenPoll('task-1', () => ({
        json: () =>
          Promise.resolve({
            content: { video_url: 'https://cdn.example.com/v.mp4' },
            id: 'task-1',
            status: 'succeeded',
          }),
        ok: true,
      }));

      await createTripFlowVideo(payload, options);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      expect(body.content).toEqual([{ text: 'a beautiful sunset over the ocean', type: 'text' }]);
      expect(body.model).toBe('doubao-seedance-2-0');
      expect(body.watermark).toBe(false);
      expect(body.ratio).toBeUndefined();
      expect(body.duration).toBeUndefined();
      expect(body.seed).toBeUndefined();
    });
  });

  describe('content array', () => {
    it('should add first_frame entry when imageUrl is provided', async () => {
      stubSubmitThenPoll('task-1', () => ({
        json: () =>
          Promise.resolve({
            content: { video_url: 'https://cdn.example.com/v.mp4' },
            id: 'task-1',
            status: 'succeeded',
          }),
        ok: true,
      }));

      payload.params.imageUrl = 'https://example.com/start.jpg';

      await createTripFlowVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(2);
      expect(body.content[1]).toEqual({
        image_url: { url: 'https://example.com/start.jpg' },
        role: 'first_frame',
        type: 'image_url',
      });
    });

    it('should add last_frame entry when endImageUrl is provided', async () => {
      stubSubmitThenPoll('task-1', () => ({
        json: () =>
          Promise.resolve({
            content: { video_url: 'https://cdn.example.com/v.mp4' },
            id: 'task-1',
            status: 'succeeded',
          }),
        ok: true,
      }));

      payload.params.endImageUrl = 'https://example.com/end.jpg';

      await createTripFlowVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(2);
      expect(body.content[1]).toEqual({
        image_url: { url: 'https://example.com/end.jpg' },
        role: 'last_frame',
        type: 'image_url',
      });
    });

    it('should have 3 content elements when both imageUrl and endImageUrl are provided', async () => {
      stubSubmitThenPoll('task-1', () => ({
        json: () =>
          Promise.resolve({
            content: { video_url: 'https://cdn.example.com/v.mp4' },
            id: 'task-1',
            status: 'succeeded',
          }),
        ok: true,
      }));

      payload.params.imageUrl = 'https://example.com/start.jpg';
      payload.params.endImageUrl = 'https://example.com/end.jpg';

      await createTripFlowVideo(payload, options);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.content).toHaveLength(3);
      expect(body.content[0].type).toBe('text');
      expect(body.content[1].role).toBe('first_frame');
      expect(body.content[2].role).toBe('last_frame');
    });
  });

  describe('optional params', () => {
    const succeedPoll = () => ({
      json: () =>
        Promise.resolve({
          content: { video_url: 'https://cdn.example.com/v.mp4' },
          id: 'task-1',
          status: 'succeeded',
        }),
      ok: true,
    });

    it('should map aspectRatio to body.ratio', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.aspectRatio = '16:9';
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.ratio).toBe('16:9');
    });

    it('should map duration to body.duration', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.duration = 5;
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.duration).toBe(5);
    });

    it('should map generateAudio to body.generate_audio', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.generateAudio = true;
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.generate_audio).toBe(true);
    });

    it('should map seed to body.seed', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.seed = 42;
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.seed).toBe(42);
    });

    it('should not include seed when seed is null', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.seed = null;
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.seed).toBeUndefined();
    });

    it('should map resolution to body.resolution', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.resolution = '1080p';
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.resolution).toBe('1080p');
    });

    it('should map cameraFixed to body.camera_fixed', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.params.cameraFixed = true;
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.camera_fixed).toBe(true);
    });

    it('should not send callback_url', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      payload.callbackUrl = 'https://example.com/webhook';
      await createTripFlowVideo(payload, options);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.callback_url).toBeUndefined();
    });
  });

  describe('client config', () => {
    const succeedPoll = () => ({
      json: () =>
        Promise.resolve({
          content: { video_url: 'https://cdn.example.com/v.mp4' },
          id: 'task-1',
          status: 'succeeded',
        }),
      ok: true,
    });

    it('should use default baseURL for POST', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      await createTripFlowVideo(payload, options);

      const fetchUrl = mockFetch.mock.calls[0][0];
      expect(fetchUrl).toBe(
        'http://aigw.fx.ctripcorp.com/llm/100000533/contents/generations/tasks',
      );
    });

    it('should use custom baseURL when provided', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      options.baseURL = 'https://custom-endpoint.com/api/v3';
      await createTripFlowVideo(payload, options);

      expect(mockFetch.mock.calls[0][0]).toBe(
        'https://custom-endpoint.com/api/v3/contents/generations/tasks',
      );
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://custom-endpoint.com/api/v3/contents/generations/tasks/task-1',
      );
    });

    it('should send Authorization Bearer on POST', async () => {
      stubSubmitThenPoll('task-1', succeedPoll);
      await createTripFlowVideo(payload, options);

      const fetchHeaders = mockFetch.mock.calls[0][1].headers;
      expect(fetchHeaders['Authorization']).toBe('Bearer test-api-key');
      expect(fetchHeaders['Content-Type']).toBe('application/json');
    });
  });

  describe('error handling', () => {
    it('should throw on POST HTTP error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limit exceeded'),
      });

      await expect(createTripFlowVideo(payload, options)).rejects.toThrow(
        'TripYoYo video API error: 429 Rate limit exceeded',
      );
    });

    it('should throw when submit response has no id', async () => {
      mockFetch.mockResolvedValue({
        json: () => Promise.resolve({}),
        ok: true,
      });

      await expect(createTripFlowVideo(payload, options)).rejects.toThrow(
        'Invalid response: missing task id',
      );
    });

    it('should fail polling when API returns task error', async () => {
      stubSubmitThenPoll('task-1', () => ({
        json: () =>
          Promise.resolve({
            error: { message: 'policy' },
            id: 'task-1',
            status: 'failed',
          }),
        ok: true,
      }));

      await expect(createTripFlowVideo(payload, options)).rejects.toThrow('policy');
    });
  });
});
