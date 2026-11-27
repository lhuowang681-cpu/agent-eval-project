import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { CommunityService } from '@/server/services/community';

const skillAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
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

export const skillRouter = router({
  getMySkillList: skillAuthProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMySkillList(input);
    }),

  publishSkill: skillAuthProcedure
    .input(
      z.object({
        category: z.string(),
        newDisplayName: z.string().optional(),
        skillId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishSkill(input.skillId, input.newDisplayName, input.category);
    }),

  checkPublishNameConflict: skillAuthProcedure
    .input(
      z.object({
        displayName: z.string(),
        excludeIdentifier: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.checkSkillPublishNameConflict(
        input.displayName,
        input.excludeIdentifier,
      );
    }),

  updateSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateSkill(input.identifier);
    }),

  delistSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistSkill(input.identifier);
    }),

  relistSkill: skillAuthProcedure
    .input(
      z.object({
        category: z.string().optional(),
        displayName: z.string().optional(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.relistSkill(input.identifier, {
        category: input.category,
        displayName: input.displayName,
      });
    }),

  restoreSkillToLocal: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.restoreSkillToLocal(input.identifier);
    }),

  installSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installSkill(input.identifier);
    }),

  updateInstalledSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledSkill(input.identifier);
    }),
});

export type SkillRouter = typeof skillRouter;
