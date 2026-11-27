import debug from 'debug';
import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';

import { getServerDB } from '@/database/core/db-adaptor';
import { ApiKeyModel } from '@/database/models/apiKey';
import { authEnv } from '@/envs/auth';
import { validateOIDCJWT } from '@/libs/oidc-provider/jwt';
import { validateApiKeyFormat } from '@/utils/apiKey';
import { extractBearerToken } from '@/utils/server/auth';

// Create context logger namespace
const log = debug('lobe-hono:auth-middleware');

// API Key cache configuration
/**
 * API Key 校验结果的本地缓存时长。
 *
 * 从 5 分钟下调到 60 秒：这是吊销延迟的**地板** —— 无论失效广播是否可用，
 * 一个已被吊销的 key 最多再工作这么久。
 *
 * 为什么不靠广播就够：广播（见下方 `invalidateApiKeyCache`）只在正常情况下生效，
 * Redis 抖动或实例刚重连时会漏掉消息，那时唯一兜底就是这个 TTL。
 * 只做广播的话，Redis 一挂就悄悄退回到旧的长延迟，而没人会注意到。
 *
 * 代价：命中率下降带来的额外数据库查询。key 校验是按 token 缓存的点查，
 * 60 秒粒度下的增量可以接受。
 */
const API_KEY_CACHE_TTL = 60 * 1000;

interface ApiKeyCacheEntry {
  apiKeyId: string;
  apiKeyName: string;
  expiresAt: Date | null;
  timestamp: number;
  userId: string;
}

// In-memory cache for API Key validation results
const apiKeyCache = new Map<string, ApiKeyCacheEntry>();

/**
 * Clean up expired cache entries periodically
 */
const cleanupApiKeyCache = () => {
  const now = Date.now();
  for (const [key, entry] of apiKeyCache.entries()) {
    if (now - entry.timestamp > API_KEY_CACHE_TTL) {
      apiKeyCache.delete(key);
      log('Removed expired API Key from cache: %s', key.slice(0, 10) + '...');
    }
  }
};

// Run cache cleanup every 10 minutes
setInterval(cleanupApiKeyCache, 10 * 60 * 1000);

/**
 * 主动失效本进程内的 API Key 缓存。
 *
 * ⚠️ 只清**本进程**。缓存是进程内 `Map`，多实例部署下在实例 A 上吊销
 * 清不掉实例 B 的缓存 —— 跨实例失效由应用侧的 Redis 发布订阅驱动，
 * 由它在每个实例上调用本函数（见 `src/server/services/apiKeyCacheBus.ts`）。
 *
 * 依赖方向是刻意的：本包**不** import 应用侧代码（那会构成反向依赖，
 * 见 `tests/architecture/packageReverseDeps.test.ts`），只暴露这个入口，
 * 由应用侧接线。Redis 因此也不出现在鉴权热路径上 —— 命中仍是纯内存读，
 * Redis 挂掉只会退化回 TTL 兜底，不影响鉴权可用性。
 *
 * @param apiKey 指定则只清该 key；省略则清空全部（用于「删除全部 key」）
 */
export const invalidateApiKeyCache = (apiKey?: string): void => {
  if (apiKey) {
    apiKeyCache.delete(apiKey);
    log('Invalidated API Key cache entry: %s...', apiKey.slice(0, 10));
    return;
  }
  apiKeyCache.clear();
  log('Cleared entire API Key cache');
};

/**
 * Standard Hono authentication middleware
 * Supports both OIDC tokens and API keys via Bearer token
 */
