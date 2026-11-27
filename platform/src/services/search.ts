import { isDesktop } from '@lobechat/const';
import { getElectronIpc } from '@lobechat/electron-client-ipc';
import { type SearchQuery } from '@lobechat/types';
import type { CrawlUniformResult } from '@lobechat/web-crawler';

import { toolsClient } from '@/libs/trpc/client';

// The desktop IPC type map (`DesktopIpcServicesMap`) is only populated inside
// the desktop app's own tsconfig; from the web app's compilation `apps/desktop`
// is excluded, so the map resolves to an empty object here. We therefore assert
// the exact shape of the channel we call instead of relying on the auto-derived
// map. The handler lives in apps/desktop WebCrawlerCtr (`webCrawler.crawlPages`).
interface DesktopWebCrawlerIpc {
  webCrawler: {
    crawlPages: (params: { urls: string[] }) => Promise<{ results: CrawlUniformResult[] }>;
  };
}

class SearchService {
  search(query: string, optionalParams?: object) {
    return toolsClient.search.query.query({ optionalParams, query });
  }

  async crawlPage(url: string) {
    return this.crawlPages({ urls: [url] });
  }

  async crawlPages(params: { urls: string[] }) {
    // In the desktop app, crawl locally in the Electron main process so it can
    // reach intranet sites and bypass the shared server's network limits.
    if (isDesktop) {
      const ipc = getElectronIpc() as DesktopWebCrawlerIpc | null;
      if (ipc) return ipc.webCrawler.crawlPages(params);
    }

    return toolsClient.search.crawlPages.mutate(params);
  }

  async webSearch(params: SearchQuery, options?: { signal?: AbortSignal }) {
    return toolsClient.search.webSearch.query(params, { signal: options?.signal });
  }
}

export const searchService = new SearchService();
