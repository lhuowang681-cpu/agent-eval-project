# 从 SearXNG 和 Web-Browsing 中移除飞书引擎支持

**日期**: 2026-06-02
**状态**: 已批准

## 背景

项目已内置飞书 MCP（`packages/builtin-mcp-feishu`），提供了完整的飞书文档操作能力（搜索、获取、创建、更新、评论等）。与此同时，SearXNG 搜索工具也支持飞书作为搜索引擎之一，web-browsing 的系统提示强烈指引 AI 默认加入飞书引擎。

这两套系统在飞书文档搜索上存在功能重叠和冲突：

- AI 可能通过 web-browsing 的 feishu 引擎搜索飞书文档，也可能通过飞书 MCP 的 `search-doc` 搜索，行为不一致
- 两套系统各自有 token 注入逻辑，维护成本高
- 飞书 MCP 的功能更完整（搜索 + 获取 + CRUD），SearXNG 的飞书引擎仅能搜索

## 决策

**移除 SearXNG 和 web-browsing 中与飞书引擎相关的所有代码、指引、爬取逻辑和配置。** 所有飞书文档操作只走飞书 MCP。

Firecrawl 保留不动 — 它是通用网页爬取工具，不直接爬取飞书文档，且飞书 MCP 已覆盖飞书内容获取。

## 修改清单

### 1. 系统提示 (`packages/builtin-tool-web-browsing/src/systemRole.ts`)

移除所有飞书引擎指引和飞书 URL 爬取指引：

- **行 9-10**: 移除飞书 / Lark 文档 host 的爬取限制策略
- **行 52-54**: 从搜索引擎推荐列表中移除 `feishu` 引用
- **行 60-65**: 删除 `IMPORTANT - Feishu as Default Engine` 整段
- **行 77-78**: 删除搜索策略中飞书默认引擎指引行
- **行 139**: 移除服务描述中飞书作为 "内部企业搜索引擎" 的描述
- **行 163-164**: 删除爬取飞书文档的指引

移除后，系统提示不再引导 AI 在 web-browsing 中加入飞书引擎或爬取飞书文档 URL。AI 操作飞书内容时会自然选择飞书 MCP 的 `search-doc` / `fetch-doc` 工具。

### 2. 工具定义 (`packages/builtin-tool-web-browsing/src/manifest.ts`)

- 从 `searchEngines.items.enum` 数组中移除 `'feishu'`
- 移除 `userAccessToken` 参数定义（该参数专为飞书引擎 token 传递而存在）

### 3. 引擎图标 (`packages/builtin-tool-web-browsing/src/const.ts`)

- 删除 `feishu` → 飞书 logo URL 的图标映射行

### 4. 搜索参数类型 (`src/server/services/search/impls/type.ts`)

- 删除 `FeishuSearchParams` 接口
- 从 `SearchServiceImpl` 的 query params 中移除飞书字段合并

### 5. SearXNG 实现 — 主逻辑 (`src/server/services/search/impls/searxng/index.ts`)

- 移除 `engines.includes('feishu')` 检查逻辑
- 移除飞书 engineData 参数构建代码（`user_access_token`、`doc_filter`、`wiki_filter`、`page_size` 等）
- 移除对 `toolsEnv.FEISHU_USER_ACCESS_TOKEN` 环境变量的使用

### 6. SearXNG 实现 — HTTP 客户端 (`src/server/services/search/impls/searxng/client.ts`)

- 移除飞书引擎相关的注释和代码路径（行 35、42、45、74 中关于 `user_access_token` 和 engine_data 的飞书示例）
- 清理 client 中飞书 engineData 的传递逻辑

### 7. 工具执行器 (`src/server/services/toolExecution/builtin.ts`)

- 删除行 144-147 中 web-browsing 搜索时的飞书 token 注入条件逻辑：
  ```typescript
  // 删除此块：
  if (identifier === 'lobe-web-browsing' && apiName === 'search' && context.feishuToken) {
    args.userAccessToken = context.feishuToken;
  }
  ```
