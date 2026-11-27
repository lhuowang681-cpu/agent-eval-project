import { describe, expect, it } from 'vitest';

import { resolveToolMessageContent } from './resolveToolMessageContent';

describe('resolveToolMessageContent', () => {
  it('returns content when present', () => {
    expect(resolveToolMessageContent({ content: 'hello', error: undefined, toolName: 'a/b' })).toBe(
      'hello',
    );
  });

  it('falls back to the error message when content is empty', () => {
    expect(
      resolveToolMessageContent({
        content: '',
        error: { message: 'boom' },
        toolName: 'a/b',
      }),
    ).toBe('boom');
  });

  it('falls back to an explicit marker when both content and error message are missing', () => {
    const result = resolveToolMessageContent({ content: '', error: undefined, toolName: 'a/b' });
    expect(result).toContain('a/b');
    expect(result).toContain('returned no output');
  });
});
