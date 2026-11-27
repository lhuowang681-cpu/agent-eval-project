#!/usr/bin/env tsx
/**
 * Offline Mock for every remaining external service the app talks to.
 *
 * One process covers four surfaces so the offline setup needs only two mock servers
 * (this one plus tools/mock-llm):
 *
 *   SearXNG      GET  /search?q=&format=json      → fixed result set
 *   Crawler      GET  /crawl?url=                 → fixed HTML fixture
 *   Market       GET  /market/*                   → empty lists
 *   Index        GET  /local-index/agents.json    → empty agents index
 *                GET  /local-index/plugins.json   → empty plugins index
 *
 * Usage
 *   bun run tsx tools/mock-services/server.ts
 *   MOCK_SERVICES_PORT=8089 bun run tsx tools/mock-services/server.ts
 *
 * Wire it up with:
 *   SEARXNG_URL=http://localhost:8089/search
 *   AGENTS_INDEX_URL=http://localhost:8089/local-index/agents.json
 *   PLUGINS_INDEX_URL=http://localhost:8089/local-index/plugins.json
 */
import { createServer, type ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_SERVICES_PORT ?? 8089);

const stats = { crawl: 0, index: 0, market: 0, search: 0, startedAt: Date.now() };

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Length': Buffer.byteLength(payload),
    'Content-Type': 'application/json',
  });
  res.end(payload);
};

// ── SearXNG-compatible search ───────────────────────────────────────────────

const searchResults = (query: string) => [
  {
    content: `这是本地 Mock 搜索服务对「${query}」的第 1 条结果。内容固定，不出网。`,
    engine: 'mock',
    score: 1,
    title: `Mock 结果 1：${query}`,
    url: 'http://localhost:8089/fixtures/result-1',
  },
  {
    content: `这是本地 Mock 搜索服务对「${query}」的第 2 条结果。`,
    engine: 'mock',
    score: 0.8,
    title: `Mock 结果 2：${query}`,
    url: 'http://localhost:8089/fixtures/result-2',
  },
  {
    content: `这是本地 Mock 搜索服务对「${query}」的第 3 条结果。`,
    engine: 'mock',
    score: 0.6,
    title: `Mock 结果 3：${query}`,
    url: 'http://localhost:8089/fixtures/result-3',
  },
];

// ── crawler fixture ─────────────────────────────────────────────────────────

const crawlFixture = (url: string) => ({
  content:
    '本地 Mock 抓取服务返回的固定正文。真实抓取需要出网，离线环境下一律返回这段内容，' +
    '用于验证 crawlSinglePage / crawlMultiPages 的解析与回灌链路。',
  contentType: 'text/html',
  description: 'Mock crawler fixture',
  length: 96,
  siteName: 'mock',
  title: `Mock 抓取结果：${url}`,
  url,
});

// ── router ──────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');

  // SearXNG
  if (path === '/search') {
    stats.search += 1;
    const q = url.searchParams.get('q') ?? '';
    return sendJson(res, 200, {
      answers: [],
      infoboxes: [],
      number_of_results: 3,
      query: q,
      results: searchResults(q),
      suggestions: [],
    });
  }

  // Crawler
  if (path === '/crawl') {
    stats.crawl += 1;
    return sendJson(res, 200, crawlFixture(url.searchParams.get('url') ?? ''));
  }

  // Agents / plugins index — the app defaults these to registry.npmmirror.com
  if (path === '/local-index/agents.json') {
    stats.index += 1;
    return sendJson(res, 200, { agents: [], schemaVersion: 1, tags: [] });
  }

  if (path === '/local-index/plugins.json') {
    stats.index += 1;
    return sendJson(res, 200, { plugins: [], schemaVersion: 1, tags: [] });
  }

  // Market — return empty lists for every sub-resource
  if (path.startsWith('/market')) {
    stats.market += 1;
    return sendJson(res, 200, {
      currentPage: 1,
      items: [],
      pageSize: 20,
      totalCount: 0,
      totalPage: 0,
    });
  }

  if (path === '/health') {
    return sendJson(res, 200, { service: 'mock-services', status: 'ok' });
  }

  if (path === '/__mock/stats') {
    return sendJson(res, 200, { ...stats, uptimeMs: Date.now() - stats.startedAt });
  }

  return sendJson(res, 404, { error: `no mock route for ${req.method} ${path}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.info(`[mock-services] listening on http://127.0.0.1:${PORT}`);
  console.info(`[mock-services]   search  → /search?q=`);
  console.info(`[mock-services]   crawler → /crawl?url=`);
  console.info(`[mock-services]   market  → /market/*`);
  console.info(`[mock-services]   index   → /local-index/{agents,plugins}.json`);
});
