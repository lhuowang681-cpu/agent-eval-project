import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { CommunityService } from '@/server/services/community';

import { agentRouter } from './agent';
import { knowledgeBaseRouter } from './knowledgeBase';
import { mcpRouter } from './mcp';
import { shareRouter } from './share';
import { skillRouter } from './skill';
import { userRouter } from './user';

const communityProcedure = publicProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB,
        userId: ctx.userId || '',
      }),
    },
  });
});

const authedCommunityProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
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

export const marketRouter = router({
  getAssistantList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getAssistantList(input);
    }),

  getAssistantDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getAssistantDetail(input.identifier);
    }),

  getSkillList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getSkillList(input);
    }),

  getSkillDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getSkillDetail(input.identifier);
    }),

  getMcpList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        connectionType: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt', 'createdAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMcpList(input);
    }),

  getMcpDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMcpDetail(input.identifier);
    }),

  getKnowledgeBaseList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getKnowledgeBaseList(input);
    }),

  getKnowledgeBaseDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getKnowledgeBaseDetail(input.identifier);
    }),

  getLeaderboard: communityProcedure
    .input(
      z
        .object({
          days: z.number().int().positive().default(30),
          limit: z.number().int().positive().max(20).default(5),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getLeaderboard(input?.days, input?.limit);
    }),

  getUnpublishedResources: authedCommunityProcedure.query(async ({ ctx }) => {
    return ctx.communityService.getUnpublishedResources();
  }),

  getPublisherResourceStates: authedCommunityProcedure.query(async ({ ctx }) => {
    return ctx.communityService.getPublisherResourceStates();
  }),

  recordAgentUsage: authedCommunityProcedure
    .input(z.object({ agentIdentifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.communityService.recordAgentUsage(input.agentIdentifier);
      return { success: true };
    }),

  recordSkillUsage: authedCommunityProcedure
    .input(z.object({ agentId: z.string().optional(), skillIdentifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.communityService.recordSkillUsage(input.skillIdentifier, input.agentId);
      return { success: true };
    }),

  recordMcpUsage: authedCommunityProcedure
    .input(z.object({ agentId: z.string().optional(), mcpIdentifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.communityService.recordMcpUsage(input.mcpIdentifier, input.agentId);
      return { success: true };
    }),

  agent: agentRouter,
  knowledgeBase: knowledgeBaseRouter,
  mcp: mcpRouter,
  share: shareRouter,
  skill: skillRouter,
  user: userRouter,
});

export type MarketRouter = typeof marketRouter;
