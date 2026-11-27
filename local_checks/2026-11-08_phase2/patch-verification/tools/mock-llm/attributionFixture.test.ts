import { describe, expect, it } from 'vitest';
import { attributionFixture } from './attributionFixture';

describe('controlled attribution candidate fixture', () => {
  it('returns the exact supplied candidate, including deliberately invalid claims', () => {
    const candidate = { category: 'invented-category', evidenceRefs: [{ nodeId: 'fabricated' }] };
    const result = attributionFixture({ messages: [{ role: 'user', content: JSON.stringify({ syntheticCandidate: candidate }) }], response_format: { type: 'json_schema' } });
    expect(JSON.parse(result.content!)).toEqual(candidate);
  });
  it('rejects requests lacking explicit fixture data', () => {
    expect(attributionFixture({ messages: [{ role: 'user', content: '{}' }] }).error).toMatchObject({ kind: 'http', status: 400 });
  });
});
