import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { CommunityService } from '@/server/services/community';

const mcpAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB,
        userId: ctx.userId,
      }),
    },
  });
});

export const mcpRouter = router({
  getMyMcpList: mcpAuthProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt', 'createdAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMyMcpList(input);
    }),

  publishMcp: mcpAuthProcedure
    .input(
      z.object({
        category: z.string(),
        customParams: z.any(),
        identifier: z.string(),
        manifest: z.any(),
        newDisplayName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishMcp(
        input.identifier,
        input.manifest,
        input.customParams,
        input.newDisplayName,
        input.category,
      );
    }),

  checkPublishNameConflict: mcpAuthProcedure
    .input(
      z.object({
        displayName: z.string(),
        excludeIdentifier: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.checkMcpPublishNameConflict(
        input.displayName,
        input.excludeIdentifier,
      );
    }),

  updateMcp: mcpAuthProcedure
    .input(
      z.object({
        customParams: z.any().optional(),
        identifier: z.string(),
        manifest: z.any().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateMcp(input.identifier, input.manifest, input.customParams);
    }),

  delistMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistMcp(input.identifier);
    }),

  relistMcp: mcpAuthProcedure
    .input(
      z.object({
        category: z.string().optional(),
        displayName: z.string().optional(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.relistMcp(input.identifier, {
        category: input.category,
        displayName: input.displayName,
      });
    }),

  restoreMcpToLocal: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.restoreMcpToLocal(input.identifier);
    }),

  installMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installMcp(input.identifier);
    }),

  updateInstalledMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledMcp(input.identifier);
    }),
});

export type McpRouter = typeof mcpRouter;
