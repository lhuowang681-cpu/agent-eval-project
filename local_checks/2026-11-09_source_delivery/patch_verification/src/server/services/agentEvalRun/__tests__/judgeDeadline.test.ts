import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateJudgeObject } from '../judge';

const payload = { messages: [], model: 'synthetic', schema: {}, timeoutMs: 100 };
afterEach(() => vi.useRealTimers());

describe('hard Judge deadline and validation', () => {
  for (const value of [
    null,
    {},
    { score: '1', reason: 'ok' },
    { score: NaN, reason: 'ok' },
    { score: 2, reason: 'ok' },
    { score: -1, reason: 'ok' },
    { score: 1, reason: '' },
    { score: 1, reason: ' ' },
  ]) {
    it(`rejects malformed result ${JSON.stringify(value)}`, async () => {
      await expect(
        generateJudgeObject(payload, async () => ({ generateObject: async () => value })),
      ).rejects.toMatchObject({ errorCode: 'judge_invalid_result' });
    });
  }
  it('accepts legitimate zero and rejects a fractional binary score', async () => {
    await expect(
      generateJudgeObject(payload, async () => ({
        generateObject: async () => ({ score: 0, reason: 'wrong' }),
      })),
    ).resolves.toEqual({ score: 0, reason: 'wrong' });
    await expect(
      generateJudgeObject({ ...payload, scoreMode: 'binary' }, async () => ({
        generateObject: async () => ({ score: 0.5, reason: 'ambiguous' }),
      })),
    ).rejects.toMatchObject({ errorCode: 'judge_invalid_result' });
  });
  for (const timeoutMs of [0, 99, 60_001, NaN, 100.5]) {
    it(`rejects invalid timeout ${timeoutMs} before initialization`, async () => {
      const initialize = vi.fn();
      await expect(
        generateJudgeObject({ ...payload, timeoutMs }, initialize),
      ).rejects.toMatchObject({ errorCode: 'judge_config' });
      expect(initialize).not.toHaveBeenCalled();
    });
  }
  it('times out when a provider ignores signal and consumes its late rejection', async () => {
    vi.useFakeTimers();
    let rejectLate!: (error: Error) => void;
    let signal: AbortSignal | undefined;
    const result = generateJudgeObject(payload, async () => ({
      generateObject: async (_, options) => {
        signal = options?.signal;
        return new Promise((_, reject) => {
          rejectLate = reject;
        });
      },
    }));
    const assertion = expect(result).rejects.toMatchObject({ errorCode: 'judge_timeout' });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(signal?.aborted).toBe(true);
    rejectLate(new Error('deliberately late provider failure'));
    await vi.advanceTimersByTimeAsync(1);
  });
  it('includes initialization in deadline and never starts a late model call', async () => {
    vi.useFakeTimers();
    let initializeLate!: (runtime: { generateObject: ReturnType<typeof vi.fn> }) => void;
    const generateObject = vi.fn();
    const result = generateJudgeObject(
      payload,
      () =>
        new Promise((resolve) => {
          initializeLate = resolve;
        }),
    );
    const assertion = expect(result).rejects.toMatchObject({ errorCode: 'judge_timeout' });
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    initializeLate({ generateObject });
    await vi.advanceTimersByTimeAsync(1);
    expect(generateObject).not.toHaveBeenCalled();
  });
  it('distinguishes JSON parsing from provider errors', async () => {
    const error = new Error('synthetic malformed JSON');
    error.name = 'StructuredOutputParseError';
    await expect(
      generateJudgeObject(payload, async () => ({
        generateObject: async () => {
          throw error;
        },
      })),
    ).rejects.toMatchObject({ errorCode: 'judge_parse' });
    await expect(
      generateJudgeObject(payload, async () => {
        throw new Error('synthetic unavailable');
      }),
    ).rejects.toMatchObject({ errorCode: 'judge_provider' });
  });
});
