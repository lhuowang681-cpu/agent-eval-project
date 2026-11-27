import type { SearchParams, SearchQuery } from '@lobechat/types';
import type { Crawler, CrawlImplType, CrawlUniformResult } from '@lobechat/web-crawler';
import pMap from 'p-map';

import { toolsEnv } from '@/envs/tools';

import { type SearchImplType, type SearchServiceImpl } from './impls';
import { createSearchServiceImpl } from './impls';
import proxyWhitelistData from './proxy-white-list.json';

const DEFAULT_CRAWL_CONCURRENCY = 3;
const DEFAULT_CRAWLER_RETRY = 1;
const DEFAULT_CRAWL_ATTEMPT_TIMEOUT = 10_000;

const withCrawlAttemptTimeout = <T>(
  fn: () => Promise<T>,
  ms: number = DEFAULT_CRAWL_ATTEMPT_TIMEOUT,
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`Request timeout after ${ms}ms`);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
  });

  return Promise.race([
    Promise.resolve()
      .then(fn)
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      }),
    timeoutPromise,
  ]);
};

const parseImplEnv = (envString: string = '') => {
  // Handle full-width commas and extra whitespace
  const envValue = envString.replaceAll('，', ',').trim();
  return envValue.split(',').filter(Boolean);
};

// 构建高效的查找结构
const buildWhitelistLookup = (
  whitelist: string[],
): { exactSet: Set<string>; wildcardSuffixes: string[] } => {
  const exactSet = new Set<string>();
  const wildcardSuffixes: string[] = [];

  for (const pattern of whitelist) {
    if (pattern.startsWith('*.')) {
      wildcardSuffixes.push(pattern.slice(2));
    } else {
      exactSet.add(pattern);
    }
  }

  return { exactSet, wildcardSuffixes };
};

const isUrlInWhitelistOptimized = (
  hostname: string,
  exactSet: Set<string>,
  wildcardSuffixes: string[],
): boolean => {
  // 精确匹配 O(1)
  if (exactSet.has(hostname)) return true;

  // 通配符匹配 - 检查是否是后缀
  for (const suffix of wildcardSuffixes) {
    if (hostname === suffix || hostname.endsWith(`.${suffix}`)) return true;
  }

  return false;
};

/**
 * Search service class
 * Uses different implementations for different search operations
 */
export class SearchService {
  private searchImpList: SearchServiceImpl[];

  private get crawlerImpls() {
    return parseImplEnv(toolsEnv.CRAWLER_IMPLS);
  }

  private get crawlConcurrency() {
    return toolsEnv.CRAWL_CONCURRENCY ?? DEFAULT_CRAWL_CONCURRENCY;
  }

  private get crawlerRetry() {
    return toolsEnv.CRAWLER_RETRY ?? DEFAULT_CRAWLER_RETRY;
  }

  constructor() {
    const impls = this.searchImpls;
    this.searchImpList =
      impls.length > 0
        ? impls.map((impl) => createSearchServiceImpl(impl))
        : [createSearchServiceImpl()];
  }

  async crawlPages(input: { impls?: CrawlImplType[]; urls: string[] }) {
    const { urls } = input;

    if (toolsEnv.DISABLE_PUBLIC_WEB_PAGE_CRAWL) {
      return { results: urls.map((url) => this.createPublicWebCrawlDisabledResult(url)) };
    }

    const { Crawler } = await import('@lobechat/web-crawler');
    const crawler = new Crawler({ impls: this.crawlerImpls });

    const results = await pMap(
      urls,
      async (url) => this.crawlWithRetry(crawler, url, input.impls),
      {
        concurrency: this.crawlConcurrency,
      },
    );

    return { results };
  }

  /**
   * 公网网页抓取被环境变量关闭时的占位结果
   */
  private createPublicWebCrawlDisabledResult(url: string): CrawlUniformResult {
    return {
      crawler: 'public-web-crawl-disabled',
      data: {
        content: '',
        errorMessage: 'Public web page crawling is disabled on this server.',
        errorType: 'PublicWebCrawlDisabled',
      },
      originalUrl: url,
    };
  }

  private async crawlWithRetry(
    crawler: Crawler,
    url: string,
    impls?: CrawlImplType[],
  ): Promise<CrawlUniformResult> {
    const maxAttempts = this.crawlerRetry + 1;
    let lastResult: CrawlUniformResult | undefined;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await withCrawlAttemptTimeout(() => crawler.crawl({ impls, url }));
        lastResult = result;

        if (!this.isFailedCrawlResult(result)) {
          return result;
        }
      } catch (error) {
        lastError = error as Error;
      }
    }

    if (lastResult) {
      return lastResult;
    }

    return {
      crawler: 'unknown',
      data: {
        content: `Fail to crawl the page. Error type: ${lastError?.name || 'UnknownError'}, error message: ${lastError?.message}`,
        errorMessage: lastError?.message,
        errorType: lastError?.name || 'UnknownError',
      },
      originalUrl: url,
    };
  }

  /**
   * A successful crawl result always includes `contentType` (e.g. 'text', 'json')
   * in `result.data`, while a failed result contains `errorType`/`errorMessage` instead.
   */
  private isFailedCrawlResult(result: CrawlUniformResult): boolean {
    return !('contentType' in result.data);
  }

  private get searchImpls() {
    return parseImplEnv(toolsEnv.SEARCH_PROVIDERS) as SearchImplType[];
  }

  /**
   * Query for search results using the specified impl
   */
  private async queryWithImpl(impl: SearchServiceImpl, query: string, params?: SearchParams) {
    try {
      return await impl.query(query, params);
    } catch (e) {
      console.error('[SearchService] query failed:', (e as Error).message);
      return {
        costTime: 0,
        errorDetail: (e as Error).message,
        query,
        resultNumbers: 0,
        results: [],
      };
    }
  }

  /**
   * Query for search results (uses the first provider)
   */
  async query(query: string, params?: SearchParams) {
    return this.queryWithImpl(this.searchImpList[0], query, params);
  }

  async webSearch({ query, searchCategories, searchEngines, searchTimeRange }: SearchQuery) {
    const whitelist = proxyWhitelistData as string[];
    const { exactSet, wildcardSuffixes } = buildWhitelistLookup(whitelist);

    for (const impl of this.searchImpList) {
      let data = await this.queryWithImpl(impl, query, {
        searchCategories,
        searchEngines,
        searchTimeRange,
      });

      // First retry: remove search engine restrictions if no results found
      if (data.results.length === 0 && searchEngines && searchEngines?.length > 0) {
        data = await this.queryWithImpl(impl, query, {
          searchCategories,
          searchEngines: undefined,
          searchTimeRange,
        });
      }

      // Second retry: remove all restrictions if still no results found
      if (data.results.length === 0) {
        data = await this.queryWithImpl(impl, query);
      }

      // Filter results by proxy whitelist (only keep URLs that are valid)
      const filteredResults = data.results.filter((result) => {
        try {
          const hostname = new URL(result.url).hostname;
          return isUrlInWhitelistOptimized(hostname, exactSet, wildcardSuffixes);
        } catch {
          return false;
        }
      });

      // If this provider returned valid results, use them
      if (filteredResults.length > 0) {
        return {
          ...data,
          results: filteredResults,
          resultNumbers: filteredResults.length,
        };
      }
    }

    // All providers exhausted, return empty result
    return { costTime: 0, query, resultNumbers: 0, results: [] };
  }
}

// Add a default exported instance for convenience
export const searchService = new SearchService();
