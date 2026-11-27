import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockResponse } from '../../test-utils';
import { NetworkConnectionError, PageNotFoundError, TimeoutError } from '../../utils/errorType';
import * as withTimeoutModule from '../../utils/withTimeout';
import { firecrawl } from '../firecrawl';

// Mock dependencies
vi.mock('@lobechat/utils/server', () => ({
  withProxy: (fetchImpl: typeof fetch) => fetchImpl,
}));

describe('firecrawl crawler', () => {
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation((fn) =>
      fn(new AbortController().signal),
    );
    delete process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_URL;
  });

  it('should successfully crawl content with API key', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      success: true,
      data: {
        markdown: 'This is a test markdown content with enough length to pass validation. '.repeat(
          3,
        ),
        metadata: {
          title: 'Test Article',
          description: 'Test description',
          sourceURL: 'https://example.com',
          statusCode: 200,
          language: 'en',
          keywords: 'test',
          robots: 'index',
        },
      },
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'This is a test markdown content with enough length to pass validation. '.repeat(3),
      contentType: 'text',
      description: 'Test description',
      length: 'This is a test markdown content with enough length to pass validation. '.repeat(3)
        .length,
      siteName: 'example.com',
      title: 'Test Article',
      url: 'https://example.com',
    });

    expect(withTimeoutModule.withTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
  });

  it('should handle missing API key', async () => {
    const mockResponse = createMockResponse({
      success: true,
      data: {
        markdown: 'Test content with sufficient length. '.repeat(5),
        metadata: {
          title: 'Test',
          description: 'Test',
          sourceURL: 'https://example.com',
          statusCode: 200,
          language: 'en',
          keywords: 'test',
          robots: 'index',
        },
      },
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    await firecrawl('https://example.com', { filterOptions: {} });

    expect(withTimeoutModule.withTimeout).toHaveBeenCalledWith(expect.any(Function), 10_000);
  });

  it('should parse response inside the timeout boundary', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';
    let insideTimeoutBoundary = false;

    const mockResponse = createMockResponse({
      success: true,
      data: {
        markdown: 'Test content with sufficient length. '.repeat(5),
        metadata: {
          title: 'Test',
          description: 'Test',
          sourceURL: 'https://example.com',
          statusCode: 200,
        },
      },
    });
    mockResponse.json = vi.fn().mockImplementation(async () => {
      if (!insideTimeoutBoundary) throw new Error('JSON parsed outside timeout boundary');

      return {
        success: true,
        data: {
          markdown: 'Test content with sufficient length. '.repeat(5),
          metadata: {
            title: 'Test',
            description: 'Test',
            sourceURL: 'https://example.com',
            statusCode: 200,
          },
        },
      };
    });

    mockFetch.mockResolvedValue(mockResponse as any);
    vi.spyOn(withTimeoutModule, 'withTimeout').mockImplementation(async (fn) => {
      insideTimeoutBoundary = true;
      try {
        return await fn(new AbortController().signal);
      } finally {
        insideTimeoutBoundary = false;
      }
    });

    await firecrawl('https://example.com', { filterOptions: {} });

    expect(mockFetch).toHaveBeenCalled();
    expect(mockResponse.json).toHaveBeenCalled();
  });

  it('should return undefined for short content', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      success: true,
      data: {
        markdown: 'Short', // Content too short
        metadata: {
          title: 'Test',
          description: 'Test',
          sourceURL: 'https://example.com',
          statusCode: 200,
          language: 'en',
          keywords: 'test',
          robots: 'index',
        },
      },
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should return undefined when markdown is missing', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      success: true,
      data: {
        // markdown is missing
        metadata: {
          title: 'Test',
          description: 'Test',
          sourceURL: 'https://example.com',
          statusCode: 200,
          language: 'en',
          keywords: 'test',
          robots: 'index',
        },
      },
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toBeUndefined();
  });

  it('should throw PageNotFoundError for 404 status', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('Not Found', {
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      PageNotFoundError,
    );
  });

  it('should throw error for other HTTP errors', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('', {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Firecrawl request failed with status 500: Internal Server Error',
    );
  });

  it('should throw NetworkConnectionError for fetch failures', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(new TypeError('fetch failed'));

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      NetworkConnectionError,
    );
  });

  it('should throw TimeoutError when request times out', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const timeoutError = new TimeoutError('Request timeout');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(timeoutError);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      TimeoutError,
    );
  });

  it('should rethrow unknown errors', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const unknownError = new Error('Unknown error');

    const { withTimeout } = await import('../../utils/withTimeout');
    vi.mocked(withTimeout).mockRejectedValue(unknownError);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Unknown error',
    );
  });

  it('should throw ResponseBodyParseError when JSON parsing fails', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse('not json', { ok: true });
    mockResponse.json = vi.fn().mockRejectedValue(new Error('Invalid JSON'));
    mockResponse.clone.mockReturnValue({
      ...mockResponse,
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: vi.fn().mockResolvedValue('not json'),
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    await expect(firecrawl('https://example.com', { filterOptions: {} })).rejects.toThrow(
      'Firecrawl returned non-JSON response: not json',
    );
  });

  it('should handle metadata with all optional fields', async () => {
    process.env.FIRECRAWL_API_KEY = 'test-api-key';

    const mockResponse = createMockResponse({
      success: true,
      data: {
        markdown: 'Complete test content with all metadata fields provided. '.repeat(3),
        metadata: {
          title: 'Complete Test Article',
          description: 'Complete test description',
          keywords: 'test,complete,article',
          language: 'en',
          ogDescription: 'OG description',
          ogImage: 'https://example.com/image.jpg',
          ogLocaleAlternate: ['en-US', 'fr-FR'],
          ogSiteName: 'Example Site',
          ogTitle: 'OG Title',
          ogUrl: 'https://example.com/og',
          robots: 'index,follow',
          statusCode: 200,
          sourceURL: 'https://example.com',
        },
      },
    });

    mockFetch.mockResolvedValue(mockResponse as any);

    const result = await firecrawl('https://example.com', { filterOptions: {} });

    expect(result).toEqual({
      content: 'Complete test content with all metadata fields provided. '.repeat(3),
      contentType: 'text',
      description: 'Complete test description',
      length: 'Complete test content with all metadata fields provided. '.repeat(3).length,
      siteName: 'example.com',
      title: 'Complete Test Article',
      url: 'https://example.com',
    });
  });
});
