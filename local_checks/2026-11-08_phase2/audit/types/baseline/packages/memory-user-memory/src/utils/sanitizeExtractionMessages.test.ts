import { describe, expect, it } from 'vitest';

import { sanitizeMemoryExtractionMessages } from './sanitizeExtractionMessages';

describe('sanitizeMemoryExtractionMessages', () => {
  it('keeps only user and assistant messages with plain text content', () => {
    const result = sanitizeMemoryExtractionMessages([
      { content: 'hello', role: 'user' },
      { content: 'tool output', role: 'tool', tool_call_id: 'call_1' },
      { content: 'reply', role: 'assistant' },
      { content: 'system note', role: 'system' },
    ]);

    expect(result).toEqual([
      { content: 'hello', role: 'user' },
      { content: 'reply', role: 'assistant' },
    ]);
  });

  it('drops empty messages after trimming', () => {
    const result = sanitizeMemoryExtractionMessages([
      { content: '   ', role: 'user' },
      { content: 'valid', role: 'assistant' },
    ]);

    expect(result).toEqual([{ content: 'valid', role: 'assistant' }]);
  });
});
