import { describe, expect, it } from 'vitest';

import { parseJSONL } from '../src/parsers/jsonl';

describe('JSONL physical line numbers', () => {
  it('locates malformed JSON after a blank line', () => {
    expect(() => parseJSONL('{"input":"ok"}\n\ninvalid')).toThrow('Invalid JSON at line 3:');
  });

  it('keeps preview and totalCount based on records rather than physical lines', () => {
    const result = parseJSONL('\n{"input":"first"}\n \n{"input":"second"}\n', { preview: 1 });
    expect(result.rows).toEqual([{ input: 'first' }]);
    expect(result.totalCount).toBe(2);
  });
});
