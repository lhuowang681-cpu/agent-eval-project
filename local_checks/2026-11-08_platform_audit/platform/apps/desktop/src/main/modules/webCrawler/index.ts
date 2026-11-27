/**
 * Self-contained local web fetch for the desktop app (Electron main process).
 *
 * This is the desktop equivalent of Claude Code's web fetch: fetch the URL with
 * the platform's native fetch and convert HTML to markdown via readability. It
 * runs entirely on the user's machine, so it can reach intranet/private
 * addresses that the shared server (Firecrawl) cannot, and there is no SSRF
 * concern.
 *
 * It intentionally depends on NOTHING from `@lobechat/web-crawler` — that
 * package's crawl-impl barrel pulls server-only deps (`@lobechat/utils/server`
 * → `next/headers` + auth) that break the Electron build.
 */
import { htmlToMarkdown } from './htmlToMarkdown';

/** ~Mirror of @lobechat/web-crawler CrawlSuccessResult */
export interface CrawlSuccessResult {
  content?: string;
  contentType: 'json' | 'text';
  description?: string;
  length?: number;
  siteName?: string;
  title?: string;
  url: string;
}

/** ~Mirror of @lobechat/web-crawler CrawlErrorResult */
export interface CrawlErrorResult {
  content: string;
  errorMessage?: string;
  errorType?: string;
  url?: string;
}

/** ~Mirror of @lobechat/web-crawler CrawlUniformResult — keep in sync with the server shape. */
export interface CrawlUniformResult {
  crawler: string;
  data: CrawlErrorResult | CrawlSuccessResult;
  originalUrl: string;
  transformedUrl?: string;
}

const DEFAULT_TIMEOUT = 10_000;

const mixinHeaders = {
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8',
  'Cache-Control': 'max-age=0',
  'Referer': 'https://www.google.com/',
  'Upgrade-Insecure-Requests': '1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="121", "Not A(Brand";v="99", "Chromium";v="121"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
};

const fetchWithTimeout = async (url: string, ms = DEFAULT_TIMEOUT): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(url, { headers: mixinHeaders, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Fetch one URL and convert it to markdown.
 * Returns `undefined` when there is no usable content (too short / blocked).
 * Throws on network / HTTP errors so the caller can surface them.
 */
const fetchPage = async (url: string): Promise<CrawlSuccessResult | undefined> => {
  const res = await fetchWithTimeout(url);

  if (res.status === 404) {
    throw new Error(`PageNotFound: ${res.statusText}`);
  }

  if (!res.ok) {
    throw new Error(`Local request failed with status ${res.status}: ${res.statusText}`);
  }

  const type = res.headers.get('content-type');

  if (type?.includes('application/json')) {
    let content: string;

    try {
      const json = await res.clone().json();
      content = JSON.stringify(json, null, 2);
    } catch {
      content = await res.text();
    }

    return { content, contentType: 'json', length: content.length, url };
  }

  const html = await res.text();
  const result = htmlToMarkdown(html, { url });

  // empty or too short content is not useful
  if (!result.content || result.content.length < 100) return;

  // blocked by Cloudflare
  if (result.title === 'Just a moment...') return;

  return {
    content: result.content,
    contentType: 'text',
    description: result.description,
    length: result.length,
    siteName: result.siteName,
    title: result.title,
    url,
  };
};

/** Crawl a single URL, returning the same uniform shape as the server `Crawler`. */
export const crawlPageLocal = async (url: string): Promise<CrawlUniformResult> => {
  try {
    const data = await fetchPage(url);

    if (data?.content && data.content.length > 100) {
      return { crawler: 'local', data, originalUrl: url };
    }

    return {
      crawler: 'local',
      data: {
        content:
          'Fail to crawl the page. Error type: EmptyCrawlResultError, error message: local returned empty or short content',
        errorMessage: 'local returned empty or short content',
        errorType: 'EmptyCrawlResultError',
        url,
      },
      originalUrl: url,
    };
  } catch (error) {
    const err = error as Error;
    const errorType = err?.name || 'UnknownError';
    const errorMessage = err?.message;

    return {
      crawler: 'local',
      data: {
        content: `Fail to crawl the page. Error type: ${errorType}, error message: ${errorMessage}`,
        errorMessage,
        errorType,
        url,
      },
      originalUrl: url,
    };
  }
};

/** Crawl multiple URLs in parallel. */
export const crawlPagesLocal = async (
  urls: string[],
): Promise<{ results: CrawlUniformResult[] }> => {
  const results = await Promise.all(urls.map((url) => crawlPageLocal(url)));

  return { results };
};
