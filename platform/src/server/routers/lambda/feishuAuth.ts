import { FEISHU_LOGIN_SCOPES } from '@lobechat/builtin-mcp-feishu';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import {
  FeishuNotConfiguredError,
  buildFeishuAuthorizeUrl,
  exchangeFeishuCode,
  isFeishuOAuthConfigured,
  refreshFeishuToken,
} from '@/server/services/feishuOAuth';

/**
 * 飞书 user_access_token 的换票入口。
 *
 * 这些过程存在的唯一理由是**让 app_secret 留在服务端**：
 * 浏览器只能拿到换好的 token，拿不到密钥本身。
 *
 * 全部走 `authedProcedure` —— 换票是代表本站应用向飞书发起的动作，
 * 不能开放给未登录调用方。
 */

const toTRPCError = (error: unknown): never => {
  if (error instanceof FeishuNotConfiguredError) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Feishu is not configured on this server',
    });
  }

  throw new TRPCError({
    cause: error,
    code: 'BAD_GATEWAY',
    message: error instanceof Error ? error.message : 'Feishu token request failed',
  });
};

export const feishuAuthRouter = router({
  /** 用授权码换 token；`redirectUri` 必须与发起授权时用的完全一致，否则飞书会拒绝。 */
  exchangeCode: authedProcedure
    .input(z.object({ code: z.string().min(1), redirectUri: z.string().url() }))
    .mutation(async ({ input }) => {
      try {
        return await exchangeFeishuCode(input);
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  /**
   * 生成授权页地址。
   *
   * `state` 由服务端生成并回传，前端在回调里比对，用于防 CSRF ——
   * 也顺带让「同时开了多个授权窗口」这种情况能分辨出结果属于哪一次。
   */
  createAuthorization: authedProcedure
    .input(z.object({ redirectUri: z.string().url() }))
    .mutation(async ({ input }) => {
      const state = crypto.randomUUID();

      try {
        return {
          authUrl: buildFeishuAuthorizeUrl({
            redirectUri: input.redirectUri,
            scopes: [...FEISHU_LOGIN_SCOPES],
            state,
          }),
          state,
        };
      } catch (error) {
        return toTRPCError(error);
      }
    }),

  /** 前端据此决定是展示飞书功能，还是提示「本部署未配置飞书」。 */
  getStatus: authedProcedure.query(async () => ({ configured: isFeishuOAuthConfigured() })),

  refreshToken: authedProcedure
    .input(z.object({ refreshToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        return await refreshFeishuToken(input);
      } catch (error) {
        return toTRPCError(error);
      }
    }),
});
