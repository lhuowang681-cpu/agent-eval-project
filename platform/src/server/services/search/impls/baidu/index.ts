import {
  type SearchParams,
  type UniformSearchResponse,
  type UniformSearchResult,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';

import { toolsEnv } from '@/envs/tools';
import { MCPClient } from '@/libs/mcp/client';

import { type SearchServiceImpl } from '../type';
import { type BaiduSearchParameters, type BaiduSearchResponse } from './type';

const log = debug('lobe-search:Baidu');

const timeRangeMapping: Record<string, string> = {
  day: 'week',
  month: 'month',
  semiyear: 'semiyear',
  week: 'week',
  year: 'year',
};

/**
 * 百度搜索实现
 * 通过 MCP Server 调用百度搜索
 */
export class BaiduImpl implements SearchServiceImpl {
  private get mcpUrl(): string | undefined {
    return toolsEnv.BAIDU_MCP_URL;
  }

  private get authToken(): string | undefined {
    return toolsEnv.BAIDU_MCP_AUTH_TOKEN;
  }

  async query(query: string, params: SearchParams = {}): Promise<UniformSearchResponse> {
    log('Starting Baidu query with query: "%s", params: %o', query, params);

    if (!this.mcpUrl) {
      throw new TRPCError({
        code: 'NOT_IMPLEMENTED',
        message: '百度搜索 MCP URL 未配置，请设置 BAIDU_MCP_URL 环境变量',
      });
    }

    const startAt = Date.now();

    try {
      // 创建 MCP 客户端
      const mcpClient = new MCPClient({
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json',
        },
        name: 'baidu-search',
        type: 'http',
        url: this.mcpUrl,
      });

      // 初始化连接
      await mcpClient.initialize();
      log('MCP client initialized');

      // 构建搜索参数
      const searchParams: BaiduSearchParameters = {
        query,
      };

      // 处理时间范围
      if (params?.searchTimeRange && params.searchTimeRange !== 'anytime') {
        searchParams.search_recency_filter = timeRangeMapping[params.searchTimeRange] || undefined;
      }

      // 处理结果数量，默认 15，范围 1-20
      searchParams.web_topk = 20;

      log('Calling baidu_search with params: %o', searchParams);

      // 调用百度搜索工具
      const result = await mcpClient.callTool('baidu_search', searchParams);

      // 断开连接
      await mcpClient.disconnect();

      const costTime = Date.now() - startAt;

      // 解析结果
      const baiduResponse = this.parseToolResult(result);
      const mappedResults = this.mapResults(baiduResponse);

      log('Mapped %d results to SearchResult format', mappedResults.length);

      return {
        costTime,
        query,
        resultNumbers: mappedResults.length,
        results: mappedResults,
      };
    } catch (error) {
      log.extend('error')('Baidu search error: %o', error);

      const errorMessage = error instanceof Error ? error.message : '未知错误';

      // 特殊处理 MCP 错误
      if (errorMessage.includes('NoValidSessionId')) {
        throw new TRPCError({
          code: 'SERVICE_UNAVAILABLE',
          message: '百度搜索服务会话无效，请检查 MCP 服务器配置',
        });
      }

      throw new TRPCError({
        code: 'SERVICE_UNAVAILABLE',
        message: `百度搜索失败: ${errorMessage}`,
      });
    }
  }

  /**
   * 解析 MCP 工具调用结果
   */
  private parseToolResult(result: any): BaiduSearchResponse {
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
  private normalizeResponse(response: any): BaiduSearchResponse {
    // 百度 MCP 格式: { items: [...], total_results: 15, status: "success" }
    if (response?.items && Array.isArray(response.items)) {
      return {
        results: response.items.map((item: any) => ({
          title: item.title || '',
          url: item.url || '',
          content: item.content || '',
          source: item.source || '',
          date: item.date || '',
          icon: item.icon || '',
          type: item.type || '',
          web_anchor: item.web_anchor || '',
          id: item.id,
        })),
        total_count: response.total_results ?? response.items.length,
      };
    }

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

    if (response?.data?.webPages?.value) {
      // Bocha 类似的格式
      return {
        results: response.data.webPages.value.map((item: any) => ({
          title: item.name || '',
          url: item.url || '',
          content: item.snippet || item.summary || '',
          source: item.source || '',
          date: item.dateLastCrawled || '',
          icon: item.icon || '',
          type: item.type || '',
          web_anchor: item.web_anchor || '',
        })),
        total_count: response.data.webPages.totalEstimatedMatches ?? 0,
      };
    }

    return { results: [], total_count: 0 };
  }

  /**
   * 将百度结果映射为统一格式
   */
  private mapResults(baiduResponse: BaiduSearchResponse): UniformSearchResult[] {
    return (baiduResponse.results || []).map(
      (item): UniformSearchResult => ({
        category: 'general',
        content: item.content || '',
        engines: ['baidu'],
        parsedUrl: item.url ? new URL(item.url).hostname : '',
        score: 1,
        title: item.title || '',
        url: item.url || '',
      }),
    );
  }
}
