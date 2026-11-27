# 移除飞书引擎实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 SearXNG 和 web-browsing 中彻底移除飞书搜索引擎支持，所有飞书文档操作只走飞书 MCP。

**Architecture:** 两条独立的 token 链路：Cookie 路径（`feishu_token` cookie → context → web-browsing）和 MCP 路径（浏览器 OAuth → HTTP Header）。本计划只清除 Cookie 路径及其所有相关代码、类型、环境变量、路由和系统提示，MCP 路径保持不变。

**Tech Stack:** TypeScript, Next.js, zustand, TRPC, Vitest

---

## Task 1: 移除系统提示中的飞书引擎指引

**Files:**

- Modify: `packages/builtin-tool-web-browsing/src/systemRole.ts`

- [ ] **Step 1: 编辑 `systemRole.ts` — 移除 `publicWebCrawlDisabledBlock` 中的飞书 / Lark 行**

将行 8-10 的飞书特例移除。修改后：

```
The server has disabled fetching full page text from public websites via crawlSinglePage / crawlMultiPages.
- Do NOT call crawlSinglePage or crawlMultiPages for any URLs.
- If the user asks to read or fully summarize a webpage, clearly state that this environment does not support page crawling right now; use search result titles, snippets, and links instead.
- 若用户需要读取公网页面全文，请明确说明当前环境暂不支持网页抓取，可改用搜索摘要与引用链接作答。
- When a tool response includes errorType "PublicWebCrawlDisabled", explain the same limitation to the user in their language.
```

同时将行 2 的接口注释改为：`/** When true, inject rules: no public-page crawl; tell user if they ask for full public pages. */`

- [ ] **Step 2: 编辑 `systemRole.ts` — 从搜索引擎推荐列表移除 `feishu`（行 52-54）**

修改后：

```
- General knowledge: baidu, bing, duckduckgo, brave, wikipedia
- Academic/scientific information: google scholar, arxiv
- Code/technical queries: baidu, github, npm, pypi
```

- [ ] **Step 3: 编辑 `systemRole.ts` — 删除 `IMPORTANT - Feishu as Default Engine` 整段（行 60-65）**

删除从 `**IMPORTANT - Feishu as Default Engine**:` 到该段结束的所有内容（行 60-64）。保持 `</search_engine_selection>` 标签不变。

- [ ] **Step 4: 编辑 `systemRole.ts` — 从搜索策略移除飞书指引（行 77）**

删除行 77 的 ` - **Always include Feishu by default**: Unless you are 100% certain...` 整行。

- [ ] **Step 5: 编辑 `systemRole.ts` — 移除服务描述中的 Feishu 条目（行 139）**

删除行 139 `- Feishu: Internal enterprise search engine for searching documents within your Feishu/Lark workspace. It can access private documents that you have permission to view, including Wiki pages and Docx documents. When users ask about internal documents, meeting notes, project docs, or anything stored in your organization's Feishu workspace, use Feishu search first.`

- [ ] **Step 6: 编辑 `systemRole.ts` — 移除爬取飞书文档指引（行 163-164）**

删除：

```
- Only crawl pages that are publicly accessible, except for Feishu URLs which you have permission to access
- For Feishu document URLs (wiki, docx, etc.): Always use crawlSinglePage to fetch the full content. The Feishu search only returns titles and snippets—for detailed content, you must crawl the document URL directly.
```

替换为：

```
- Only crawl pages that are publicly accessible
- When crawling multiple pages, crawl relevant and authoritative sources
```

（注意：行 165 原来就是 "When crawling multiple pages"，合并后不重复）

- [ ] **Step 7: Commit**

```bash
git add packages/builtin-tool-web-browsing/src/systemRole.ts
git commit -m "🔧 refactor: 移除 web-browsing 系统提示中的飞书引擎指引"
```

---

## Task 2: 移除工具定义中的飞书引擎选项和 token 参数

**Files:**

- Modify: `packages/builtin-tool-web-browsing/src/manifest.ts`

- [ ] **Step 1: 从 `searchEngines` enum 移除 `'feishu'`**

将行 49 的 `'feishu',` 从 enum 数组中删除。结果：

