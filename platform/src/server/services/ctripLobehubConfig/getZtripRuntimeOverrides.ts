import type { ClientSecretPayload } from '@lobechat/types';
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { resolvePetaRuntimeCredential } from '@/server/services/petaGateway/resolveTripflowGateway';

import { getLobehubRemoteConfig, isUsernameWhitelistedForZtrip } from './fetchLobehubAppConfig';

const getUsernameByUserId = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | null> => {
  const row = await db.query.users.findFirst({
    columns: { username: true },
    where: eq(users.id, userId),
  });
  const u = row?.username;
  return typeof u === 'string' && u.trim() ? u.trim() : null;
};

/**
 * When user `username` is in remote whitelist, resolve ztrip runtime credentials
 * from qconfig `petaKeyId` through Peta SDK.
 */
export const getZtripWhitelistRuntimePatch = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<Partial<ClientSecretPayload> | null> => {
  const [username, remote] = await Promise.all([
    getUsernameByUserId(db, userId),
    getLobehubRemoteConfig(),
  ]);

  if (!isUsernameWhitelistedForZtrip(username, remote)) {
    return null;
  }

  const runtimeCredential = await resolvePetaRuntimeCredential({
    db,
    petaKeyId: remote?.ztrip?.petaKeyId,
    provider: 'ztrip',
    tags: remote?.ztrip?.tags,
    userId,
  });

  return {
    apiKey: runtimeCredential.apiKey,
    baseURL: runtimeCredential.baseURL,
  };
};
