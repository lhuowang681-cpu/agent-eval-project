import { z } from 'zod';

import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { AgentEvalRunOrchestrator } from '@/server/services/agentEvalRun/orchestrator';

const runBenchmarkInputSchema = z.object({
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  runId: z.string(),
});

const executeTestCaseInputSchema = z.object({
  runId: z.string(),
  testCaseId: z.string(),
});

export const evalRouter = router({
  executeTestCase: asyncAuthedProcedure
    .input(executeTestCaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const orchestrator = await AgentEvalRunOrchestrator.create(ctx.userId);
      void orchestrator.executeTestCase({
        runId: input.runId,
        testCaseId: input.testCaseId,
        userId: ctx.userId,
      });

      return { success: true };
    }),

  runBenchmark: asyncAuthedProcedure
    .input(runBenchmarkInputSchema)
    .mutation(async ({ ctx, input }) => {
      const orchestrator = await AgentEvalRunOrchestrator.create(ctx.userId);
      void orchestrator.runBenchmark({
        dryRun: input.dryRun,
        force: input.force,
        runId: input.runId,
        userId: ctx.userId,
      });

      return { success: true };
    }),
});
