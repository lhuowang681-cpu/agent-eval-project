import { describe, expect, it } from 'vitest';

import { getMcpConnectionType, sanitizeMcpCustomParamsForMarket } from './mcpCustomParams';

describe('sanitizeMcpCustomParamsForMarket', () => {
  it('should preserve header keys and mask sensitive values in nested mcp config', () => {
    const result = sanitizeMcpCustomParamsForMarket({
      mcp: {
        headers: {
          'x-bbzai-mcp-token': 'publisher-token',
          'X-Trace-Id': 'trace-123',
        },
        type: 'http',
        url: 'https://example.com/mcp',
      },
    });

    expect(result).toEqual({
      mcp: {
        headers: {
          'x-bbzai-mcp-token': '',
          'X-Trace-Id': 'trace-123',
        },
        type: 'http',
        url: 'https://example.com/mcp',
      },
    });
  });

  it('should normalize flat customParams into mcp wrapper', () => {
    const result = sanitizeMcpCustomParamsForMarket({
      headers: {
        'x-bbzai-mcp-token': 'secret',
      },
      type: 'http',
      url: 'https://example.com/mcp',
    } as any);

    expect(result?.mcp?.headers).toEqual({
      'x-bbzai-mcp-token': '',
    });
  });

  it('should normalize mcpServers customParams into mcp wrapper', () => {
    const result = sanitizeMcpCustomParamsForMarket({
      mcpServers: {
        'chrome-devtools': {
          args: ['chrome-devtools-mcp@latest'],
          command: 'npx',
        },
      },
    });

    expect(result?.mcp).toEqual({
      args: ['chrome-devtools-mcp@latest'],
      command: 'npx',
      type: 'stdio',
    });
  });
});

describe('getMcpConnectionType', () => {
  it('should read connection type from nested mcp config', () => {
    expect(
      getMcpConnectionType({
        mcp: {
          type: 'streamable',
          url: 'https://example.com/mcp',
        },
      }),
    ).toBe('streamable');
  });

  it('should fall back to http when type is missing', () => {
    expect(getMcpConnectionType({ mcp: { url: 'https://example.com/mcp' } })).toBe('http');
  });

  it('should infer stdio from mcpServers command config', () => {
    expect(
      getMcpConnectionType({
        mcpServers: {
          'chrome-devtools': {
            args: ['chrome-devtools-mcp@latest'],
            command: 'npx',
          },
        },
      }),
    ).toBe('stdio');
  });
});
