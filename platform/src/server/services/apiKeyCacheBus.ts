import { invalidateApiKeyCache } from '@lobechat/openapi';
import debug from 'debug';
import Redis from 'ioredis';

import { redisEnv } from '@/envs/redis';
import { isRedisDisabledByEnv } from '@/libs/redis';

const log = debug('lobe-server:api-key-cache-bus');

/**
 * API Key 缓存的跨实例失效总线。
 *
 * 问题：`packages/openapi` 里的 key 校验缓存是**进程内 `Map`**。多实例部署下
 * （本项目跑 queue 模式），在实例 A 上吊销一个 key，实例 B 的缓存不受影响 ——
 * 该 key 在 B 上会继续有效直到 TTL 过期。
 *
 * 方案：吊销时往 Redis 频道发一条消息，各实例订阅后清掉本地缓存。
 *
 * 关键设计取舍 —— **Redis 不在鉴权热路径上**：
 *   · 命中路径仍是纯内存读，零额外延迟；
 *   · Redis 挂掉时不影响鉴权可用性，只是退化回 TTL 兜底（60 秒）；
 *   · 对比「每次请求查 Redis 黑名单」的方案：那会把 Redis 变成鉴权的强依赖，
 *     Redis 一抖整个 API 面跟着挂 —— 拿可用性换一个很少发生的时效性，不划算。
 *
 * 所以 TTL 与广播是**两层互补**，不是二选一：TTL 保下限，广播优化常态。
 */

const CHANNEL = 'lobe:api-key-cache:invalidate';

type InvalidateMessage = { apiKey?: string; all?: boolean };

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let initialized = false;

/**
 * 发布端与订阅端对离线队列的需求**相反**，必须分开设置：
 *
 * · 发布：`enableOfflineQueue: false` —— 广播是尽力而为的优化，
 *   连不上就该立刻失败并退回 TTL 兜底，而不是把消息堆在队列里等。
 * · 订阅：**必须开**离线队列。`subscribe()` 是在 `new Redis()` 之后**同步**调用的，
 *   此时 socket 还没连上；关掉离线队列会让这条命令直接抛
 *   `Stream isn't writeable and enableOfflineQueue options is false`，
 *   结果订阅根本没建立（实测踩过）。开着它，命令会排队到连接就绪后执行。
 */
const createClient = (role: 'publisher' | 'subscriber'): Redis | null => {
  if (isRedisDisabledByEnv()) return null;
  const url = redisEnv.REDIS_URL;
  if (!url) return null;

  return new Redis(url, {
    enableOfflineQueue: role === 'subscriber',
    maxRetriesPerRequest: role === 'publisher' ? 1 : null,
  });
};

/**
 * 订阅失效消息。应在进程启动时调用一次（`src/instrumentation.node.ts`）。
 * 未配置 Redis 时静默跳过 —— 单实例部署本来就不需要广播。
 */
export const initApiKeyCacheBus = (): void => {
  if (initialized) return;
  initialized = true;

  subscriber = createClient('subscriber');
  if (!subscriber) {
    log('Redis not configured — API key cache invalidation falls back to TTL only');
    return;
  }

  subscriber.on('error', (error) => {
    // 不抛：广播不可用只意味着退回 TTL 兜底，不应影响进程
    log('subscriber error (degrading to TTL-only invalidation): %O', error);
  });

  subscriber.subscribe(CHANNEL, (error) => {
    if (error) {
      log('failed to subscribe %s: %O', CHANNEL, error);
      return;
    }
    log('subscribed to %s', CHANNEL);
  });

  subscriber.on('message', (channel, raw) => {
    if (channel !== CHANNEL) return;
    try {
      const msg = JSON.parse(raw) as InvalidateMessage;
      invalidateApiKeyCache(msg.all ? undefined : msg.apiKey);
    } catch (error) {
      log('malformed invalidation message: %O', error);
    }
  });
};

/**
 * 广播一次失效。
 *
 * 本地缓存**先清再广播** —— 这样即使 Redis 不可用，发起吊销的那个实例也一定是即时生效的。
 */
export const publishApiKeyInvalidation = async (message: InvalidateMessage): Promise<void> => {
  invalidateApiKeyCache(message.all ? undefined : message.apiKey);

  publisher ??= createClient('publisher');
  if (!publisher) return;

  try {
    await publisher.publish(CHANNEL, JSON.stringify(message));
    log('published invalidation: %j', message);
  } catch (error) {
    // 广播失败只是回到 TTL 兜底，不该让吊销操作本身失败
    log('failed to publish invalidation (other instances will expire via TTL): %O', error);
  }
};
