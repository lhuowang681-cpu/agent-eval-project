// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { GoogleImpl } from './index';
import { googleSearchRawResponse } from './fixtures/googleSearch';

vi.mock('@/envs/tools', () => ({
  toolsEnv: {
    GOOGLE_MCP_URL: 'http://aigw.fx.ctripcorp.com/mcp/100000015/mcp',
    GOOGLE_MCP_AUTH_TOKEN: 'test-token',
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
          text: JSON.stringify(googleSearchRawResponse),
        },
      ],
    }),
  })),
}));

describe('GoogleImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('query', () => {
    it('should return search results successfully', async () => {
      const searchImpl = new GoogleImpl();
      const results = await searchImpl.query('Google');

      expect(results.results.length).toEqual(3);
      expect(results.query).toEqual('Google');
      expect(results.results[0].title).toEqual('Google Search - 官方主页');
      expect(results.results[0].url).toEqual('https://www.google.com/');
      expect(results.results[0].content).toContain('Google 搜索');
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
              text: JSON.stringify({ items: [], total_results: 0 }),
            },
          ],
        }),
      }));

      const searchImpl = new GoogleImpl();
      const results = await searchImpl.query('nonexistent_query_12345');

      expect(results.results.length).toEqual(0);
      expect(results.resultNumbers).toEqual(0);
    });
  });
});