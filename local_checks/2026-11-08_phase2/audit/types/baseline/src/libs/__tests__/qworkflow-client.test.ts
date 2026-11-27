// @vitest-environment node
import { Client } from '@ctrip/qworkflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const createResponse = (status: number, body?: unknown) =>
  new Response(body ? JSON.stringify(body) : '', {
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });

describe('@ctrip/qworkflow Client', () => {
  const TEST_URL = 'https://zxqstash.example.com';
  const TEST_TOKEN = 'test-workflow-token';

  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_SERVER_URL', TEST_URL);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('constructor', () => {
    it('creates client with token and env URL', () => {
      const client = new Client({ token: TEST_TOKEN });
      expect(client).toBeInstanceOf(Client);
    });

    it('creates client with explicit URL override', () => {
      const client = new Client({ token: TEST_TOKEN, url: 'https://custom.example.com' });
      expect(client).toBeInstanceOf(Client);
    });

    it('accepts custom headers', () => {
      const client = new Client({
        token: TEST_TOKEN,
        headers: { 'x-custom': 'value' },
      });
      expect(client).toBeInstanceOf(Client);
    });

    it('throws when no URL is available', () => {
      vi.unstubAllEnvs();
      expect(() => new Client({ token: TEST_TOKEN })).toThrow('ZXQSTASH_SERVER_URL is required');
    });
  });

  describe('trigger', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('triggers a workflow with basic payload', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { workflowRunId: 'wf-run-001' }));

      const result = await client.trigger({
        url: 'https://app.example.com/api/workflows/memory/process-topics',
        body: { userId: 'user-1', topicIds: ['t1', 't2'] },
      });

      expect(result).toEqual({ workflowRunId: 'wf-run-001' });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${TEST_URL}/v1/workflows/runs`);
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);

      const body = JSON.parse(options.body);
      expect(body.url).toBe('https://app.example.com/api/workflows/memory/process-topics');
      expect(body.body).toEqual({ userId: 'user-1', topicIds: ['t1', 't2'] });
    });

    it('triggers with flow control configuration', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { workflowRunId: 'wf-run-002' }));

      await client.trigger({
        url: 'https://app.example.com/api/workflows/memory/process-topics',
        body: { userId: 'user-1' },
        flowControl: {
          key: 'memory-user-memory.process-topics.user.user-1',
          parallelism: 5,
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.flowControl).toEqual({
        key: 'memory-user-memory.process-topics.user.user-1',
        parallelism: 5,
      });
    });

    it('triggers with custom headers', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { workflowRunId: 'wf-run-003' }));

      await client.trigger({
        url: 'https://app.example.com/api/workflows/test',
        body: {},
        headers: {
          'x-custom-header': 'custom-value',
          'x-request-id': 'req-123',
        },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.headers).toEqual({
        'x-custom-header': 'custom-value',
        'x-request-id': 'req-123',
      });
    });

    it('triggers with retries and delay', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { workflowRunId: 'wf-run-004' }));

      await client.trigger({
        url: 'https://app.example.com/api/workflows/test',
        body: {},
        retries: 3,
        delay: 60,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.retries).toBe(3);
      expect(body.delay).toBe(60);
    });

    it('throws on server error', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(500, { error: 'Internal Server Error' }));

      await expect(
        client.trigger({
          url: 'https://app.example.com/api/workflows/test',
          body: {},
        }),
      ).rejects.toThrow('HTTP 500');
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await expect(
        client.trigger({
          url: 'https://app.example.com/api/workflows/test',
          body: {},
        }),
      ).rejects.toThrow('Network error');
    });
  });

  describe('cancel', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('cancels a running workflow', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { cancelled: 1 }));

      const result = await client.cancel('wf-run-to-cancel');

      expect(result).toEqual({ cancelled: 1 });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${TEST_URL}/v1/workflows/runs/wf-run-to-cancel`);
      expect(options.method).toBe('DELETE');
    });

    it('returns cancelled: 0 for non-existent workflow', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { cancelled: 0 }));

      const result = await client.cancel('non-existent');
      expect(result).toEqual({ cancelled: 0 });
    });
  });

  describe('trailing slash handling', () => {
    it('strips trailing slash from URL', async () => {
      const client = new Client({ token: TEST_TOKEN, url: 'https://example.com/' });
      mockFetch.mockResolvedValueOnce(createResponse(200, { workflowRunId: 'wf-ts' }));

      await client.trigger({
        url: 'https://app.example.com/api/workflows/test',
        body: {},
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://example.com/v1/workflows/runs');
    });
  });
});
