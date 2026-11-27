import { describe, expect, it, vi } from 'vitest';

import { embedWithRetry } from './embedWithRetry';

describe('embedWithRetry', () => {
  // 验收标准 1 (A): batch 调用前几次因限流失败,退避重试后成功 → 最终返回结果
  it('retries on transient failure and eventually succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('ProviderBizError'))
      .mockRejectedValueOnce(new Error('ProviderBizError'))
      .mockResolvedValue([[1, 2, 3]]);

    const result = await embedWithRetry(fn, { minTimeout: 1, retries: 3 });

    expect(result).toEqual([[1, 2, 3]]);
    expect(fn).toHaveBeenCalledTimes(3); // 2 failures + 1 success
  });

  // 验收标准 1 (A): 超过重试上限仍失败 → 抛出最后一次错误
  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ProviderBizError'));

    await expect(embedWithRetry(fn, { minTimeout: 1, retries: 2 })).rejects.toThrow(
      'ProviderBizError',
    );
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  // 回归: 首次即成功时不重试
  it('does not retry when the first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue([[9]]);

    const result = await embedWithRetry(fn, { minTimeout: 1, retries: 3 });

    expect(result).toEqual([[9]]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
