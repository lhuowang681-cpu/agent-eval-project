import debug from 'debug';

import { auth } from '@/auth';
import { LOBE_CHAT_OIDC_AUTH_HEADER, authEnv } from '@/envs/auth';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';

const log = debug('lobe-server:auth:resolve-route-user');

/**
 * 解析普通 Route Handler 的调用者身份（**只认证，不做资源归属校验**）。
 *
 * 为什么要单独有这个：`checkAuth` 是给聊天/模型路由用的，强制要求
 * `LOBE_CHAT_AUTH_HEADER` 里的 XOR payload 并负责构造 ModelRuntime —— 那是另一类调用形态。
 * 而像 SSE 这种从 SPA 直接发起的请求，凭证形态与 tRPC lambda 完全一致：
 * cookie 会话 / `Oidc-Auth` 头 / 开发态旁路。
 *
 * 这里**严格镜像** `src/libs/trpc/lambda/context.ts` 的三条路径与优先级，
 * 避免同一套凭证在两个入口被判成不同结果 —— 口径漂移比没有鉴权更难查。
 *
 * @returns 认证通过的 userId；未通过返回 null（由调用方决定回 401 还是降级）
 */
export const resolveRouteUserId = async (request: Request): Promise<string | null> => {
  // 1. 开发态旁路 —— 与 lambda context 同样的双重开关，且同样被 NODE_ENV 守住
  const isDebugApi = request.headers.get('lobe-auth-dev-backend-api') === '1';
  const isMockUser = process.env.ENABLE_MOCK_DEV_USER === '1';
  if (process.env.NODE_ENV === 'development' && (isDebugApi || isMockUser)) {
    return process.env.MOCK_DEV_USER_ID ?? null;
  }

  // 2. OIDC —— 桌面端经 RemoteServerSyncCtr 代理时带的就是这个头
  if (authEnv.ENABLE_OIDC) {
    const oidcAuthToken = request.headers.get(LOBE_CHAT_OIDC_AUTH_HEADER);
    if (oidcAuthToken) {
      try {
        const tokenInfo = await validateOIDCJWT(oidcAuthToken);
        if (tokenInfo?.userId) return tokenInfo.userId;
      } catch (error) {
        // 与 lambda context 一致：OIDC 失败不直接拒绝，继续尝试会话
        log('OIDC validation failed, falling back to session: %O', error);
      }
    }
  }

  // 3. Better Auth 会话（cookie）—— Web / 移动端 SPA 走这条
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user?.id) return session.user.id;
  } catch (error) {
    log('Better Auth session lookup failed: %O', error);
  }

  return null;
};
