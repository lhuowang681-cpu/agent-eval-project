import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { CommunityService } from '@/server/services/community';

const agentProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
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

export const agentRouter = router({
  getMyAssistantList: agentProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMyAssistantList(input);
    }),

  publishAgent: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        bundledKnowledgeBaseIdentifiers: z.array(z.string()).optional().default([]),
        bundledMcpIdentifiers: z.array(z.string()).optional().default([]),
        bundledSkillIdentifiers: z.array(z.string()).optional().default([]),
        category: z.string(),
        newDisplayName: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishAgent(
        input.agentId,
        input.bundledSkillIdentifiers,
        input.bundledMcpIdentifiers,
        input.bundledKnowledgeBaseIdentifiers,
        input.newDisplayName,
        input.category,
      );
    }),

  checkPublishNameConflict: agentProcedure
    .input(
      z.object({
        displayName: z.string(),
        excludeIdentifier: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.checkAgentPublishNameConflict(
        input.displayName,
        input.excludeIdentifier,
      );
    }),

  updateAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateAgent(input.identifier);
    }),

  delistAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistAgent(input.identifier);
    }),

  relistAgent: agentProcedure
    .input(
      z.object({
        category: z.string().optional(),
        displayName: z.string().optional(),
        identifier: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.relistAgent(input.identifier, {
        category: input.category,
        displayName: input.displayName,
      });
    }),

  installAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installAgent(input.identifier);
    }),

  updateInstalledAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledAgent(input.identifier);
    }),
});

export type AgentRouter = typeof agentRouter;