export const userAuthMiddleware = async (c: Context, next: Next) => {
  // Development mode debug bypass
  const isDebugApi = c.req.header('lobe-auth-dev-backend-api') === '1';
  if (process.env.NODE_ENV === 'development' && isDebugApi) {
    log('Development debug mode, using mock user ID');
    c.set('userId', process.env.MOCK_DEV_USER_ID);
    c.set('authType', 'debug');
    return next();
  }

  log('Processing authentication for request: %s %s', c.req.method, c.req.url);

  // Get Authorization header (standard Bearer token)
  const authorizationHeader = c.req.header('Authorization');
  const bearerToken = extractBearerToken(authorizationHeader);

  let userId: string | null = null;
  let authType: string | null = null;
  let authData: any = null;

  // Try Bearer token authentication - check format first to determine type
  if (bearerToken) {
    log('Bearer token received: %s...', bearerToken.slice(0, 10));

    // Check if bearerToken matches API Key format (sk-lh-{16 alphanumeric chars})
    const isApiKeyFormat = validateApiKeyFormat(bearerToken);
    log('API Key format validation result: %s', isApiKeyFormat);

    if (isApiKeyFormat) {
      // Try API Key authentication
      log('Bearer token matches API Key format, attempting API Key authentication');

      // Check cache first
      const cachedEntry = apiKeyCache.get(bearerToken);
      const now = Date.now();

      if (cachedEntry && now - cachedEntry.timestamp < API_KEY_CACHE_TTL) {
        // Check if cached API Key is expired
        const isExpired = cachedEntry.expiresAt && new Date() > new Date(cachedEntry.expiresAt);

        if (!isExpired) {
          userId = cachedEntry.userId;
          authType = 'apikey';
          authData = { apiKeyId: cachedEntry.apiKeyId, apiKeyName: cachedEntry.apiKeyName };

          log(
            'API Key authentication successful (from cache), userId: %s, apiKeyId: %d',
            userId,
            cachedEntry.apiKeyId,
          );
        } else {
          log('Cached API Key is expired, removing from cache');
          apiKeyCache.delete(bearerToken);
        }
      } else {
        // Cache miss or expired, query database
        log('API Key cache miss, querying database');

        try {
          // Get database instance
          const db = await getServerDB();
          log('Database connection established');

          // Find API Key in database
          const apiKeyModel = new ApiKeyModel(db, ''); // userId is not needed for findByKey
          log('Searching for API Key in database...');
          const apiKeyRecord = await apiKeyModel.findByKey(bearerToken);

          log('API Key database query result: %s', apiKeyRecord ? 'found' : 'not found');

          if (apiKeyRecord) {
            log(
              'API Key record - enabled: %s, userId: %s, expiresAt: %s',
              apiKeyRecord.enabled,
              apiKeyRecord.userId,
              apiKeyRecord.expiresAt,
            );
            // Validate API Key is enabled and not expired
            if (apiKeyRecord.enabled) {
              const isExpired =
                apiKeyRecord.expiresAt && new Date() > new Date(apiKeyRecord.expiresAt);

              if (!isExpired) {
                userId = apiKeyRecord.userId;
                authType = 'apikey';
                authData = { apiKeyId: apiKeyRecord.id, apiKeyName: apiKeyRecord.name };

                // Cache the validated API Key
                apiKeyCache.set(bearerToken, {
                  apiKeyId: apiKeyRecord.id,
                  apiKeyName: apiKeyRecord.name,
                  expiresAt: apiKeyRecord.expiresAt,
                  timestamp: now,
                  userId: apiKeyRecord.userId,
                });

                log(
                  'API Key authentication successful, userId: %s, apiKeyId: %d (cached)',
                  userId,
                  apiKeyRecord.id,
                );

                // Update last used timestamp (fire and forget)
                const userApiKeyModel = new ApiKeyModel(db, apiKeyRecord.userId);
                userApiKeyModel.updateLastUsed(apiKeyRecord.id).catch((err) => {
                  log('Failed to update API Key last used timestamp: %O', err);
                });
              } else {
                log('API Key is expired');
              }
            } else {
              log('API Key is disabled');
            }
          } else {
            log('API Key not found in database');
          }
        } catch (error) {
          log('API Key authentication failed: %O', error);
        }
      }
    } else if (authEnv.ENABLE_OIDC) {
      // Try OIDC authentication
      log('Bearer token does not match API Key format, attempting OIDC authentication');

      try {
        // Use direct JWT validation instead of OIDCService
        const tokenInfo = await validateOIDCJWT(bearerToken);

        userId = tokenInfo.userId;
        authType = 'oidc';
        authData = tokenInfo.tokenData;

        log('OIDC authentication successful, userId: %s', userId);
      } catch (error) {
        log('OIDC authentication failed: %O', error);
      }
    } else {
      log('Bearer token provided but does not match API Key format and OIDC is not enabled');
    }
  }

  // Set authentication context in Hono context
  if (userId) {
    c.set('userId', userId);
    c.set('authType', authType);
    c.set('authData', authData);
    c.set('authorizationHeader', authorizationHeader);

    log('Authentication successful - userId: %s, authType: %s', userId, authType);
  } else {
    log('Authentication failed - no valid credentials found');
    // Don't throw error here, let individual routes decide if auth is required
    c.set('userId', null);
    c.set('authType', null);
  }

  await next();
};

/**
 * Helper middleware to require authentication
 * Throws 401 error if user is not authenticated
 */
export const requireAuth = async (c: Context, next: Next) => {
  const userId = c.get('userId');

  if (!userId) {
    log('Authentication required but user not authenticated');
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  return next();
};
