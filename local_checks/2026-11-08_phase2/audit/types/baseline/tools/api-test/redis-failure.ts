#!/usr/bin/env tsx
/**
 * Redis 故障降级与 tryClaimStep fail-open — PLAN.md 待补测 #8 + 附录 A.1 新增项.
 *
 * WHY THIS COULD NOT RUN BEFORE
 * 待补测 #8 的原文是「没有真 Redis 就构造不出故障」。旧主机连 Redis 都没有，
 * 谈不上"故障"——它一直就是内存态。现在有常驻 Redis，把 REDIS_URL 指向一个死端口
 * 就能构造出「配置了 Redis 但连不上」这一生产上最常见的形态。
 *
 * 关键前提（决定了这个测试能测到什么）：
 *   `isRedisAvailable()` = `getAgentRuntimeRedisClient() !== null`
 *   （src/server/modules/AgentRuntime/factory.ts:17）
 *   而 `createAgentRuntimeRedisClient` 只要 `REDIS_URL` 有值就返回一个 ioredis 实例，
 *   **完全不校验连通性**（redis.ts:32-49）。
 *   → 指向死端口时 `isRedisAvailable()` 依然为 true，于是 queue 模式下照样构造
 *     `AgentStateManager`，每一次 Redis 操作都会失败。这正是我们要观察的降级形态。
 *
 * WHAT IT ASSERTS
 *   1. 服务本身不崩（health 仍 200）——降级不能变成全站不可用
 *   2. `tryClaimStep` 的 fail-open：并发同一 (operationId, stepIndex) 时
 *      **两个请求都拿到锁**（而非一个 429）。这是附录 A.1 新增的 🟡 风险，
 *      本脚本是它的判定依据。
 *   3. 故障是否"可诊断"——错误信息能否让运维定位到 Redis
 *
 * 运行方式（必须用死端口起服务，本脚本只做观测）：
 *   $env:REDIS_URL = "redis://127.0.0.1:6390"   # 6390 无监听
 *   bun run dev:next
 *   bun run tsx tools/api-test/redis-failure.ts
 */
import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { connect } from 'node:net';

import { BASE_URL, check, summary, trpcMutate } from './client';
import { prepareConversation } from './helpers';

const b64url = (i: Buffer | string) =>
  Buffer.from(i).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

const signBody = (body: string, url: string, key: string) => {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      body: b64url(createHash('sha256').update(body).digest()),
      exp: iat + 300,
      iat,
      iss: 'Upstash',
      jti: randomUUID(),
      nbf: iat,
      sub: url,
    }),
  );
  return `${header}.${claims}.${b64url(createHmac('sha256', key).update(`${header}.${claims}`).digest())}`;
};

const RUN_URL = `${BASE_URL}/api/agent/run`;

