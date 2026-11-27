import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { CommunityService } from '@/server/services/community';

const knowledgeBaseAuthProcedure = authedProcedure
  .use(serverDatabase)
  .use(async ({ ctx, next }) => {
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

export const knowledgeBaseRouter = router({
  getMyKnowledgeBaseList: knowledgeBaseAuthProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMyKnowledgeBaseList(input);
    }),

  publishKnowledgeBase: knowledgeBaseAuthProcedure
    .input(
      z.object({
        knowledgeBaseId: z.string(),
        newDisplayName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishKnowledgeBase(input.knowledgeBaseId, input.newDisplayName);
    }),

  checkPublishNameConflict: knowledgeBaseAuthProcedure
    .input(
      z.object({
        displayName: z.string(),
        excludeIdentifier: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.checkKnowledgeBasePublishNameConflict(
        input.displayName,
        input.excludeIdentifier,
      );
    }),

  updateKnowledgeBase: knowledgeBaseAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateKnowledgeBase(input.identifier);
    }),

  delistKnowledgeBase: knowledgeBaseAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistKnowledgeBase(input.identifier);
    }),

  relistKnowledgeBase: knowledgeBaseAuthProcedure
    .input(
      z.object({
        category: z.string().optional(),
        displayName: z.string().optional(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.relistKnowledgeBase(input.identifier, {
        category: input.category,
        displayName: input.displayName,
      });
    }),

  installKnowledgeBase: knowledgeBaseAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installKnowledgeBase(input.identifier);
    }),

  updateInstalledKnowledgeBase: knowledgeBaseAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledKnowledgeBase(input.identifier);
    }),
});

export type KnowledgeBaseRouter = typeof knowledgeBaseRouter;
