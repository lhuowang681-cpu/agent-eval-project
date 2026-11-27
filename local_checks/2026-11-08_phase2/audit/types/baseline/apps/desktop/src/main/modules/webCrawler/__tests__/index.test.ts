import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { crawlPageLocal, crawlPagesLocal } from '../index';

// Mock the HTML→markdown step so tests focus on the crawl/fetch logic.
vi.mock('../htmlToMarkdown', () => ({
  htmlToMarkdown: vi.fn(),
}));

const makeHtmlResponse = (html: string) => ({
  status: 200,
  ok: true,
  headers: new Map([['content-type', 'text/html']]),
  text: vi.fn().mockResolvedValue(html),
});

describe('crawlPageLocal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches with native fetch (no SSRF guard) so intranet URLs are reachable', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(makeHtmlResponse('<html><body>Intranet</body></html>'));
    vi.stubGlobal('fetch', fetchSpy);

    const { htmlToMarkdown } = await import('../htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({
      content: 'Intranet content'.padEnd(101, ' '),
      title: 'Intranet Page',
      length: 101,
    });

    const result = await crawlPageLocal('http://10.0.0.1/internal');

    // Native fetch hits the private address directly — no ssrfSafeFetch wrapping.
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://10.0.0.1/internal',
      expect.objectContaining({ headers: expect.any(Object), signal: expect.anything() }),
    );
    expect(result.crawler).toBe('local');
    expect(result.data).toMatchObject({ contentType: 'text', title: 'Intranet Page' });
  });

  it('parses JSON responses', async () => {
    // Payload must exceed the 100-char usable-content threshold (same as the
    // server Crawler), otherwise it is treated as empty content.
    const json = { description: 'x'.repeat(120), hello: 'world' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map([['content-type', 'application/json']]),
        clone: () => ({ json: vi.fn().mockResolvedValue(json) }),
      }),
    );

    const result = await crawlPageLocal('https://api.example.com/data');

    expect(result.data).toMatchObject({
      content: JSON.stringify(json, null, 2),
      contentType: 'json',
    });
  });

  it('returns a structured error result for short content (never throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeHtmlResponse('<html><body>x</body></html>')),
    );

    const { htmlToMarkdown } = await import('../htmlToMarkdown');
    vi.mocked(htmlToMarkdown).mockReturnValue({ content: 'short', title: 'x', length: 5 });

    const result = await crawlPageLocal('https://example.com');

    expect(result.data).toMatchObject({ errorType: 'EmptyCrawlResultError' });
  });

  it('captures fetch failures as a structured error result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const result = await crawlPageLocal('https://example.com');

    expect(result.crawler).toBe('local');
    expect('errorMessage' in result.data).toBe(true);
  });
});

describe('crawlPagesLocal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns one result per url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));

    const { results } = await crawlPagesLocal(['https://a.example.com', 'https://b.example.com']);

    expect(results).toHaveLength(2);
    expect(results.map((r) => r.originalUrl)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});
