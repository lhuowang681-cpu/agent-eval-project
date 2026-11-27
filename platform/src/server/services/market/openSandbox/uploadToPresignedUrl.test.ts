import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadToPresignedUrl } from './uploadToPresignedUrl';

describe('uploadToPresignedUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns success when PUT succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => '' }),
    );

    const result = await uploadToPresignedUrl(Buffer.from('data'), 'https://s3.example/upload');

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://s3.example/upload', {
      body: expect.any(Buffer),
      method: 'PUT',
    });
  });

  it('returns error when PUT fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'AccessDenied',
      }),
    );

    const result = await uploadToPresignedUrl(Buffer.from('x'), 'https://s3.example/upload');

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
    expect(result.error).toContain('AccessDenied');
  });
});
