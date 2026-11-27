import { describe, expect, it } from 'vitest';

import { parseShasumsFile } from '../download';

describe('parseShasumsFile', () => {
  it('parses standard SHASUMS format', () => {
    const text = [
      '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16  node-v24.14.0-darwin-arm64.tar.xz',
      'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e  node-v24.14.0-win-x64.zip',
      '',
    ].join('\n');
    const map = parseShasumsFile(text);
    expect(map.get('node-v24.14.0-win-x64.zip')).toBe(
      'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e',
    );
    expect(map.get('node-v24.14.0-darwin-arm64.tar.xz')).toBe(
      '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16',
    );
  });

  it('ignores empty or malformed lines', () => {
    const text = ['', 'not a valid line', 'abc  file.zip'].join('\n');
    const map = parseShasumsFile(text);
    expect(map.size).toBe(1);
    expect(map.get('file.zip')).toBe('abc');
  });

  it('handles CRLF line endings', () => {
    const text = 'abc123  file.zip\r\ndef456  other.tar.gz\r\n';
    const map = parseShasumsFile(text);
    expect(map.size).toBe(2);
  });

  it('handles binary-marker asterisk prefix', () => {
    const text = 'abc  *file.zip';
    const map = parseShasumsFile(text);
    expect(map.get('file.zip')).toBe('abc');
  });
});
