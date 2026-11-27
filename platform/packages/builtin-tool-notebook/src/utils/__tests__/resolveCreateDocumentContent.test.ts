import { describe, expect, it } from 'vitest';

import { resolveCreateDocumentContent } from '../resolveCreateDocumentContent';

describe('resolveCreateDocumentContent', () => {
  it('prefers explicit content', () => {
    expect(
      resolveCreateDocumentContent({
        content: '# Report\n\nBody',
        description: 'summary',
      }),
    ).toBe('# Report\n\nBody');
  });

  it('falls back to description when content is missing', () => {
    expect(
      resolveCreateDocumentContent({
        description: '面向数据分析师的需求文档',
      }),
    ).toBe('面向数据分析师的需求文档');
  });

  it('falls back to description when content is blank', () => {
    expect(
      resolveCreateDocumentContent({
        content: '   ',
        description: 'summary',
      }),
    ).toBe('summary');
  });

  it('returns empty string when both are missing', () => {
    expect(resolveCreateDocumentContent({})).toBe('');
  });
});
