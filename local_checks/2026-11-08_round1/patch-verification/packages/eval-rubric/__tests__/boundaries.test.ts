import type { EvalBenchmarkRubric } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { evaluate } from '../src';
import { matchNumeric } from '../src/matchers/numeric';
import { matchRegex } from '../src/matchers/regex';

const rubric: EvalBenchmarkRubric = {
  config: { value: '' },
  id: 'exact',
  name: 'Exact',
  type: 'equals',
  weight: 1,
};

describe('scoring input boundaries', () => {
  it.each(['[]', '[42]', '[null]', '["ok", {}]'])(
    'rejects invalid expected candidates %s',
    async (expected: string) => {
      await expect(
        evaluate({ actual: 'ok', rubrics: [rubric], testCase: { input: 'question', expected } }),
      ).rejects.toThrow(/expected.*non-empty.*strings/i);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid weight %s instead of producing an unbounded score',
    async (weight: number) => {
      await expect(
        evaluate({
          actual: 'ok',
          rubrics: [
            { ...rubric, weight },
            { ...rubric, id: 'other', weight: 2 },
          ],
          testCase: { input: '?', expected: 'ok' },
        }),
      ).rejects.toThrow(/weight/i);
    },
  );

  it('rejects a configuration with no positive weight', async () => {
    await expect(
      evaluate({
        actual: 'ok',
        rubrics: [{ ...rubric, weight: 0 }],
        testCase: { input: '?', expected: 'ok' },
      }),
    ).rejects.toThrow(/weight/i);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid pass threshold %s',
    async (passThreshold: number) => {
      await expect(
        evaluate(
          { actual: 'ok', rubrics: [rubric], testCase: { input: '?', expected: 'ok' } },
          { passThreshold },
        ),
      ).rejects.toThrow(/threshold/i);
    },
  );

  it('allows zero-weight rubrics alongside a positive weight', async () => {
    const result = await evaluate({
      actual: 'ok',
      rubrics: [
        { ...rubric, weight: 0 },
        { ...rubric, id: 'other', weight: 2 },
      ],
      testCase: { input: '?', expected: 'ok' },
    });
    expect(result.score).toBe(1);
  });

  it('reports an invalid regular expression as a configuration error', () => {
    expect(() => matchRegex('answer', { pattern: '[' })).toThrow(/invalid.*regex/i);
  });

  it.each([
    ['1e3', '1000'],
    ['-2.5E-2', '-0.025'],
    ['The answer is +1.2e+3 units.', '1200'],
    ['$1,234.50', '1234.5'],
    ['.5', '0.5'],
  ])('preserves numeric meaning of %s', (actual: string, expected: string) => {
    expect(matchNumeric(actual, expected, { value: 0 }).passed).toBe(true);
  });

  it('does not turn 1e3 into 13', () => {
    expect(matchNumeric('1e3', '13', { value: 0 }).passed).toBe(false);
  });

  it('does not concatenate unrelated numbers', () => {
    expect(matchNumeric('1 and 3', '13', { value: 0 }).passed).toBe(false);
  });
});
