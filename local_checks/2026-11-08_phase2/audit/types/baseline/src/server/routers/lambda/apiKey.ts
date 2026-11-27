import { z } from 'zod';

import { ApiKeyModel } from '@/database/models/apiKey';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { publishApiKeyInvalidation } from '@/server/services/apiKeyCacheBus';

const apiKeyProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      apiKeyModel: new ApiKeyModel(ctx.serverDB, ctx.userId),
    },
  });
});

export const apiKeyRouter = router({
  createApiKey: apiKeyProcedure
    .input(
      z.object({
        expiresAt: z.date().optional().nullable(),
        name: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return await ctx.apiKeyModel.create(input);
    }),

  /*
   * 吊销后广播缓存失效。
   *
   * 校验结果在各实例的**进程内**缓存里（`packages/openapi` 的 Map），
   * 不广播的话被吊销的 key 在其它实例上最多还能再用满一个 TTL。
   *
   * 这里广播的是「清全部」而不是「清这一个」：`apiKeyModel.delete` 收 id、
   * 不回传被删的行，而缓存以 token 字符串为键 —— 精确失效需要先多查一次库。
   * 吊销是低频操作，清全部的代价只是各实例的 key 各重验一次，
   * 不值得为它在删除路径上加一次查询。
   */
  deleteAllApiKeys: apiKeyProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.apiKeyModel.deleteAll();
    await publishApiKeyInvalidation({ all: true });
    return result;
  }),

  deleteApiKey: apiKeyProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.apiKeyModel.delete(input.id);
      await publishApiKeyInvalidation({ all: true });
      return result;
    }),

  getApiKey: apiKeyProcedure
    .input(z.object({ apiKey: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findByKey(input.apiKey);
    }),

  getApiKeyById: apiKeyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.findById(input.id);
    }),

  getApiKeys: apiKeyProcedure.query(async ({ ctx }) => {
    return ctx.apiKeyModel.query();
  }),

  updateApiKey: apiKeyProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.object({
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          expiresAt: z.date().optional().nullable(),
          name: z.string().optional(),
        }),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.apiKeyModel.update(input.id, input.value);
    }),

  validateApiKey: apiKeyProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.apiKeyModel.validateKey(input.key);
    }),
});