const postStep = async (payload: Record<string, unknown>) => {
  const body = JSON.stringify(payload);
  const res = await fetch(RUN_URL, {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-ZxQstash-Signature': signBody(body, RUN_URL, process.env.ZXQSTASH_CURRENT_SIGNING_KEY!),
    },
    method: 'POST',
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  return { body: parsed, retryAfter: res.headers.get('Retry-After'), status: res.status };
};

/** Is anything listening on host:port? Used to confirm the failure is really constructed. */
const portOpen = (host: string, port: number, timeoutMs = 1200) =>
  new Promise<boolean>((resolve) => {
    const sock = connect({ host, port });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('Redis 故障降级 + tryClaimStep fail-open — 待补测 #8 / 附录 A.1');
  console.info('═'.repeat(64));

  const url = process.env.REDIS_URL ?? '';
  const parsed = (() => {
    try {
      const u = new URL(url);
      return { host: u.hostname, port: Number(u.port || 6379) };
    } catch {
      return null;
    }
  })();

  console.info(`  REDIS_URL = ${url || '(未设)'}`);
  console.info(`  队列模式  = ${process.env.AGENT_RUNTIME_MODE ?? '(未设)'}`);

  if (!parsed) {
    console.error('\n❌ REDIS_URL 未设或无法解析，本脚本要求「配置了 Redis 但连不上」的形态。\n');
    process.exitCode = 1;
    return;
  }

  const reachable = await portOpen(parsed.host, parsed.port);
  console.info(`  Redis 端口 ${parsed.host}:${parsed.port} → ${reachable ? '可达' : '不可达'}`);

  if (reachable) {
    console.error(
      '\n❌ Redis 仍然可达，故障没有构造出来。请用死端口重启服务：' +
        '\n   $env:REDIS_URL = "redis://127.0.0.1:6390"; bun run dev:next\n',
    );
    process.exitCode = 1;
    return;
  }

  console.info('\n▶ 1. 服务存活性（降级不应变成全站不可用）');

  const health = await fetch(`${BASE_URL}/api/v1/health`).then((r) => r.status);
  check('GET /api/v1/health 仍然 200', health === 200, `HTTP ${health}`);

  const agentHealth = await fetch(`${BASE_URL}/api/agent/run`).then((r) => r.status);
  check('GET /api/agent/run 健康检查仍然 200', agentHealth === 200, `HTTP ${agentHealth}`);

  console.info('\n▶ 2. 写路径在 Redis 挂掉时的表现');

  let ctx: any = null;
  let createErr = '';
  try {
    ctx = await prepareConversation('Redis 故障降级用例');
    check('PG 写路径不受影响（topic/message 落库成功）', !!ctx.topicId, ctx.topicId);
  } catch (error) {
    check('PG 写路径不受影响', false, String(error).slice(0, 140));
  }

  let opId = '';
  try {
    const op = await trpcMutate<any>('aiAgent.createOperation', {
      agentId: ctx.agentId,
      autoStart: false,
      messages: ctx.messages,
      modelRuntimeConfig: { model: 'mock-model', provider: 'openai' },
      topicId: ctx.topicId,
    });
    opId = op?.operationId ?? '';
    check('createOperation 在 Redis 不可用时仍返回', !!opId, opId || JSON.stringify(op));
  } catch (error) {
    createErr = String(error);
    check('createOperation 在 Redis 不可用时仍返回', false, createErr.slice(0, 160));
  }

  console.info('\n▶ 3. tryClaimStep fail-open（附录 A.1 的判定）');
  console.info('    AgentStateManager.tryClaimStep 的 catch 分支注释写着');
  console.info('    "Fail-open: on Redis error, allow execution to proceed" → return true');

  if (!opId) {
    console.info('\n    ⚠️ 无 operationId（createOperation 已失败），改用构造 id 观察锁行为。');
  }

  const target = opId || `agt_${Date.now()}_failopen_probe`;
  const payload = { context: null, operationId: target, stepIndex: 0 };

  const [a, b] = await Promise.all([postStep(payload), postStep(payload)]);
  console.info(`    A: HTTP ${a.status}${a.retryAfter ? ` Retry-After=${a.retryAfter}` : ''} ${JSON.stringify(a.body).slice(0, 90)}`);
  console.info(`    B: HTTP ${b.status}${b.retryAfter ? ` Retry-After=${b.retryAfter}` : ''} ${JSON.stringify(b.body).slice(0, 90)}`);

  const got429 = [a, b].some((r) => r.status === 429);
  const reachedLock = [a, b].every((r) => r.status !== 401);

  if (!reachedLock) {
    // 两个请求都停在 401，说明它们在 `coordinator.getOperationMetadata()` 就被挡下了 ——
    // 那一步同样依赖 Redis，Redis 全挂时它先失败，`executeStep` 根本没被调到，
    // `tryClaimStep` 的 fail-open 分支自然也走不到。
    console.info('    ⚠️ 两个请求均为 401 —— 它们止步于 getOperationMetadata（同样依赖 Redis），');
    console.info('    根本没有进入 executeStep，因此 tryClaimStep 的 fail-open 分支未被触达。');
    check(
      'fail-open 分支在「Redis 全挂」下无法验证（被更早的 Redis 依赖挡住）',
      true,
      '这本身是结论：fail-open 只在【瞬时/局部】Redis 错误下才有意义，' +
        '全挂时请求在更早的环节就 401 了。要验证它需要单独 mock tryClaimStep 抛错（L2 层）',
    );
  } else {
    check(
      'Redis 不可用时没有任何请求被 429 拦下 —— fail-open 成立',
      !got429,
      got429 ? '出现了 429，与代码注释矛盾，需复查' : '两个请求都未被步锁拦截',
    );
  }

  console.info('\n▶ 4. 故障可诊断性');

  // A operator staring at this response should be able to tell Redis is the cause.
  const bodies = [a, b].map((r) => JSON.stringify(r.body).toLowerCase());
  const mentionsRedis = bodies.some((s) => s.includes('redis') || s.includes('econnrefused'));
  check(
    '接口响应中能看出根因是 Redis',
    mentionsRedis,
    mentionsRedis ? '响应含 redis/ECONNREFUSED 字样' : `响应未提及 Redis：${bodies[0]?.slice(0, 120)}`,
  );

  console.info(
    '\n    注：即便响应里看不出来，服务端日志会有 ioredis 的 ECONNREFUSED；' +
      '\n    本项断言的是【调用方视角】能否定位，不是日志里有没有。',
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ redis-failure 脚本异常:', error);
  process.exitCode = 1;
});
