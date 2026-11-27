import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FEISHU_OAUTH_RESULT_STORAGE_KEY } from '@/const/feishuOAuth';

const mockCreateAuthorization = vi.fn();
const mockExchangeCode = vi.fn();
const mockRefreshToken = vi.fn();

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    feishuAuth: {
      createAuthorization: { mutate: mockCreateAuthorization },
      exchangeCode: { mutate: mockExchangeCode },
      refreshToken: { mutate: mockRefreshToken },
    },
  },
}));

vi.mock('@lobechat/builtin-mcp-feishu', () => ({
  FEISHU_MCP_ALLOWED_TOOLS: ['fetch-doc'],
  FEISHU_MCP_IDENTIFIER: 'builtin-feishu-mcp',
  FEISHU_MCP_URL: 'https://mcp.feishu.cn/mcp',
}));

// 绑定同步是异步副作用，与本文件要验的换票逻辑无关，打掉避免噪音
vi.mock('@/services/user', () => ({ userService: { syncFeishuBindingFromToken: vi.fn() } }));

const TOKEN_STORAGE_KEY = 'calcifer:feishu-token';
const HOUR = 60 * 60 * 1000;

const seedCache = (token: Record<string, unknown>) =>
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));

const seedCallback = (result: Record<string, unknown>) =>
  localStorage.setItem(FEISHU_OAUTH_RESULT_STORAGE_KEY, JSON.stringify(result));

describe('feishuTokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    localStorage.clear();
  });

  it('requestToken should return ready token when cache is valid', async () => {
    seedCache({ accessToken: 'uat-token', expiresAt: Date.now() + HOUR });

    const { feishuTokenService } = await import('./feishuToken');
    const result = await feishuTokenService.requestToken();

    expect(result).toEqual({ status: 'ready', token: 'uat-token' });
    expect(mockCreateAuthorization).not.toHaveBeenCalled();
  });

  it('requestToken should refresh server-side when access token expired', async () => {
    seedCache({
      accessToken: 'stale',
      expiresAt: Date.now() - 1000,
      refreshExpiresAt: Date.now() + 10 * HOUR,
      refreshToken: 'refresh-1',
    });
    mockRefreshToken.mockResolvedValue({ accessToken: 'fresh', expiresAt: Date.now() + HOUR });

    const { feishuTokenService } = await import('./feishuToken');
    const result = await feishuTokenService.requestToken();

    expect(mockRefreshToken).toHaveBeenCalledWith({ refreshToken: 'refresh-1' });
    expect(result).toEqual({ status: 'ready', token: 'fresh' });
  });

  it('requestToken should fall back to re-authorization when refresh fails', async () => {
    seedCache({
      accessToken: 'stale',
      expiresAt: Date.now() - 1000,
      refreshToken: 'revoked',
    });
    mockRefreshToken.mockRejectedValue(new Error('refresh_token revoked'));
    mockCreateAuthorization.mockResolvedValue({
      authUrl: 'https://feishu.cn/oauth',
      state: 'state-1',
    });

    const { feishuTokenService } = await import('./feishuToken');
    const result = await feishuTokenService.requestToken();

    expect(result).toEqual({ status: 'auth_required', authUrl: 'https://feishu.cn/oauth' });
    // 失效缓存必须被丢弃，否则下次仍会拿它去刷新
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('requestToken should return auth_required without opening a window', async () => {
    mockCreateAuthorization.mockResolvedValue({
      authUrl: 'https://feishu.cn/oauth',
      state: 'state-1',
    });
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const { feishuTokenService } = await import('./feishuToken');
    const result = await feishuTokenService.requestToken();

    expect(result).toEqual({ status: 'auth_required', authUrl: 'https://feishu.cn/oauth' });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('openAuthPage should open authorization url in a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { feishuTokenService } = await import('./feishuToken');

    feishuTokenService.openAuthPage('https://feishu.cn/oauth');

    expect(openSpy).toHaveBeenCalledWith('https://feishu.cn/oauth', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('completeAuthorization should exchange the callback code server-side and cache the token', async () => {
    mockCreateAuthorization.mockResolvedValue({
      authUrl: 'https://feishu.cn/oauth',
      state: 'state-1',
    });
    mockExchangeCode.mockResolvedValue({
      accessToken: 'completed-token',
      expiresAt: Date.now() + HOUR,
      refreshToken: 'refresh-2',
    });

    const { feishuTokenService } = await import('./feishuToken');
    await feishuTokenService.requestToken(); // 建立 pendingAuthState
    seedCallback({ code: 'auth-code', state: 'state-1', status: 'success' });

    const token = await feishuTokenService.completeAuthorization();

    expect(token).toBe('completed-token');
    expect(mockExchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth-code' }),
    );
    // 授权码是一次性的，读完必须清掉
    expect(localStorage.getItem(FEISHU_OAUTH_RESULT_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY)!).accessToken).toBe('completed-token');
  });

  it('completeAuthorization should reject a callback whose state does not match', async () => {
    mockCreateAuthorization.mockResolvedValue({
      authUrl: 'https://feishu.cn/oauth',
      state: 'state-1',
    });

    const { feishuTokenService } = await import('./feishuToken');
    await feishuTokenService.requestToken();
    seedCallback({ code: 'auth-code', state: 'attacker-state', status: 'success' });

    await expect(feishuTokenService.completeAuthorization()).rejects.toThrow('state mismatch');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('completeAuthorization should surface the error returned by the callback', async () => {
    const { feishuTokenService } = await import('./feishuToken');
    seedCallback({ error: 'access_denied', errorDescription: '用户拒绝授权', status: 'error' });

    await expect(feishuTokenService.completeAuthorization()).rejects.toThrow('用户拒绝授权');
    expect(mockExchangeCode).not.toHaveBeenCalled();
  });

  it('clearToken should clear the cached token', async () => {
    seedCache({ accessToken: 'uat-token', expiresAt: Date.now() + HOUR });

    const { feishuTokenService } = await import('./feishuToken');
    await feishuTokenService.clearToken();

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });

  it('waitForUserAuthorization should resolve when fulfillUserAuthorization completes', async () => {
    mockCreateAuthorization.mockResolvedValue({
      authUrl: 'https://feishu.cn/oauth',
      state: 'state-1',
    });
    mockExchangeCode.mockResolvedValue({
      accessToken: 'completed-token',
      expiresAt: Date.now() + HOUR,
    });

    const { feishuTokenService } = await import('./feishuToken');
    await feishuTokenService.requestToken();
    seedCallback({ code: 'auth-code', state: 'state-1', status: 'success' });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    const waitPromise = feishuTokenService.waitForUserAuthorization('https://feishu.cn/oauth');
    const fulfillPromise = feishuTokenService.fulfillUserAuthorization();

    await expect(Promise.all([waitPromise, fulfillPromise])).resolves.toEqual([
      'completed-token',
      'completed-token',
    ]);

    openSpy.mockRestore();
  });

  it('must not embed any Feishu app secret in the browser bundle', async () => {
    // 回归护栏：这个模块过去 `new LarkAuth({ appId, appSecret })`，把密钥打进了前端产物。
    // 换票已移到服务端 tRPC，这里不应再出现任何应用凭证字面量。
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const source = await fs.readFile(
      path.resolve(process.cwd(), 'src/services/feishuToken.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/appSecret\s*:/);
    expect(source).not.toMatch(/\bcli_[a-z0-9]{16,}/);
  });
});
