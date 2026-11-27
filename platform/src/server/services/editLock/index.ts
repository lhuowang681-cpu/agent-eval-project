import debug from 'debug';

import { getRedisConfig } from '@/envs/redis';
import type { BaseRedisProvider } from '@/libs/redis';
import { initializeRedis, RedisKeys } from '@/libs/redis';

const log = debug('lobe-server:edit-lock');

/** Lease lifetime in seconds; clients heartbeat well within this to keep it alive. */
export const EDIT_LOCK_TTL_SECONDS = 30;

/** Editable resource families that can take a collaborative edit lock. */
export type EditLockResourceType = 'agent' | 'chatGroup' | 'document' | 'task';

export interface EditLockResult {
  expiresAt: Date | null;
  holderId: string | null;
  lockedByOther: boolean;
  ownerId: string | null;
}

export interface ActiveEditLock {
  expiresAt: Date | null;
  ownerId: string | null;
  userId: string;
}

const UNLOCKED: EditLockResult = {
  expiresAt: null,
  holderId: null,
  lockedByOther: false,
  ownerId: null,
};

const RELEASE_SCRIPT = `
local raw = redis.call('get', KEYS[1])
if not raw then
  return 0
end
if raw == ARGV[2] then
  return redis.call('del', KEYS[1])
end
local ok, decoded = pcall(cjson.decode, raw)
if ok and decoded["userId"] == ARGV[2] and decoded["ownerId"] == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const parseStoredLock = (raw: string): ActiveEditLock => {
  try {
    const parsed = JSON.parse(raw) as {
      expiresAt?: unknown;
      ownerId?: unknown;
      userId?: unknown;
    };

    if (typeof parsed.userId === 'string') {
      const expiresAt = typeof parsed.expiresAt === 'string' ? new Date(parsed.expiresAt) : null;

      return {
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : null,
        userId: parsed.userId,
      };
    }
  } catch {
    // Legacy deployments may have stored a raw user id. Treat it as a lock.
  }

  return { expiresAt: null, ownerId: null, userId: raw };
};

/**
 * Redis-backed collaborative edit lock, keyed by (resourceType, resourceId).
 *
 * The lock is advisory and fail-open: Redis outages should never block editing
 * or saving. Keys expire automatically, so no DB schema or cleanup job is needed.
 */
export class EditLockService {
  private redisPromise?: Promise<BaseRedisProvider | null>;

  constructor(
    private readonly userId: string,
    private readonly explicitRedis?: BaseRedisProvider | null,
  ) {}

  async acquire(
    type: EditLockResourceType,
    id: string,
    ownerId = this.userId,
  ): Promise<EditLockResult> {
    const redis = await this.getRedis();
    if (!redis) return UNLOCKED;

    const key = RedisKeys.lobechat.editLock(type, id);

    try {
      const nextLock = this.serialize(ownerId);
      const claimed = await redis.set(key, nextLock, { ex: EDIT_LOCK_TTL_SECONDS, nx: true });
      if (claimed) return this.held(ownerId);

      const raw = await redis.get(key);
      if (raw) {
        const holder = parseStoredLock(raw);

        if (holder.userId === this.userId) {
          await redis.set(key, nextLock, { ex: EDIT_LOCK_TTL_SECONDS });
          return this.held(ownerId);
        }

        return {
          expiresAt: holder.expiresAt,
          holderId: holder.userId,
          lockedByOther: true,
          ownerId: holder.ownerId,
        };
      }

      const reclaimed = await redis.set(key, nextLock, { ex: EDIT_LOCK_TTL_SECONDS, nx: true });
      return reclaimed ? this.held(ownerId) : UNLOCKED;
    } catch (error) {
      log('acquire failed for %s:%s %O', type, id, error);
      return UNLOCKED;
    }
  }

  async getActiveHolder(type: EditLockResourceType, id: string): Promise<string | undefined> {
    return (await this.getActiveLock(type, id))?.userId;
  }

  async getActiveLock(type: EditLockResourceType, id: string): Promise<ActiveEditLock | undefined> {
    const redis = await this.getRedis();
    if (!redis) return undefined;

    try {
      const holder = await redis.get(RedisKeys.lobechat.editLock(type, id));
      return holder ? parseStoredLock(holder) : undefined;
    } catch (error) {
      log('getActiveLock failed for %s:%s %O', type, id, error);
      return undefined;
    }
  }

  async getBlockingHolder(
    type: EditLockResourceType,
    id: string,
    ownerId?: string,
  ): Promise<string | null> {
    const holder = await this.getActiveLock(type, id);
    if (!holder) return null;
    if (holder.userId !== this.userId) return holder.userId;
    if (!ownerId) return null;
    if (holder.ownerId && holder.ownerId !== ownerId) return holder.userId;

    return null;
  }

  async release(type: EditLockResourceType, id: string, ownerId = this.userId): Promise<boolean> {
    const redis = await this.getRedis();
    if (!redis) return false;

    try {
      const deleted = await redis.eval<number>(
        RELEASE_SCRIPT,
        1,
        RedisKeys.lobechat.editLock(type, id),
        ownerId,
        this.userId,
      );
      return deleted === 1;
    } catch (error) {
      log('release failed for %s:%s %O', type, id, error);
      return false;
    }
  }

  private async getRedis(): Promise<BaseRedisProvider | null> {
    if (this.explicitRedis !== undefined) return this.explicitRedis;
    this.redisPromise ??= initializeRedis(getRedisConfig()).catch((error) => {
      log('redis initialization failed %O', error);
      return null;
    });

    return this.redisPromise;
  }

  private held(ownerId: string): EditLockResult {
    return {
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_SECONDS * 1000),
      holderId: this.userId,
      lockedByOther: false,
      ownerId,
    };
  }

  private serialize(ownerId: string): string {
    return JSON.stringify({
      expiresAt: new Date(Date.now() + EDIT_LOCK_TTL_SECONDS * 1000).toISOString(),
      ownerId,
      userId: this.userId,
    });
  }
}
