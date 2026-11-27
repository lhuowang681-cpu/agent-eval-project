import { describe, expect, it } from 'vitest';

import { systemPrompt } from '../packages/builtin-tool-web-browsing/src/systemRole';

describe('builtin-tool-web-browsing systemPrompt', () => {
  it('should inject public web crawl policy when publicWebCrawlDisabled is true', () => {
    const prompt = systemPrompt('2026-04-09', { publicWebCrawlDisabled: true });

    expect(prompt).toContain('<public_web_page_crawl_policy>');
    expect(prompt).toContain('PublicWebCrawlDisabled');
  });

  it('should instruct the model not to combine github engine with site filters', () => {
    const prompt = systemPrompt('2026-04-09');

    expect(prompt).toContain('Never combine the `github` engine with `site:github.com`');
    expect(prompt).toContain('If you need `site:github.com`');
    expect(prompt).toContain(
      'use broad web search engines or the `general` category instead of the `github` engine',
    );
    expect(prompt).toContain(
      'When using the `github` engine, rewrite the query into GitHub-native keywords',
    );
  });
});
