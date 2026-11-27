import { describe, expect, it } from 'vitest';

import { normalizeLocale } from './resources';

describe('normalizeLocale', () => {
  it('should return "zh-CN" when locale is undefined', () => {
    expect(normalizeLocale()).toBe('zh-CN');
  });

  it('should return "zh-CN" when locale is "zh-CN"', () => {
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
  });

  it('should return "zh-CN" when locale is "zh"', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN');
  });

  it('should return "zh-CN" when locale is "cn"', () => {
    expect(normalizeLocale('cn')).toBe('zh-CN');
  });

  it('should return "en-US" when locale is "en"', () => {
    expect(normalizeLocale('en')).toBe('en-US');
  });

  it('should return "en-US" when locale is "en-US"', () => {
    expect(normalizeLocale('en-US')).toBe('en-US');
  });

  it('should return "zh-CN" for unknown locales as fallback', () => {
    expect(normalizeLocale('unknown')).toBe('zh-CN');
    expect(normalizeLocale('fr')).toBe('zh-CN');
    expect(normalizeLocale('de')).toBe('zh-CN');
    expect(normalizeLocale('ja-JP')).toBe('zh-CN');
  });
});
