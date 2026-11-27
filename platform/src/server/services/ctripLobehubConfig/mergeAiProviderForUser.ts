import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { type ProviderConfig } from '@/types/user/settings';

import {
  getLobehubRemoteConfig,
  isUsernameWhitelistedForZtrip,
  remoteZtripModelsAsServerList,
} from './fetchLobehubAppConfig';

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

const ztripDisabled = (base: Record<string, ProviderConfig>): Record<string, ProviderConfig> => ({
  ...base,
  ztrip: {
    ...base.ztrip,
    enabled: false,
  },
});

/**
 * Ztrip 仅对白名单用户可见（`users.username` 命中远程 `whitelist`）。
 * 未登录、非白名单：强制 `ztrip.enabled = false`，与全局 `ENABLED_ZTRIP` 无关。
 * 白名单：启用并合并远程 `ztrip.models` → `serverModelLists`。
 */
export const mergeLobehubZtripIntoAiProviderConfig = async (
  db: LobeChatDatabase | null,
  userId: string | null,
  base: Record<string, ProviderConfig>,
): Promise<Record<string, ProviderConfig>> => {
  if (!userId || !db) {
    return ztripDisabled(base);
  }

  const [username, remote] = await Promise.all([
    getUsernameByUserId(db, userId),
    getLobehubRemoteConfig(),
  ]);

  if (!isUsernameWhitelistedForZtrip(username, remote)) {
    return ztripDisabled(base);
  }

  const serverModelLists = remoteZtripModelsAsServerList(remote);
  const ztrip: ProviderConfig = {
    ...base.ztrip,
    enabled: true,
    ...(serverModelLists ? { serverModelLists } : {}),
  };

  return {
    ...base,
    ztrip,
  };
};
