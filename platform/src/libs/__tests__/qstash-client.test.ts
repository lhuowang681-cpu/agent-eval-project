// @vitest-environment node
import { Client, QstashHttpError, QstashNetworkError, QstashRateLimitError } from '@ctrip/qstash';
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

describe('@ctrip/qstash Client', () => {
  const TEST_URL = 'https://zxqstash.example.com';
  const TEST_TOKEN = 'test-token-123';

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

    it('creates client with explicit url override', () => {
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

    it('accepts custom retry config', () => {
      const client = new Client({
        token: TEST_TOKEN,
        retry: { attempts: 5, backoff: (n) => n * 500 },
      });
      expect(client).toBeInstanceOf(Client);
    });

    it('throws QstashError when no URL is available', () => {
      vi.unstubAllEnvs();
      expect(() => new Client({ token: TEST_TOKEN })).toThrow('ZXQSTASH_SERVER_URL is required');
    });
  });

  describe('publishJSON', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('publishes a basic JSON message', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-001' }));

      const result = await client.publishJSON({
        url: 'https://api.example.com/webhook',
        body: { event: 'test', data: { id: 1 } },
      });

      expect(result).toEqual({ messageId: 'msg-001' });
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${TEST_URL}/v1/messages`);
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe(`Bearer ${TEST_TOKEN}`);
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.url).toBe('https://api.example.com/webhook');
      expect(body.body).toEqual({ event: 'test', data: { id: 1 } });
    });

    it('publishes with delay and retries', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-002' }));

      await client.publishJSON({
        url: 'https://api.example.com/webhook',
        body: { task: 'delayed' },
        delay: 60,
        retries: 3,
        retryDelay: 30,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.delay).toBe(60);
      expect(body.retries).toBe(3);
      expect(body.retryDelay).toBe(30);
    });

    it('merges client-level and request-level headers', async () => {
      const clientWithHeaders = new Client({
        token: TEST_TOKEN,
        headers: { 'x-client': 'client-value' },
      });
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-003' }));

      await clientWithHeaders.publishJSON({
        url: 'https://api.example.com/webhook',
        body: {},
        headers: { 'x-request': 'request-value' },
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.headers).toEqual({
        'x-client': 'client-value',
        'x-request': 'request-value',
      });
    });

    it('publishes with timeout and deduplication', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-004' }));

      await client.publishJSON({
        url: 'https://api.example.com/webhook',
        body: { task: 'dedup' },
        timeout: 30000,
        contentBasedDeduplicationId: 'dedup-001',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.timeout).toBe(30000);
      expect(body.contentBasedDeduplicationId).toBe('dedup-001');
    });

    it('throws QstashHttpError on 4xx response', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(400, { error: 'Bad Request' }));

      await expect(
        client.publishJSON({
          url: 'https://api.example.com/webhook',
          body: {},
        }),
      ).rejects.toThrow(QstashHttpError);
    });

    it('throws QstashRateLimitError on 429 response', async () => {
      const response = new Response('', { status: 429, headers: { 'Retry-After': '5' } });
      mockFetch.mockResolvedValueOnce(response);

      try {
        await client.publishJSON({ url: 'https://api.example.com/webhook', body: {} });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(QstashRateLimitError);
        expect((error as QstashRateLimitError).retryAfter).toBe(5);
      }
    });

    it('retries on 5xx errors', async () => {
      mockFetch
        .mockResolvedValueOnce(createResponse(500, { error: 'Internal Server Error' }))
        .mockResolvedValueOnce(createResponse(200, { messageId: 'msg-retry' }));

      const result = await client.publishJSON({
        url: 'https://api.example.com/webhook',
        body: {},
      });

      expect(result.messageId).toBe('msg-retry');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx client errors', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(400, { error: 'Bad Request' }));

      await expect(
        client.publishJSON({ url: 'https://api.example.com/webhook', body: {} }),
      ).rejects.toThrow(QstashHttpError);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('batch', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('publishes multiple messages in a batch', async () => {
      mockFetch.mockResolvedValueOnce(
        createResponse(200, {
          responses: [
            { messageId: 'msg-batch-1' },
            { messageId: 'msg-batch-2' },
            { messageId: 'msg-batch-3' },
          ],
        }),
      );

      const result = await client.batch({
        messages: [
          { url: 'https://api.example.com/a', body: { id: 1 } },
          { url: 'https://api.example.com/b', body: { id: 2 } },
          { url: 'https://api.example.com/c', body: { id: 3 }, delay: 10 },
        ],
      });

      expect(result.responses).toHaveLength(3);
      expect(result.responses[0]).toEqual({ messageId: 'msg-batch-1' });
      expect(result.responses[2]).toEqual({ messageId: 'msg-batch-3' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[2].delay).toBe(10);
    });

    it('handles partial failures in batch response', async () => {
      mockFetch.mockResolvedValueOnce(
        createResponse(200, {
          responses: [{ messageId: 'msg-ok' }, { error: 'rate limited' }],
        }),
      );

      const result = await client.batch({
        messages: [
          { url: 'https://api.example.com/a', body: {} },
          { url: 'https://api.example.com/b', body: {} },
        ],
      });

      expect(result.responses[0]).toEqual({ messageId: 'msg-ok' });
      expect(result.responses[1]).toEqual({ error: 'rate limited' });
    });
  });

  describe('messages.delete', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('deletes a message by ID', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      await client.messages.delete('msg-to-delete');

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${TEST_URL}/v1/messages/msg-to-delete`);
      expect(options.method).toBe('DELETE');
    });

    it('is idempotent - ignores 404 errors', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(404, { error: 'not found' }));

      // Should not throw
      await expect(client.messages.delete('non-existent')).resolves.toBeUndefined();
    });

    it('is idempotent - ignores 409 errors (already delivered)', async () => {
      mockFetch.mockResolvedValueOnce(createResponse(409, { error: 'already delivered' }));

      await expect(client.messages.delete('delivered-msg')).resolves.toBeUndefined();
    });

    it('retries and throws QstashNetworkError after exhausting attempts on 500', async () => {
      // Client retries 3 times by default, so provide 3 failure responses
      mockFetch
        .mockResolvedValueOnce(createResponse(500, { error: 'server error' }))
        .mockResolvedValueOnce(createResponse(500, { error: 'server error' }))
        .mockResolvedValueOnce(createResponse(500, { error: 'server error' }));

      await expect(client.messages.delete('msg-err')).rejects.toThrow(QstashNetworkError);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('messages.deleteMany', () => {
    let client: Client;

    beforeEach(() => {
      client = new Client({ token: TEST_TOKEN });
    });

    it('deletes multiple messages in batch', async () => {
      mockFetch.mockResolvedValueOnce(new Response('', { status: 200 }));

      await client.messages.deleteMany(['msg-1', 'msg-2', 'msg-3']);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe(`${TEST_URL}/v1/messages/batch-delete`);
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });
  });

  describe('Vercel protection bypass', () => {
    it('includes bypass header in client default headers', async () => {
      const client = new Client({
        token: TEST_TOKEN,
        headers: { 'x-vercel-protection-bypass': 'secret-123' },
      });
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-v' }));

      await client.publishJSON({
        url: 'https://api.example.com/webhook',
        body: {},
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.headers['x-vercel-protection-bypass']).toBe('secret-123');
    });
  });

  describe('trailing slash handling', () => {
    it('strips trailing slash from URL', async () => {
      const client = new Client({ token: TEST_TOKEN, url: 'https://example.com/' });
      mockFetch.mockResolvedValueOnce(createResponse(200, { messageId: 'msg-ts' }));

      await client.publishJSON({ url: 'https://target.com/hook', body: {} });

      const [calledUrl] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://example.com/v1/messages');
    });
  });
});
