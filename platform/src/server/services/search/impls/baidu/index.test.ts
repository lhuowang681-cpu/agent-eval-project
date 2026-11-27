// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { BaiduImpl } from './index';
import { baiduSearchRawResponse } from './fixtures/baiduSearch';

vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    BAIDU_MCP_URL: 'http://aigw.fx.ctripcorp.com/mcp/100000015/mcp',
    BAIDU_MCP_AUTH_TOKEN: 'test-token',
  },
}));

vi.mock('@/libs/mcp/client', () => ({
  MCPClient: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify(baiduSearchRawResponse),
        },
      ],
    }),
  })),
}));

describe('BaiduImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('query', () => {
    it('should return search results successfully', async () => {
      const searchImpl = new BaiduImpl();
      const results = await searchImpl.query('今日黄金价格');

      expect(results.results.length).toEqual(3);
      expect(results.query).toEqual('今日黄金价格');
      expect(results.results[0].title).toEqual('广州今日黄金价格多少钱一克(2026年6月8日)');
      expect(results.results[0].url).toEqual('http://3g.cnfol.com/gold/jinshijiage/20260608/32272771.shtml');
      expect(results.results[0].content).toContain('广州今日黄金价格');
    });

    it('should handle empty results', async () => {
      const { MCPClient } = await import('@/libs/mcp/client');

      (MCPClient as any).mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ results: [], total_count: 0 }),
            },
          ],
        }),
      }));

      const searchImpl = new BaiduImpl();
      const results = await searchImpl.query('nonexistent_query_12345');

      expect(results.results.length).toEqual(0);
      expect(results.resultNumbers).toEqual(0);
    });
  });
});