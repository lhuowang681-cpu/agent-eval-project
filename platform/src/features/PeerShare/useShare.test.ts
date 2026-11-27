import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as marketApi from '@/services/marketApi';

import { useShare } from './useShare';

describe('useShare', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // happy-dom 将 navigator.clipboard 定义为 getter-only，需用 defineProperty 覆盖
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createShare 成功后展开 result modal 并暴露完整 URL', async () => {
    const spy = vi
      .spyOn(marketApi.communityApiService, 'createShare')
      .mockResolvedValue({ token: 'tok', url: '/share/tok', marketIdentifier: 'skl_1' });

    const { result } = renderHook(() => useShare());

    await act(async () => {
      await result.current.share('skill', 'local-1');
    });

    expect(spy).toHaveBeenCalledWith('skill', 'local-1');
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result?.open).toBe(true);
    // 完整 URL = origin + 相对 url
    expect(result.current.resultUrl).toContain('/share/tok');
    expect(result.current.resultUrl).toContain(window.location.origin);
  });

  it('createShare 抛错时不打开 modal', async () => {
    vi.spyOn(marketApi.communityApiService, 'createShare').mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useShare());

    await act(async () => {
      await expect(result.current.share('mcp', 'x')).rejects.toThrow('boom');
    });

    expect(result.current.result).toBeNull();
  });

  it('copyLink 调用 clipboard.writeText', async () => {
    vi.spyOn(marketApi.communityApiService, 'createShare').mockResolvedValue({
      token: 'tok',
      url: '/share/tok',
      marketIdentifier: 'mcp_1',
    });
    const { result } = renderHook(() => useShare());

    await act(async () => {
      await result.current.share('mcp', 'x');
    });

    await act(async () => {
      await result.current.copyLink();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(result.current.resultUrl);
  });
});