```typescript
enum: [
  'baidu',
  'google',
  'bilibili',
  'bing',
  'duckduckgo',
  'npm',
  'pypi',
  'arxiv',
  'google scholar',
  'z-library',
  'reddit',
  'imdb',
  'brave',
  'wikipedia',
  // 'pinterest',
  // 'unsplash',
  // 'vimeo',
  // 'youtube',
],
```

- [ ] **Step 2: 移除 `userAccessToken` 参数定义**

删除行 60-64：

```typescript
          userAccessToken: {
            description:
              '飞书用户访问令牌（user_access_token），用于访问飞书内部文档。如果不传，后端会尝试使用环境变量中的默认 token。',
            type: 'string',
          },
```

- [ ] **Step 3: Commit**

```bash
git add packages/builtin-tool-web-browsing/src/manifest.ts
git commit -m "🔧 refactor: 从 web-browsing manifest 移除飞书引擎和 userAccessToken 参数"
```

---

## Task 3: 移除飞书引擎图标映射

**Files:**

- Modify: `packages/builtin-tool-web-browsing/src/const.ts`

- [ ] **Step 1: 删除 `ENGINE_ICON_MAP` 中 feishu 条目**

删除行 44：

```typescript
  'feishu': 'https://sf3-cn.feishucdn.com/obj/open-platform-opendoc/1afa2bd8ba9e6410b66effb7901bc8fd_6EHta7Mt8N.png?height=48&lazyload=true&width=48'
```

- [ ] **Step 2: Commit**

```bash
git add packages/builtin-tool-web-browsing/src/const.ts
git commit -m "🔧 refactor: 移除飞书搜索引擎图标映射"
```

---

## Task 4: 移除搜索参数类型中的飞书接口

**Files:**

- Modify: `src/server/services/search/impls/type.ts`

- [ ] **Step 1: 删除 `FeishuSearchParams` 接口并简化 `SearchServiceImpl`**

将整个文件内容替换为：

```typescript
import { type SearchParams, type UniformSearchResponse } from '@lobechat/types';

/**
 * Search service implementation interface
 */
export interface SearchServiceImpl {
  /**
   * Query for search results
   */
  query: (query: string, params?: SearchParams) => Promise<UniformSearchResponse>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/search/impls/type.ts
git commit -m "🔧 refactor: 移除 FeishuSearchParams 接口，简化 SearchServiceImpl"
```

---

## Task 5: 移除 SearXNG 实现中的飞书引擎逻辑

**Files:**

- Modify: `src/server/services/search/impls/searxng/index.ts`

- Modify: `src/server/services/search/impls/searxng/client.ts`

- [ ] **Step 1: 编辑 `searxng/index.ts` — 移除飞书 engineData 构建和 env var 引用**

删除行 31-36（飞书 engineData 块），并移除 `toolsEnv` import 中的 `FEISHU_USER_ACCESS_TOKEN` 使用。修改后的 `query` 方法：

```typescript
  async query(
    query: string,
    params?: {
      searchCategories?: string[];
      searchEngines?: string[];
      searchTimeRange?: string;
    },
  ): Promise<UniformSearchResponse> {
    if (!toolsEnv.SEARXNG_URL) {
      throw new TRPCError({ code: 'NOT_IMPLEMENTED', message: SEARCH_SEARXNG_NOT_CONFIG });
    }

    const client = new SearXNGClient(toolsEnv.SEARXNG_URL);

    try {
      const startAt = Date.now();

      const engines = params?.searchEngines ?? [];

      const data = await client.search(
        query,
        {
          categories: params?.searchCategories,
          time_range: params?.searchTimeRange,
        },
        {
          engines,
          tokens: toolsEnv.SEARXNG_TOKENS,
        },
      );

      const costTime = Date.now() - startAt;

      return {
        costTime,
        query,
        resultNumbers: data.number_of_results,
        results: data.results.map((item) => ({
          category: item.category,
          content: item.content ?? '',
          engines: item.engines,
          parsedUrl: item.url ? new URL(item.url).hostname : '',
          publishedDate: item.publishedDate || undefined,
          score: item.score,
          thumbnail: item.thumbnail || undefined,
          title: item.title,
          url: item.url,
        })),
      };
    } catch (e) {
      console.error(e);

      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: (e as Error).message,
      });
    }
  }
```

注意：`toolsEnv` import 仍需要（用于 `SEARXNG_URL` 和 `SEARXNG_TOKENS`），但不再使用 `FEISHU_USER_ACCESS_TOKEN`。

