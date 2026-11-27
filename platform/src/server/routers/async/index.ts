import { asyncRouter as router, publicProcedure } from '@/libs/trpc/async';

import { evalRouter } from './eval';
import { fileRouter } from './file';
import { imageRouter } from './image';
import { memoryRouter } from './memory';
import { ragEvalRouter } from './ragEval';

export const asyncRouter = router({
  eval: evalRouter,
  file: fileRouter,
  healthcheck: publicProcedure.query(() => "i'm live!"),
  image: imageRouter,
  memory: memoryRouter,
  ragEval: ragEvalRouter,
});

export type AsyncRouter = typeof asyncRouter;

export type { UnifiedAsyncCaller } from './caller';
export { createAsyncCaller, createAsyncServerClient } from './caller';
