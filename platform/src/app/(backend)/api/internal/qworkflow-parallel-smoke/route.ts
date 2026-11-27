import { serve } from '@ctrip/qworkflow/nextjs';

interface ParallelSmokePayload {
  items?: string[];
}

/**
 * Parallel @ctrip/qworkflow smoke — Promise.all + one serial step after the wave.
 * Used by `scripts/qworkflow-parallel-smoke.ts` to verify parallel step fan-out.
 */
export const { POST } = serve<ParallelSmokePayload>(async (context) => {
  const items = context.requestPayload?.items ?? ['a', 'b', 'c'];

  const parallelResults = await Promise.all(
    items.map((id) =>
      context.run(`parallel:${id}`, async () => ({
        id,
        processedAt: new Date().toISOString(),
      })),
    ),
  );

  const summary = await context.run('after-parallel', async () => ({
    ids: parallelResults.map((item) => item.id),
    waveSize: parallelResults.length,
  }));

  return { ok: true, parallelResults, summary };
});
