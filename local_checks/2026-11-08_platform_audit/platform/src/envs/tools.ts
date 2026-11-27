import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

const optionalNumberEnv = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().int().max(max).min(min).optional(),
  );

export const getToolsConfig = () => {
  return createEnv({
    runtimeEnv: {
      BAIDU_MCP_AUTH_TOKEN: process.env.BAIDU_MCP_AUTH_TOKEN,
      BAIDU_MCP_URL: process.env.BAIDU_MCP_URL,
      CRAWL_CONCURRENCY: process.env.CRAWL_CONCURRENCY,
      CRAWLER_RETRY: process.env.CRAWLER_RETRY,
      CRAWLER_IMPLS: process.env.CRAWLER_IMPLS,
      DISABLE_PUBLIC_WEB_PAGE_CRAWL: process.env.DISABLE_PUBLIC_WEB_PAGE_CRAWL === '1',
      GOOGLE_MCP_AUTH_TOKEN: process.env.GOOGLE_MCP_AUTH_TOKEN,
      GOOGLE_MCP_URL: process.env.GOOGLE_MCP_URL,
      SEARCH_PROVIDERS: process.env.SEARCH_PROVIDERS,
      SEARXNG_URL: process.env.SEARXNG_URL,
      SEARXNG_TOKENS: process.env.SEARXNG_TOKENS,
      VISUAL_UNDERSTANDING_MODEL: process.env.VISUAL_UNDERSTANDING_MODEL,
      VISUAL_UNDERSTANDING_PROVIDER: process.env.VISUAL_UNDERSTANDING_PROVIDER,
    },

    server: {
      BAIDU_MCP_AUTH_TOKEN: z.string().optional(),
      BAIDU_MCP_URL: z.string().url().optional(),
      CRAWL_CONCURRENCY: optionalNumberEnv(1, 10),
      CRAWLER_RETRY: optionalNumberEnv(0, 3),
      CRAWLER_IMPLS: z.string().optional(),
      DISABLE_PUBLIC_WEB_PAGE_CRAWL: z.boolean().optional(),
      GOOGLE_MCP_AUTH_TOKEN: z.string().optional(),
      GOOGLE_MCP_URL: z.string().url().optional(),
      SEARCH_PROVIDERS: z.string().optional(),
      SEARXNG_URL: z.string().url().optional(),
      SEARXNG_TOKENS: z.string().optional(),
      VISUAL_UNDERSTANDING_MODEL: z.string().optional(),
      VISUAL_UNDERSTANDING_PROVIDER: z.string().optional(),
    },
  });
};

export const toolsEnv = getToolsConfig();
