import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';

import { withElectronProtocolIfElectron } from '@/const/protocol';
import { type AsyncRouter } from '@/server/routers/async';

export const asyncClient = createTRPCClient<AsyncRouter>({
  links: [
    httpBatchLink({
      headers: async () => {
        // dynamic import to avoid circular dependency
        const { getCanaryHeaders } = await import('@/services/_auth');

        return getCanaryHeaders();
      },
      maxURLLength: 2083,
      transformer: superjson,
      url: withElectronProtocolIfElectron('/trpc/async'),
    }),
  ],
});