- [ ] **Step 2: 编辑 `searxng/client.ts` — 清理飞书相关注释**

修改 `SearXNGEngineOptions` 接口注释（行 33-48）：

```typescript
/**
 * Options for SearXNG engine-level parameters.
 */
export interface SearXNGEngineOptions {
  /**
   * Engine-specific parameters.
   * Key is engine name, value is a record of param key-value pairs.
   * Will be serialized to 'engine_data-{engine}-{param}' query params.
   */
  engineData?: Record<string, Record<string, string>>;
  /** Specify which engines to use */
  engines?: string[];
  /** SearXNG instance-level token (required if SearXNG is configured with tokens) */
  tokens?: string;
}
```

修改行 74-75 的注释：

```typescript
// Handle engineData: convert to 'engine_data-{engine}-{param}' query params
```

（删除 `// { feishu: { user_access_token: 'u-xxx' } }` 示例）

- [ ] **Step 3: Commit**

```bash
git add src/server/services/search/impls/searxng/index.ts src/server/services/search/impls/searxng/client.ts
git commit -m "🔧 refactor: 移除 SearXNG 中的飞书引擎参数逻辑和注释"
```

---

## Task 6: 移除工具执行器中的飞书 token 注入

**Files:**

- Modify: `src/server/services/toolExecution/builtin.ts`

- [ ] **Step 1: 删除飞书 token 注入条件块**

删除行 144-147：

```typescript
// For lobe-web-browsing search, auto-inject feishu userAccessToken from cookie
if (identifier === 'lobe-web-browsing' && apiName === 'search' && context.feishuToken) {
  args.userAccessToken = context.feishuToken;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/services/toolExecution/builtin.ts
git commit -m "🔧 refactor: 移除 builtin 工具执行器中的飞书 token 自动注入"
```

---

## Task 7: 移除搜索服务中的飞书文档爬取路径

**Files:**

- Modify: `src/server/services/search/index.ts`

- [ ] **Step 1: 移除飞书相关 import**

删除行 6：

```typescript
import { FeishuDocService, isFeishuDocUrl } from '@/server/services/feishu';
```

删除行 10：

```typescript
import { type FeishuSearchParams } from './impls/type';
```

- [ ] **Step 2: 简化 `crawlPages()` 方法 — 移除飞书 URL 分支**

将 `crawlPages` 方法（行 48-68）替换为：

```typescript
  async crawlPages(input: { impls?: CrawlImplType[]; urls: string[] }) {
    const { urls } = input;

    if (toolsEnv.DISABLE_PUBLIC_WEB_PAGE_CRAWL) {
      return { results: urls.map((url) => this.createPublicWebCrawlDisabledResult(url)) };
    }

    const { Crawler } = await import('@lobechat/web-crawler');
    const crawler = new Crawler({ impls: this.crawlerImpls });

    const results = await pMap(urls, async (url) => this.crawlWithRetry(crawler, url, input.impls), {
      concurrency: this.crawlConcurrency,
    });

    return { results };
  }
```

- [ ] **Step 3: 删除飞书专用方法**

删除以下三个方法：

- `crawlFeishuDocs()`（行 73-107）
- `createNoTokenResult()`（行 147-157）
- 修改 `createPublicWebCrawlDisabledResult()`（行 131-142）— 移除错误消息中的飞书特例：

```typescript
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
```

- [ ] **Step 4: 简化 `queryWithImpl` 和 `webSearch` — 移除 FeishuSearchParams**

将 `queryWithImpl`（行 211-228）的类型签名改为：

```typescript
  private async queryWithImpl(
    impl: SearchServiceImpl,
    query: string,
    params?: SearchParams,
  ) {
```

将 `webSearch`（行 237-277）的类型签名和参数改为：

```typescript
  async webSearch({
    query,
    searchCategories,
    searchEngines,
    searchTimeRange,
  }: SearchQuery) {
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

      // If this provider returned results, use them
      if (data.results.length > 0) {
        return data;
      }
    }

    // All providers exhausted, return empty result
    return { costTime: 0, query, resultNumbers: 0, results: [] };
  }
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/search/index.ts
git commit -m "🔧 refactor: 移除搜索服务中的飞书文档爬取路径和 FeishuSearchParams"
```

---

## Task 8: 移除环境变量和飞书路由

**Files:**

- Modify: `src/envs/tools.ts`