- **`context.feishuToken` 的传递机制可移除**：经验证，飞书 MCP 使用完全独立的 token 获取链路（前端 `feishuTokenService.getToken()` → HTTP Header `X-Lark-MCP-UAT`），不依赖 `context.feishuToken`。因此移除 builtin.ts 中的注入逻辑不会影响飞书 MCP。

### 8. 搜索服务 — 飞书文档爬取路径 (`src/server/services/search/index.ts`)

- 移除 `FeishuDocService` 的引入和调用
- 移除 `isFeishuDocUrl` 的飞书 URL 检测逻辑
- 移除 `crawlPages()` 中飞书 URL 的特殊爬取分支
- 移除 `feishuToken` fallback（`toolsEnv.FEISHU_USER_ACCESS_TOKEN`）
- AI 获取飞书文档内容只走飞书 MCP 的 `fetch-doc` 工具，不再通过 web-browsing 爬取

### 9. 环境变量配置 (`src/envs/tools.ts`)

- 移除 `FEISHU_USER_ACCESS_TOKEN` 环境变量定义（行 20 runtimeEnv、行 31 schema）
- 此变量仅为 web-browsing 飞书 token fallback 服务，移除飞书引擎后不再需要

### 10. URL 规则 (`packages/web-crawler/src/urlRules.ts`)

- 移除飞书 URL 规则（行 101：`urlPattern: 'https://(.*).feishu.cn/(.*)'` + `impls: ['jina']`）
- 飞书文档内容获取只走飞书 MCP 的 `fetch-doc`

### 11. URL 规则测试 (`packages/web-crawler/src/__tests__/urlRules.test.ts`)

- 移除飞书 URL 规则相关的测试用例（行 179-184、272）
- 更新其余测试确保移除飞书规则后不破坏其他 URL 规则

## 不修改的部分

- **Firecrawl** — 保留，它是通用爬虫，不与飞书文档获取冲突
- **飞书 MCP** (`packages/builtin-mcp-feishu`) — 保留，这是飞书文档操作的唯一路径
- **飞书 Token 服务** (`src/services/feishuToken.ts`) — 保留，飞书 MCP 的浏览器 OAuth 链路仍需要
- **飞书文档服务** (`src/server/services/feishu/`) — 保留，可能有其他用途需确认
- **飞书 SSO** (`src/libs/better-auth/sso/providers/feishu.ts`) — 保留，与搜索引擎无关
- **飞书频道** (`src/routes/(main)/agent/channel/`) — 保留，与搜索引擎无关
- **SearXNG 本身** — 保留服务，只是移除飞书引擎选项
- **其他搜索引擎** (Google、Bing、DuckDuckGo 等) — 保留不动

## 影响评估

- **AI 行为变化**: 搜索飞书文档时，AI 将从 web-browsing+feishu 引擎切换到飞书 MCP 的 `search-doc` 工具；获取飞书文档内容时，从 crawlSinglePage 切换到飞书 MCP 的 `fetch-doc` 工具
- **用户体验**: 无变化 — 飞书 MCP 的功能完全覆盖搜索 + 获取 + CRUD
- **代码简化**: 移除约 11 个文件中的飞书引擎相关代码，减少维护负担和 token 注入复杂度

## Token 链路分析

两条完全独立的 token 获取链路：

|                | Cookie 路径 (`context.feishuToken`) | MCP 路径 (`feishuTokenService`)                     |
| -------------- | ----------------------------------- | --------------------------------------------------- |
| **Token 来源** | Cookie `feishu_token`               | 前端 `LarkAuth.getUserAccessToken()` (浏览器 OAuth) |
| **传递方式**   | 服务端注入到 `args.userAccessToken` | HTTP Header `X-Lark-MCP-UAT`                        |
| **消费者**     | web-browsing 搜索 + 爬取            | 飞书 MCP                                            |
| **环境**       | 服务端                              | 浏览器端                                            |

移除 Cookie 路径不影响飞书 MCP，因为飞书 MCP 使用的是浏览器端的 OAuth 链路。移除后 `context.feishuToken` 相关的所有服务端注入逻辑均可安全删除。
