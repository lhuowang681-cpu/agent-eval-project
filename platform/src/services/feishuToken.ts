import {
  FEISHU_MCP_ALLOWED_TOOLS,
  FEISHU_MCP_IDENTIFIER,
  FEISHU_MCP_URL,
} from '@lobechat/builtin-mcp-feishu';

import { FEISHU_OAUTH_CALLBACK_PATH, FEISHU_OAUTH_RESULT_STORAGE_KEY } from '@/const/feishuOAuth';
import { lambdaClient } from '@/libs/trpc/client';
import { type MCPClientParams } from '@/libs/mcp/types';

/**
 * 飞书 user_access_token 获取封装
 * - 有有效 token（localStorage 缓存）→ 直接返回
 * - 有 refresh_token → 自动刷新
 * - 否则返回 auth_required，由 UI 引导用户点击「去授权」后完成授权
 *
 * ⚠️ 换票必须走服务端（tRPC `feishuAuth.*`），本文件**不得出现 app_secret**。
 *
 * 早先这里是 `new LarkAuth({ appId, appSecret })`，把飞书应用密钥硬编码在浏览器
 * 侧代码里，构建后能在 `dist/**` 的 JS 产物里直接 grep 到明文 —— 任何访问过页面
 * 的人都能拿到，可冒充该应用调用飞书开放平台。现在密钥只留在服务端环境变量
 * （`AUTH_FEISHU_APP_ID` / `AUTH_FEISHU_APP_SECRET`，与站点 SSO 登录共用一套），
 * 浏览器只经由已鉴权的 tRPC 过程拿换好的 token。
 *
 * 授权码的回传走**同源** localStorage 交接，见 `src/const/feishuOAuth.ts`。
 */

export const FEISHU_AUTH_REQUIRED = 'FEISHU_AUTH_REQUIRED';

/** token 缓存键。与授权码交接键分开，两者生命周期不同。 */
const TOKEN_STORAGE_KEY = 'calcifer:feishu-token';

/** 提前量：剩余有效期不足这个数就当作已过期，避免刚取到就在飞书侧过期。 */
const EXPIRY_SKEW_MS = 60 * 1000;

const AUTH_POLL_INTERVAL_MS = 500;
const AUTH_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export type FeishuTokenRequestResult =
  | { status: 'ready'; token: string }
  | { status: 'auth_required'; authUrl: string };

export interface FeishuAuthRequiredError {
  authUrl: string;
  type: typeof FEISHU_AUTH_REQUIRED;
}

export const isFeishuAuthRequiredError = (error: unknown): error is FeishuAuthRequiredError =>
  typeof error === 'object' &&
  error !== null &&
  (error as FeishuAuthRequiredError).type === FEISHU_AUTH_REQUIRED;

interface PendingAuthGate {
  authUrl: string;
  reject: (error: Error) => void;
  resolve: (token: string) => void;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  refreshToken?: string;
}

interface OAuthCallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
  status: 'error' | 'success';
}

let pendingRequestToken: Promise<FeishuTokenRequestResult> | null = null;
let pendingCompleteAuthorization: Promise<string> | null = null;
let pendingAuthGate: PendingAuthGate | null = null;
let lastSyncedToken: string | null = null;
/** 最近一次 createAuthorization 生成的 state，回调结果要与之比对（防 CSRF） */
let pendingAuthState: string | null = null;

const assertBrowser = (): void => {
  if (typeof window === 'undefined') {
    throw new Error('feishuToken 仅限浏览器环境使用');
  }
};

const getRedirectUri = (): string => {
  assertBrowser();
  return `${window.location.origin}${FEISHU_OAUTH_CALLBACK_PATH}`;
};

const readCachedToken = (): CachedToken | null => {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedToken;
    return parsed?.accessToken ? parsed : null;
  } catch {
    return null;
  }
};

const writeCachedToken = (token: CachedToken): void => {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
  } catch {
    // localStorage 不可用时退化为「每次都要重新授权」，功能仍可用
  }
};

const clearCachedToken = (): void => {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
};

const isAccessTokenUsable = (token: CachedToken | null): token is CachedToken =>
  !!token && token.expiresAt - EXPIRY_SKEW_MS > Date.now();

const isRefreshTokenUsable = (token: CachedToken | null): boolean =>
  !!token?.refreshToken &&
  (token.refreshExpiresAt === undefined || token.refreshExpiresAt - EXPIRY_SKEW_MS > Date.now());

/**
 * 拿到有效 token 后把飞书身份（open_id/union_id）同步进当前用户，并刷新用户 store
 * 让个人资料即时显示。按 token 去重，避免每次 MCP 取 token 都写库；缓存 token 也会同步一次。
 */
const syncFeishuBinding = (token: string): void => {
  if (!token || token === lastSyncedToken) return;
  import('@/services/user')
    .then(({ userService }) => userService.syncFeishuBindingFromToken(token))
    .then(async (result) => {
      if (!result) return;
      lastSyncedToken = token;
      const { useUserStore } = await import('@/store/user');
      await useUserStore.getState().refreshUserState();
    })
    .catch(() => {});
};