- Modify: `src/server/routers/tools/feishu.ts`

- Modify: `src/server/routers/tools/search.ts`

- Modify: `src/server/routers/tools/index.ts`

- [ ] **Step 1: 从 `tools.ts` 移除 `FEISHU_USER_ACCESS_TOKEN`**

删除行 20：

```typescript
      FEISHU_USER_ACCESS_TOKEN: process.env.FEISHU_USER_ACCESS_TOKEN,
```

删除行 31：

```typescript
      FEISHU_USER_ACCESS_TOKEN: z.string().optional(),
```

- [ ] **Step 2: 删除 `feishu.ts` 路由文件（整个文件）**

该路由唯一的用途是设置 `feishu_token` cookie，此 cookie 仅为 web-browsing 飞书搜索的 token 传播服务。删除整个文件 `src/server/routers/tools/feishu.ts`。

- [ ] **Step 3: 从 `search.ts` 路由移除 `userAccessToken` 参数**

查看当前 `src/server/routers/tools/search.ts`，需要移除 `crawlPages` 和 `webSearch` 中的 `userAccessToken` 参数。

- [ ] **Step 4: 从 `tools/index.ts` 移除 feishuRouter 注册**

删除 `feishuRouter` 的 import 和 router 合并行。

- [ ] **Step 5: Commit**

```bash
git add src/envs/tools.ts src/server/routers/tools/feishu.ts src/server/routers/tools/search.ts src/server/routers/tools/index.ts
git commit -m "🔧 refactor: 移除 FEISHU_USER_ACCESS_TOKEN 环境变量、飞书 token cookie 路由和搜索路由中的 userAccessToken 参数"
```

---

## Task 9: 移除 TRPC context 中的 feishuToken 传播

**Files:**

- Modify: `src/libs/trpc/lambda/context.ts`

- Modify: `src/server/services/toolExecution/types.ts`

- Modify: `src/server/services/agentRuntime/AgentRuntimeService.ts`

- Modify: `src/server/modules/AgentRuntime/RuntimeExecutors.ts`

- Modify: `src/server/routers/lambda/aiAgent.ts`

- [ ] **Step 1: 从 `ToolExecutionContext` 类型移除 `feishuToken`**

编辑 `src/server/services/toolExecution/types.ts`，删除 `feishuToken` 字段：

```typescript
export interface ToolExecutionContext {
  /** Target device ID for device proxy tool calls */
  activeDeviceId?: string;
  /** Memory tool permission from agent chat config */
  memoryToolPermission?: 'read-only' | 'read-write';
  /** Server database for TripYoYo Skills execution */
  serverDB?: LobeChatDatabase;
  toolManifestMap: Record<string, LobeToolManifest>;
  // ...rest unchanged
}
```

- [ ] **Step 2: 从 `AuthContext` / Lambda context 移除 `feishuToken`**

编辑 `src/libs/trpc/lambda/context.ts`：

- 从 `AuthContext` 接口中删除 `feishuToken?: string | null;` 字段

- 删除行 111：`const feishuToken = cookies['feishu_token'];`

- 从 context 构造中删除 `feishuToken` 属性

- [ ] **Step 3: 从 `AgentRuntimeService` 移除 `feishuToken`**

编辑 `src/server/services/agentRuntime/AgentRuntimeService.ts`：

- 从 options 类型中删除 `feishuToken`

- 删除 `private feishuToken` 字段声明和赋值

- 从 RuntimeExecutors context 传播中删除 `feishuToken`

- [ ] **Step 4: 从 `RuntimeExecutors` 移除 `feishuToken`**

编辑 `src/server/modules/AgentRuntime/RuntimeExecutors.ts`：

- 从 context interface 中删除 `feishuToken`

- 删除传递 `feishuToken: ctx.feishuToken` 的行

- [ ] **Step 5: 从 `aiAgent.ts` 路由移除 `feishuToken`**

编辑 `src/server/routers/lambda/aiAgent.ts`：

- 删除传递 `feishuToken: ctx.feishuToken` 到 AgentRuntimeService 的行

- [ ] **Step 6: Commit**

```bash
git add src/server/services/toolExecution/types.ts src/libs/trpc/lambda/context.ts src/server/services/agentRuntime/AgentRuntimeService.ts src/server/modules/AgentRuntime/RuntimeExecutors.ts src/server/routers/lambda/aiAgent.ts
git commit -m "🔧 refactor: 移除整个 context.feishuToken cookie 传播链路"
```

