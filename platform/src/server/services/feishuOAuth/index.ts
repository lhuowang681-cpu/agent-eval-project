import { FEISHU_AUTHORIZATION_URL, FEISHU_TOKEN_URL } from '@/const/feishuOAuth';
import { authEnv } from '@/envs/auth';

/**
 * 飞书 user_access_token 的**服务端**获取实现。
 *
 * 为什么必须放服务端：换票需要 `app_secret`。此前 `src/services/feishuToken.ts`
 * 在**浏览器**里 `new LarkAuth({ appId, appSecret })`，密钥被直接打进前端 bundle
 * （`dist/**` 里可以 grep 到明文），等同于对所有拿到过页面的人公开。
 *
 * 现在密钥只存在于服务端进程的环境变量里，浏览器只拿换好的 token。
 * 复用的是站点 SSO 登录（`src/libs/better-auth/sso/providers/feishu.ts`）
 * 早就在用的那套 `AUTH_FEISHU_APP_ID` / `AUTH_FEISHU_APP_SECRET`，不新增配置项。
 */

type FeishuTokenPayload = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

type FeishuTokenResponse = {
  code?: number;
  data?: FeishuTokenPayload;
  error?: string;
  error_description?: string;
  message?: string;
  msg?: string;
} & FeishuTokenPayload;

export interface FeishuTokenResult {
  accessToken: string;
  /** 绝对过期时间戳（ms）。飞书只给相对秒数，这里换算好再交给调用方缓存。 */
  expiresAt: number;
  refreshExpiresAt?: number;
  refreshToken?: string;
}

/** 未配置飞书应用时抛这个，调用方据此给出「功能未启用」而不是「授权失败」。 */
export class FeishuNotConfiguredError extends Error {
  constructor() {
    super('Feishu OAuth is not configured: AUTH_FEISHU_APP_ID / AUTH_FEISHU_APP_SECRET missing');
    this.name = 'FeishuNotConfiguredError';
  }
}

export const isFeishuOAuthConfigured = (): boolean =>
  !!(authEnv.AUTH_FEISHU_APP_ID && authEnv.AUTH_FEISHU_APP_SECRET);

const requireCredentials = (): { appId: string; appSecret: string } => {
  const appId = authEnv.AUTH_FEISHU_APP_ID;
  const appSecret = authEnv.AUTH_FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new FeishuNotConfiguredError();
  return { appId, appSecret };
};

/**
 * 构造授权页地址。
 *
 * `app_id` 不是机密（它本来就出现在授权页 URL 里），但也没有理由提前发给前端 ——
 * 由服务端拼好整条 URL，前端只负责打开。
 */
export const buildFeishuAuthorizeUrl = ({
  redirectUri,
  scopes,
  state,
}: {
  redirectUri: string;
  scopes: string[];
  state: string;
}): string => {
  const { appId } = requireCredentials();

  const url = new URL(FEISHU_AUTHORIZATION_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));

  return url.toString();
};

/**
 * 飞书 v2 token 接口对 `authorization_code` 和 `refresh_token` 两种 grant 用的是
 * 同一个端点、同样的返回结构，故合并处理。
 */
const postToken = async (body: Record<string, string>): Promise<FeishuTokenResult> => {
  const response = await fetch(FEISHU_TOKEN_URL, {
    body: JSON.stringify(body),
    cache: 'no-store',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    method: 'POST',
  });

  const parsed = (await response.json().catch(() => ({}))) as FeishuTokenResponse;
  // 飞书有时把结果包在 `data` 里，有时平铺在顶层，SSO provider 里也是这样兼容的。
  const payload = parsed.data ?? parsed;

  const hasErrorCode = typeof parsed.code === 'number' && parsed.code !== 0;

  if (!response.ok || hasErrorCode || !payload.access_token) {
    throw new Error(
      parsed.error_description ??
        parsed.msg ??
        parsed.message ??
        parsed.error ??
        `Feishu token request failed with HTTP ${response.status}`,
    );
  }

  const now = Date.now();

  return {
    accessToken: payload.access_token,
    // 缺 `expires_in` 时按 2 小时兜底（飞书 user_access_token 的常见时长），
    // 宁可早一点判过期去刷新，也不要把过期 token 当有效的用。
    expiresAt: now + (payload.expires_in ?? 7200) * 1000,
    refreshExpiresAt: payload.refresh_token_expires_in
      ? now + payload.refresh_token_expires_in * 1000
      : undefined,
    refreshToken: payload.refresh_token,
  };
};

export const exchangeFeishuCode = async ({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<FeishuTokenResult> => {
  const { appId, appSecret } = requireCredentials();

  return postToken({
    client_id: appId,
    client_secret: appSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
};

export const refreshFeishuToken = async ({
  refreshToken,
}: {
  refreshToken: string;
}): Promise<FeishuTokenResult> => {
  const { appId, appSecret } = requireCredentials();

  return postToken({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
};
