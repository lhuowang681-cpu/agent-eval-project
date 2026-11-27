import debug from 'debug';

import { businessConfigEndpoints } from '@/business/server/lambda-routers/config';
import { getServerFeatureFlagsStateFromEdgeConfig } from '@/config/featureFlags';
import { publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerDefaultAgentConfig, getServerGlobalConfig } from '@/server/globalConfig';
import { mergeLobehubZtripIntoAiProviderConfig } from '@/server/services/ctripLobehubConfig';
import { type GlobalRuntimeConfig } from '@/types/serverConfig';
import { type ProviderConfig } from '@/types/user/settings';

const log = debug('config-router');

export const configRouter = router({
  getDefaultAgentConfig: publicProcedure.query(async () => {
    return getServerDefaultAgentConfig();
  }),

  getGlobalConfig: publicProcedure
    .use(serverDatabase)
    .query(async ({ ctx }): Promise<GlobalRuntimeConfig> => {
      log('[GlobalConfig] Starting global config retrieval for user:', ctx.userId || 'anonymous');

      const [serverConfigBase, serverFeatureFlags] = await Promise.all([
        getServerGlobalConfig(),
        getServerFeatureFlagsStateFromEdgeConfig(ctx.userId || undefined),
      ]);

      const serverConfig = {
        ...serverConfigBase,
        aiProvider: await mergeLobehubZtripIntoAiProviderConfig(
          ctx.serverDB,
          ctx.userId ?? null,
          serverConfigBase.aiProvider as Record<string, ProviderConfig>,
        ),
      };

      log('[GlobalConfig] Server config retrieved');
      log(
        '[GlobalConfig] Final feature flags to return (evaluated booleans only):',
        serverFeatureFlags,
      );

      const result = { serverConfig, serverFeatureFlags };
      log(
        '[GlobalConfig] Returning global config with feature flags keys:',
        Object.keys(serverFeatureFlags),
      );

      return result;
    }),

  ...businessConfigEndpoints,
});
