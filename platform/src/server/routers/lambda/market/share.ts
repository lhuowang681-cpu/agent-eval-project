import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { ShareService } from '@/server/services/community/share';

const shareAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      shareService: new ShareService({ serverDB: ctx.serverDB, userId: ctx.userId }),
    },
  });
});

const sharePublicProcedure = publicProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      shareService: new ShareService({ serverDB: ctx.serverDB, userId: ctx.userId || '' }),
    },
  });
});

export const shareRouter = router({
  create: shareAuthProcedure
    .input(
      z.object({
        itemType: z.enum(['skill', 'mcp', 'agent']),
        localId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => ctx.shareService.createShare(input)),

  getByToken: sharePublicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input, ctx }) => ctx.shareService.getByToken(input.token)),

  revoke: shareAuthProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.shareService.revoke(input.token);
      return { success: true };
    }),

  myShares: shareAuthProcedure.query(async ({ ctx }) => ctx.shareService.myShares()),

  recordInstall: sharePublicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.shareService.recordInstall(input.token);
      return { success: true };
    }),
});

export type ShareRouter = typeof shareRouter;
