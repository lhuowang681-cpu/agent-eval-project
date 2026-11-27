import { authEnv } from '@/envs/auth';

import { buildOidcConfig } from '../helpers';
import { type GenericProviderDefinition } from '../types';

const provider: GenericProviderDefinition<{
  AUTH_CTRIP_ID: string;
  AUTH_CTRIP_SECRET: string;
  AUTH_CTRIP_ISSUER: string;
}> = {
  build: (env) =>
    buildOidcConfig({
      clientId: env.AUTH_CTRIP_ID,
      clientSecret: env.AUTH_CTRIP_SECRET,
      issuer: env.AUTH_CTRIP_ISSUER,
      overrides: {
        mapProfileToUser: (profile) => ({
          email: profile.mail ?? profile.email,
          image: undefined,
          name: profile.displayName ?? profile.sn ?? profile.name ?? profile.email,
          username: profile.empCode ?? profile.employee ?? profile.eid,
        }),
      },
      providerId: 'ctrip',
    }),
  checkEnvs: () => {
    return !!(authEnv.AUTH_CTRIP_ID && authEnv.AUTH_CTRIP_SECRET && authEnv.AUTH_CTRIP_ISSUER)
      ? {
          AUTH_CTRIP_ID: authEnv.AUTH_CTRIP_ID,
          AUTH_CTRIP_ISSUER: authEnv.AUTH_CTRIP_ISSUER,
          AUTH_CTRIP_SECRET: authEnv.AUTH_CTRIP_SECRET,
        }
      : false;
  },
  id: 'ctrip',
  type: 'generic',
};

export default provider;
