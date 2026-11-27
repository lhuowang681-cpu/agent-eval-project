import { describe, expect, it } from 'vitest';
import { judgeFixture } from '../../../../../tools/mock-llm/judge';

const request = {
  messages: [
    { content: '[Question] task [Output] answer [Criteria] criteria [Expected] reference' },
  ],
  response_format: { type: 'json_schema' },
};
describe('offline Judge fixtures', () => {
  it('selects valid and zero outcomes independently for concurrent requests', async () => {
    const responses = await Promise.all(
      ['mock-judge-zero', 'mock-judge-valid', 'mock-judge-zero'].map(async (model) =>
        JSON.parse(judgeFixture(model, request).content!),
      ),
    );
    expect(responses.map((value) => value.score)).toEqual([0, 1, 0]);
  });
  it('rejects incomplete structured context', () => {
    expect(judgeFixture('mock-judge-valid', {}).error?.status).toBe(400);
  });
  it('has separate empty, malformed, range, binary, provider and timeout fixtures', () => {
    expect(judgeFixture('mock-judge-empty', request).content).toBe('');
    expect(() => JSON.parse(judgeFixture('mock-judge-invalid-json', request).content!)).toThrow();
    expect(JSON.parse(judgeFixture('mock-judge-out-of-range', request).content!).score).toBe(2);
    expect(JSON.parse(judgeFixture('mock-judge-binary-half', request).content!).score).toBe(0.5);
    expect(JSON.parse(judgeFixture('mock-judge-empty-reason', request).content!).reason).toBe('');
    expect(judgeFixture('mock-judge-error', request).error?.status).toBe(503);
    expect(judgeFixture('mock-judge-timeout', request).error?.kind).toBe('timeout');
  });
});
