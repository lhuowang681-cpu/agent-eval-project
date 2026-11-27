import { describe, expect, it } from 'vitest';

import {
  buildMcpTitleFromIdentifier,
  ensureMcpCreateFormValues,
  generateMcpIdentifier,
  hasMcpConnectionChanged,
  serializeMcpConnection,
  slugifyMcpIdentifier,
} from './mcpFormSync';

describe('mcpFormSync', () => {
  it('slugifyMcpIdentifier should normalize english names', () => {
    expect(slugifyMcpIdentifier('My MCP Plugin')).toBe('my-mcp-plugin');
    expect(slugifyMcpIdentifier('中文名称')).toBeUndefined();
  });

  it('buildMcpTitleFromIdentifier should mirror identifier into title', () => {
    expect(buildMcpTitleFromIdentifier('mcp_VcNnhbJU')).toEqual({
      manifest: { meta: { title: 'mcp_VcNnhbJU' } },
    });
  });

  it('ensureMcpCreateFormValues should generate identifier for non-slug titles', () => {
    const result = ensureMcpCreateFormValues({
      customParams: { mcp: { type: 'http', url: 'https://example.com' } },
      identifier: '',
      manifest: { meta: { title: '我的 MCP' } },
      type: 'customPlugin',
    } as any);

    expect(result.identifier).toMatch(/^mcp_[\w-]+$/);
    expect(result.manifest?.meta?.title).toBe('我的 MCP');
  });

  it('ensureMcpCreateFormValues should reuse slugified title as identifier', () => {
    const result = ensureMcpCreateFormValues({
      customParams: { mcp: { type: 'http', url: 'https://example.com' } },
      manifest: { meta: { title: 'my-github-mcp' } },
      type: 'customPlugin',
    } as any);

    expect(result.identifier).toBe('my-github-mcp');
    expect(result.manifest?.meta?.title).toBe('my-github-mcp');
  });

  it('generateMcpIdentifier should match expected pattern', () => {
    expect(generateMcpIdentifier()).toMatch(/^mcp_[\w-]{8}$/);
  });

  it('hasMcpConnectionChanged should detect connection config changes', () => {
    const initial = serializeMcpConnection({ type: 'http', url: 'https://example.com' });
    expect(hasMcpConnectionChanged(initial, { type: 'http', url: 'https://example.com' })).toBe(
      false,
    );
    expect(hasMcpConnectionChanged(initial, { type: 'http', url: 'https://other.com' })).toBe(true);
  });
});
