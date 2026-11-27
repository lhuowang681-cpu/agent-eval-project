import { describe, expect, it } from 'vitest';

import {
  BBZAI_MCP_TOKEN_HEADER,
  parseMcpAdaTokenInput,
  shouldInjectBbzaiMcpTokenHeader,
  withBbzaiMcpTokenHeader,
} from './mcpAdaToken';

describe('parseMcpAdaTokenInput', () => {
  it('returns a trimmed raw token', () => {
    expect(parseMcpAdaTokenInput(' ada_raw_token ')).toBe('ada_raw_token');
  });

  it('returns undefined for empty input', () => {
    expect(parseMcpAdaTokenInput('   ')).toBeUndefined();
  });
});

describe('withBbzaiMcpTokenHeader', () => {
  it('preserves explicit non-empty header', () => {
    expect(
      withBbzaiMcpTokenHeader(
        { headers: { [BBZAI_MCP_TOKEN_HEADER]: 'explicit' }, url: 'https://example.com' },
        'fallback',
      ),
    ).toEqual({ headers: { [BBZAI_MCP_TOKEN_HEADER]: 'explicit' }, url: 'https://example.com' });
  });

  it('preserves explicit non-empty header with different casing', () => {
    expect(
      withBbzaiMcpTokenHeader({ headers: { 'X-Bbzai-Mcp-Token': 'explicit' } }, 'fallback'),
    ).toEqual({ headers: { 'X-Bbzai-Mcp-Token': 'explicit' } });
  });

  it('fills missing header from fallback token for internal ctripcorp URLs', () => {
    expect(
      withBbzaiMcpTokenHeader(
        { headers: { other: '1' }, url: 'https://metadata.faas.ctripcorp.com/mcp' },
        'fallback',
      ),
    ).toEqual({
      headers: { [BBZAI_MCP_TOKEN_HEADER]: 'fallback', other: '1' },
      url: 'https://metadata.faas.ctripcorp.com/mcp',
    });
  });

  it('fills empty header from fallback token for internal npm packages', () => {
    expect(
      withBbzaiMcpTokenHeader(
        { args: ['-y', '@ctrip/demo-mcp'], headers: { [BBZAI_MCP_TOKEN_HEADER]: ' ' } },
        'fallback',
      ),
    ).toEqual({
      args: ['-y', '@ctrip/demo-mcp'],
      headers: { [BBZAI_MCP_TOKEN_HEADER]: 'fallback' },
    });
  });

  it('does not fill missing header for external MCPs', () => {
    expect(
      withBbzaiMcpTokenHeader(
        { headers: { other: '1' }, url: 'https://api.example.com/mcp' },
        'fallback',
      ),
    ).toEqual({
      headers: { other: '1' },
      url: 'https://api.example.com/mcp',
    });
  });

  it('does nothing without fallback token', () => {
    expect(
      withBbzaiMcpTokenHeader(
        { headers: { other: '1' }, url: 'https://metadata.faas.ctripcorp.com/mcp' },
        null,
      ),
    ).toEqual({
      headers: { other: '1' },
      url: 'https://metadata.faas.ctripcorp.com/mcp',
    });
  });
});

describe('shouldInjectBbzaiMcpTokenHeader', () => {
  it('returns true for internal ctripcorp URLs', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ url: 'https://foo.ctripcorp.com/mcp' })).toBe(true);
  });

  it('returns false when ctripcorp only appears outside the hostname', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ url: 'https://example.com/.ctripcorp./mcp' })).toBe(
      false,
    );
  });

  it('returns true for internal npm package names', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ packageName: '@ctrip/demo-mcp' })).toBe(true);
  });

  it('returns true when args contain an internal npm package name', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ args: ['-y', '@ctrip/demo-mcp'] })).toBe(true);
  });

  it('returns true when command contains an internal npm package name', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ command: 'npx -y @ctrip/demo-mcp' })).toBe(true);
  });

  it('returns true when npm package is passed through a package flag', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ args: ['--package=@ctrip/demo-mcp'] })).toBe(true);
  });

  it('returns false for external MCPs', () => {
    expect(shouldInjectBbzaiMcpTokenHeader({ url: 'https://api.example.com/mcp' })).toBe(false);
  });
});
