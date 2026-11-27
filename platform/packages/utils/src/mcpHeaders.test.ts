import { describe, expect, it } from 'vitest';

import { MARKET_MASKED_HEADER_KEYS, maskSensitiveHeaders } from './mcpHeaders';

describe('maskSensitiveHeaders', () => {
  it('should mask explicit market header keys', () => {
    const result = maskSensitiveHeaders({
      'x-bbzai-mcp-token': 'secret-token',
    });

    expect(result).toEqual({
      'x-bbzai-mcp-token': '',
    });
    expect(MARKET_MASKED_HEADER_KEYS).toContain('x-bbzai-mcp-token');
  });

  it('should mask keyword-based sensitive headers', () => {
    const result = maskSensitiveHeaders({
      'Authorization': 'Bearer abc',
      'X-Api-Key': '123',
    });

    expect(result).toEqual({
      'Authorization': '',
      'X-Api-Key': '',
    });
  });

  it('should keep non-sensitive headers unchanged', () => {
    const result = maskSensitiveHeaders({
      'X-Custom-Header': 'value',
    });

    expect(result).toEqual({
      'X-Custom-Header': 'value',
    });
  });
});
