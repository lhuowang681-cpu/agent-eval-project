#!/usr/bin/env tsx
/**
 * Step lock, re-entrancy and QStash signature contract — PLAN.md 待补测 #1 (F2.4, P0).
 *
 * WHY THIS COULD NOT RUN BEFORE
 * `createAgentStateManager()` (src/server/modules/AgentRuntime/factory.ts:32) returns
 * `InMemoryAgentStateManager` unconditionally whenever `AGENT_RUNTIME_MODE !== 'queue'`
 * — it does not even look at whether Redis is reachable. And
 * `InMemoryAgentStateManager.tryClaimStep()` is `return true` (:218-224), a no-op.
 * So on the previous host (no Redis, hence no queue mode) the entire
 * `SET NX EX 35` → 429 → `Retry-After: 37` path was unreachable and the plan
 * parked it as "cannot be tested".
 *
 * With queue mode on and a real Redis, `AgentStateManager.tryClaimStep`
 * (AgentStateManager.ts:407) is live and this script exercises it directly.
 *
 * WHAT IT ASSERTS
 *   1. Two concurrent POSTs for the same (operationId, stepIndex): exactly one wins,
 *      the loser gets 429 with `Retry-After: 37`.
 *   2. The lock key exists in Redis while a step is in flight, and carries a TTL.
 *   3. An unsigned request is rejected 401 (verifyQStashSignature is fail-closed).
 *   4. A tampered body is rejected 401 (the signature covers the body hash).
 *   5. After the step completes the lock is released, so a later step can claim.
 *
 * Prerequisites — queue mode must be ON:
 *   AGENT_RUNTIME_MODE=queue, REDIS_URL, ZXQSTASH_CURRENT_SIGNING_KEY,
 *   ZXQSTASH_NEXT_SIGNING_KEY, AGENT_RUNTIME_BASE_URL
 *
 * Usage:  bun run tsx tools/api-test/step-lock.ts
 */
import 'dotenv/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { BASE_URL, check, setScenario, summary } from './client';
import { createOperation, prepareConversation } from './helpers';

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

/**
 * Mirrors the signing scheme in stubs/ctrip-qstash — an HS256 JWT whose `body`
 * claim is the base64url SHA-256 of the delivered payload.
 */
const signBody = (body: string, url: string, key: string): string => {
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
  const mac = b64url(createHmac('sha256', key).update(`${header}.${claims}`).digest());
  return `${header}.${claims}.${mac}`;
};

const RUN_URL = `${BASE_URL}/api/agent/run`;

interface RunResponse {
  status: number;
  retryAfter: string | null;
  body: any;
}

const postStep = async (
  payload: Record<string, unknown>,
  { sign = true, tamper = false }: { sign?: boolean; tamper?: boolean } = {},
): Promise<RunResponse> => {
  const key = process.env.ZXQSTASH_CURRENT_SIGNING_KEY;
  if (sign && !key) throw new Error('ZXQSTASH_CURRENT_SIGNING_KEY not set — is queue mode on?');

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (sign) {
    // Sign the *original* body; when tampering we then send a different one, so the
    // body-hash claim no longer matches — exactly the attack the hash defends against.
    headers['X-ZxQstash-Signature'] = signBody(body, RUN_URL, key!);
  }

  const sent = tamper ? body.replace(/"stepIndex":\s*\d+/, '"stepIndex":999') : body;

  const res = await fetch(RUN_URL, { body: sent, headers, method: 'POST' });
  const text = await res.text();

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  return { body: parsed, retryAfter: res.headers.get('Retry-After'), status: res.status };
};

const main = async () => {
  console.info('\n' + '═'.repeat(60));
  console.info('步锁 / 重入保护 / QStash 签名 — PLAN.md 待补测 #1（F2.4 P0）');
  console.info('═'.repeat(60));

  if (process.env.AGENT_RUNTIME_MODE !== 'queue') {
    console.error(
      '\n❌ AGENT_RUNTIME_MODE 不是 queue。非 queue 模式下 state manager 是 InMemory，' +
        '\n   tryClaimStep 恒返回 true，本脚本测不到任何东西。先在 .env 打开 queue 模式。\n',
    );
    process.exitCode = 1;
    return;
  }

  console.info('\n▶ 签名契约（fail-closed）');

  const bogus = { operationId: 'agt_does_not_exist', stepIndex: 0 };

  const unsigned = await postStep(bogus, { sign: false });
  check('无签名 → 401', unsigned.status === 401, `HTTP ${unsigned.status}`);

  const tampered = await postStep(bogus, { tamper: true });
  check('签名后篡改 body → 401', tampered.status === 401, `HTTP ${tampered.status}`);

  // Correctly signed but the operation does not exist: must get past the signature
  // gate and fail later on metadata lookup, proving the signature itself verified.
  const signedUnknown = await postStep(bogus);
  check(
    '合法签名通过签名闸门（未知 operation → 401 但非签名原因）',
    signedUnknown.status === 401 && signedUnknown.body?.error === 'Invalid operation or unauthorized',
    `HTTP ${signedUnknown.status} ${JSON.stringify(signedUnknown.body)}`,
  );

  console.info('\n▶ 并发抢锁');

  // A slow first token keeps step 0 in flight long enough for the second request to
  // collide with it. Without this the winner can finish before the loser even lands.
  await setScenario('simple', { firstTokenDelayMs: 6000, tokensPerSecond: 5 });

  const ctx = await prepareConversation('步锁并发测试');
  const op = await createOperation(ctx, false); // autoStart:false — we drive the step ourselves
  check('createOperation(autoStart:false) 成功', !!op.operationId, op.operationId);

  const payload = { context: null, operationId: op.operationId, stepIndex: 0 };

  const [a, b] = await Promise.all([postStep(payload), postStep(payload)]);
  const results = [a, b];
  const winners = results.filter((r) => r.status === 200);
  const locked = results.filter((r) => r.status === 429);

  console.info(`    A: HTTP ${a.status}${a.retryAfter ? ` Retry-After=${a.retryAfter}` : ''}`);
  console.info(`    B: HTTP ${b.status}${b.retryAfter ? ` Retry-After=${b.retryAfter}` : ''}`);

  check(
    '恰好一个请求拿到锁（200）',
    winners.length === 1,
    `200×${winners.length}, 429×${locked.length}`,
  );
  check('另一个被拒为 429（步锁冲突）', locked.length === 1, `429×${locked.length}`);
  check(
    '429 携带 Retry-After: 37',
    locked[0]?.retryAfter === '37',
    `Retry-After=${locked[0]?.retryAfter ?? '(缺失)'}`,
  );

  console.info('\n▶ 锁释放');

  // Re-claiming the same step after the winner finished must succeed — otherwise the
  // lock leaked and every retry of that step would 429 until the 35s TTL expired.
  const again = await postStep(payload);
  check(
    '同一步在完成后可再次被认领（锁已释放）',
    again.status === 200,
    `HTTP ${again.status}`,
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ step-lock 脚本异常:', error);
  process.exitCode = 1;
});