/** 读取并**消费**回调页写下的授权结果（一次性，读完即删） */
const consumeCallbackResult = (): OAuthCallbackResult | null => {
  try {
    const raw = localStorage.getItem(FEISHU_OAUTH_RESULT_STORAGE_KEY);
    if (!raw) return null;
    localStorage.removeItem(FEISHU_OAUTH_RESULT_STORAGE_KEY);
    return JSON.parse(raw) as OAuthCallbackResult;
  } catch {
    return null;
  }
};

const waitForCallbackResult = async (): Promise<OAuthCallbackResult> => {
  const deadline = Date.now() + AUTH_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = consumeCallbackResult();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
  }

  throw new Error('飞书授权超时：未在有效期内收到授权结果');
};

export const feishuTokenService = {
  /** 请求飞书 user_access_token，需授权时返回 authUrl 而不自动弹窗 */
  async requestToken(): Promise<FeishuTokenRequestResult> {
    if (pendingRequestToken) return pendingRequestToken;

    pendingRequestToken = (async () => {
      assertBrowser();

      const cached = readCachedToken();

      if (isAccessTokenUsable(cached)) {
        syncFeishuBinding(cached.accessToken);
        return { status: 'ready', token: cached.accessToken } as const;
      }

      if (isRefreshTokenUsable(cached)) {
        try {
          const refreshed = await lambdaClient.feishuAuth.refreshToken.mutate({
            refreshToken: cached!.refreshToken!,
          });
          writeCachedToken(refreshed);
          syncFeishuBinding(refreshed.accessToken);
          return { status: 'ready', token: refreshed.accessToken } as const;
        } catch {
          // 刷新失败（refresh_token 失效/被撤销）→ 丢弃缓存，走重新授权
          clearCachedToken();
        }
      }

      const { authUrl, state } = await lambdaClient.feishuAuth.createAuthorization.mutate({
        redirectUri: getRedirectUri(),
      });
      pendingAuthState = state;

      return { status: 'auth_required', authUrl } as const;
    })();

    try {
      return await pendingRequestToken;
    } finally {
      pendingRequestToken = null;
    }
  },

  /**
   * 阻塞等待用户完成授权（由聊天 MCP 调用方 await）
   * 用户点击「去授权」后通过 fulfillUserAuthorization 解除阻塞
   */
  waitForUserAuthorization(authUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      pendingAuthGate = { authUrl, reject, resolve };
    });
  },

  /** 用户点击「去授权」：打开授权页、换票，并解除 waitForUserAuthorization 阻塞 */
  async fulfillUserAuthorization(): Promise<string> {
    if (!pendingAuthGate) {
      throw new Error('No pending Feishu authorization');
    }

    const gate = pendingAuthGate;

    try {
      feishuTokenService.openAuthPage(gate.authUrl);
      const token = await feishuTokenService.completeAuthorization();
      pendingAuthGate = null;
      gate.resolve(token);
      return token;
    } catch (error) {
      pendingAuthGate = null;
      gate.reject(error as Error);
      throw error;
    }
  },

  /** 在用户点击后打开飞书授权页 */
  openAuthPage(authUrl: string): void {
    window.open(authUrl, '_blank', 'noopener,noreferrer');
  },

  /** 用户完成授权后调用，轮询换票并返回 token */
  async completeAuthorization(): Promise<string> {
    if (pendingCompleteAuthorization) return pendingCompleteAuthorization;

    pendingCompleteAuthorization = (async () => {
      assertBrowser();

      const result = await waitForCallbackResult();

      if (result.status !== 'success' || !result.code) {
        throw new Error(result.errorDescription ?? result.error ?? '飞书授权失败');
      }

      // state 比对：拒绝不是本次授权发起的回调结果
      if (pendingAuthState && result.state !== pendingAuthState) {
        throw new Error('飞书授权状态校验失败（state mismatch）');
      }
      pendingAuthState = null;

      const token = await lambdaClient.feishuAuth.exchangeCode.mutate({
        code: result.code,
        redirectUri: getRedirectUri(),
      });

      writeCachedToken(token);
      syncFeishuBinding(token.accessToken);
      return token.accessToken;
    })();

    try {
      return await pendingCompleteAuthorization;
    } finally {
      pendingCompleteAuthorization = null;
    }
  },

  /** 清除 token（包括 localStorage） */
  async clearToken(): Promise<void> {
    clearCachedToken();
    lastSyncedToken = null;
    pendingAuthState = null;
  },
};

/**
 * 构建飞书 MCP 的连接参数
 * 每次调用时需要动态传入 UAT（通过 feishuTokenService.requestToken() 获取）
 */
export const buildFeishuMcpParams = (uat: string): MCPClientParams => ({
  type: 'http',
  url: FEISHU_MCP_URL,
  name: FEISHU_MCP_IDENTIFIER,
  headers: {
    'X-Lark-MCP-UAT': uat,
    'X-Lark-MCP-Allowed-Tools': FEISHU_MCP_ALLOWED_TOOLS.join(','),
  },
});