---

## Task 10: 移除客户端搜索服务中的飞书 token 注入

**Files:**

- Modify: `src/services/search.ts`

- [ ] **Step 1: 清理客户端搜索服务**

将 `src/services/search.ts` 简化为：

```typescript
import { type SearchQuery } from '@lobechat/types';

import { toolsClient } from '@/libs/trpc/client';

class SearchService {
  search(query: string, optionalParams?: object) {
    return toolsClient.search.query.query({ optionalParams, query });
  }

  async crawlPage(url: string) {
    return this.crawlPages({ urls: [url] });
  }

  async crawlPages(params: { urls: string[] }) {
    return toolsClient.search.crawlPages.mutate(params);
  }

  async webSearch(params: SearchQuery, options?: { signal?: AbortSignal }) {
    return toolsClient.search.webSearch.query(params, { signal: options?.signal });
  }
}

export const searchService = new SearchService();
```

删除：`feishuTokenService` import、`SearchWithFeishuToken` 接口、所有飞书 token 获取和注入逻辑。

- [ ] **Step 2: Commit**

```bash
git add src/services/search.ts
git commit -m "🔧 refactor: 移除客户端搜索服务中的飞书 token 注入逻辑"
```

---

## Task 11: 移除 URL 规则中的飞书条目和测试

**Files:**

- Modify: `packages/web-crawler/src/urlRules.ts`

- Modify: `packages/web-crawler/src/__tests__/urlRules.test.ts`

- [ ] **Step 1: 从 `urlRules.ts` 移除飞书 URL 规则**

删除行 97-102：

```typescript
  // Feishu use jina
  // https://github.com/lobehub/lobe-chat/issues/6879
  {
    impls: ['jina'],
    urlPattern: 'https://(.*).feishu.cn/(.*)',
  },
```

- [ ] **Step 2: 从测试文件移除飞书测试用例**

删除 `urlRules.test.ts` 行 178-185 的飞书链接测试：

```typescript
it('should match Feishu links', () => {
  const feishuRule = crawUrlRules.find((rule) => rule.urlPattern === 'https://(.*).feishu.cn/(.*)');

  expect(feishuRule).toBeDefined();
  expect(feishuRule?.impls).toEqual(['jina']);
});
```

修改行 272 的中国平台覆盖检查，移除 feishu.cn 断言：

```typescript
it('should cover Chinese platforms', () => {
  const patterns = crawUrlRules.map((rule) => rule.urlPattern);

  // Check for Chinese platforms
  expect(patterns.some((p) => p.includes('weixin.sogou.com'))).toBe(true);
  expect(patterns.some((p) => p.includes('zhihu.com'))).toBe(true);
  expect(patterns.some((p) => p.includes('xiaohongshu.com'))).toBe(true);
});
```

- [ ] **Step 3: 运行 URL 规则测试验证**

```bash
cd packages/web-crawler && bunx vitest run --silent='passed-only' src/__tests__/urlRules.test.ts
```

预期：所有测试 PASS

- [ ] **Step 4: Commit**

```bash
git add packages/web-crawler/src/urlRules.ts packages/web-crawler/src/__tests__/urlRules.test.ts
git commit -m "🔧 refactor: 移除飞书 URL 爬取规则和相关测试"
```

---

## Task 12: 类型检查验证

- [ ] **Step 1: 运行全项目类型检查**

```bash
bun run type-check
```

预期：无新增类型错误。如果有因移除 `feishuToken` 或 `FeishuSearchParams` 导致的类型错误，逐个修复。

- [ ] **Step 2: Commit（如有修复）**

```bash
git add -A
git commit -m "🐛 fix: 修复移除飞书引擎后的类型错误"
```

---

## Task 13: 运行搜索相关测试验证

- [ ] **Step 1: 运行搜索服务测试**

```bash
bunx vitest run --silent='passed-only' 'src/server/services/search'
```

- [ ] **Step 2: 运行工具执行测试**

```bash
bunx vitest run --silent='passed-only' 'src/server/services/toolExecution'
```

- [ ] **Step 3: 运行环境变量测试**

```bash
bunx vitest run --silent='passed-only' 'src/envs'
```

如有测试失败，修复并提交。
