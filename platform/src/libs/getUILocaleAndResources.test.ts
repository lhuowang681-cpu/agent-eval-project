import { describe, expect, it, vi } from 'vitest';

import { getUILocaleAndResources } from './getUILocaleAndResources';

describe('getUILocaleAndResources', () => {
  it('should return zh-CN locale and zhCn resources for zh-CN', async () => {
    const result = await getUILocaleAndResources('zh-CN');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en-US', async () => {
    const result = await getUILocaleAndResources('en-US');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return en-US locale and en resources for en', async () => {
    const result = await getUILocaleAndResources('en');
    expect(result.locale).toBe('en-US');
    expect(result.resources).toBeDefined();
  });

  it('should return zh-CN locale and resources for auto', async () => {
    const result = await getUILocaleAndResources('auto');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should fallback to zh-CN for unknown locales', async () => {
    const result = await getUILocaleAndResources('unknown-locale');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });

  it('should fallback to @lobehub/ui builtin resources if business ui.json is missing', async () => {
    vi.resetModules();
    vi.doMock('@/../locales/zh-CN/ui.json', () => ({ default: null }));

    const { getUILocaleAndResources: getWithFallback } = await import('./getUILocaleAndResources');
    const result = await getWithFallback('unknown-locale');
    expect(result.locale).toBe('zh-CN');
    expect(result.resources).toBeDefined();
  });
});
