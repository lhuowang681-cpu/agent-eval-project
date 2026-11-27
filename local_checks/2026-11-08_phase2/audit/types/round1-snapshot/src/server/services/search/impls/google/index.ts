import { type SearchParams, type UniformSearchResponse, type UniformSearchResult } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { toolsEnv } from '@/envs/tools';
import { MCPClient } from '@/libs/mcp/client';

import { type SearchServiceImpl } from '../type';
import { type GoogleSearchParameters, type GoogleSearchResponse } from './type';

const log = debug('lobe-search:Google');

const timeRangeMapping: Record<string, string> = {
  day: 'd1',
  month: 'm1',
  week: 'w1',
  year: 'y1',
};

/**
 * Google 搜索实现
 * 通过 MCP Server 调用 Google 搜索
 */
export class GoogleImpl implements SearchServiceImpl {
  private get mcpUrl(): string | undefined {
    return toolsEnv.GOOGLE_MCP_URL;
  }

  private get authToken(): string | undefined {
    return toolsEnv.GOOGLE_MCP_AUTH_TOKEN;
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Google query with query: "%s", params: %o', query, params);

    if (!this.mcpUrl) {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: 'Google 搜索 MCP URL 未配置，请设置 GOOGLE_MCP_URL 环境变量',
      });
    }

    const startAt = Date.now();

    try {
      // 创建 MCP 客户端
      const mcpClient = new MCPClient({
        auth: this.authToken ? { token: this.authToken, type: 'bearer' } : undefined,
        headers: {
          'Content-Type': 'application/json',
        },
        name: 'google-search',
        type: 'http',
        url: this.mcpUrl,
      });

      // 初始化连接
      await mcpClient.initialize();
      log('MCP client initialized');

      // 构建搜索参数
      const searchParams: GoogleSearchParameters = {
        query,
      };

      // 处理结果数量，默认 10，范围 1-100
      const count = params.count ?? 10;
      searchParams.num = Math.min(100, Math.max(1, count));

      // 处理排除词
      if (params.searchCategories && params.searchCategories.length > 0) {
        searchParams.exclude_terms = params.searchCategories.join(',');
      }

      log('Calling google_search with params: %o', searchParams);

      // 调用 Google 搜索工具
      const result = await mcpClient.callTool('google_search', searchParams);

      // 断开连接
      await mcpClient.disconnect();

      const costTime = Date.now() - startAt;

      // 解析结果
      const googleResponse = this.parseToolResult(result);
      const mappedResults = this.mapResults(googleResponse);

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Google search error: %o', error);

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 特殊处理 MCP 错误
      if (errorMessage.includes('NoValidSessionId')) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Google 搜索服务会话无效，请检查 MCP 服务器配置',
        });
      }

      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: `Google 搜索失败: ${errorMessage}`,
      });
    }
  }

  /**
   * 解析 MCP 工具调用结果
   */
  private parseToolResult(result: any): GoogleSearchResponse {
    if (!result?.content) {
      return { results: [] };
    }

    const content = result.content;
    if (Array.isArray(content) && content.length > 0) {
      const firstItem = content[0];
      if (firstItem?.type === 'text' && firstItem?.text) {
        try {
          const parsed = JSON.parse(firstItem.text);
          return this.normalizeResponse(parsed);
        } catch {
          // 如果不是 JSON，尝试作为文本处理
          return { results: [], total_count: 0 };
        }
      }
    }

    return { results: [], total_count: 0 };
  }

  /**
   * 标准化响应格式
   */
  private normalizeResponse(response: any): GoogleSearchResponse {
    // 支持多种可能的响应格式
    if (Array.isArray(response)) {
      return { results: response, total_count: response.length };
    }

    if (response?.results) {
      return {
        results: response.results,
        total_count: response.total_count ?? response.results.length,
      };
    }

    // Google Custom Search API 格式: { items: [...] }
    if (response?.items && Array.isArray(response.items)) {
      return {
        results: response.items.map((item: any) => ({
          title: item.title || '',
          url: item.link || item.url || '',
          snippet: item.snippet || '',
          hostname: item.link ? new URL(item.link).hostname : '',
          dateLastCrawled: item.dateLastCrawled,
        })),
        total_count: response.items.length,
      };
    }

    return { results: [], total_count: 0 };
  }

  /**
   * 将 Google 结果映射为统一格式
   */
  private mapResults(googleResponse: GoogleSearchResponse): UniformSearchResult[] {
    return (googleResponse.results || []).map(
      (item): UniformSearchResult => ({
        category: 'general',
        content: item.snippet || '',
        engines: ['google'],
        parsedUrl: item.hostname || (item.url ? new URL(item.url).hostname : ''),
        score: 1,
        title: item.title || '',
        url: item.url || '',
      }),
    );
  }
}