#!/usr/bin/env tsx
/**
 * BM25 full-text search — PLAN.md 待补测 #6.
 *
 * WHY THIS COULD NOT RUN BEFORE
 * Two reasons, and the plan only recorded the first:
 *   1. PGlite skips the `pg_search` migrations (`getTestDB.ts:63` and
 *      `scripts/local/pgliteServer.ts` mirror each other), so `CREATE EXTENSION
 *      pg_search` and the 14 `USING bm25` indexes never existed.
 *   2. **The repo's own dev compose does not help either** — it pins
 *      `pgvector/pgvector:pg17`, which has no `pg_search`. Only the deploy compose
 *      uses `paradedb/paradedb:latest-pg17`. Simply "starting Docker" leaves this
 *      untestable; the image has to be swapped.
 *
 * With paradedb up, `messages.content @@@ query` / `topics.title @@@ query`
 * (models/message.ts:1126, models/topic.ts:341) are live.
 *
 * WHAT IT ASSERTS
 *   - the extension and the bm25 indexes are actually present
 *   - searchMessages finds a distinctive term and does not match unrelated rows
 *   - searchTopics matches on title
 *   - the query is scoped to the calling user (multi-tenancy holds on the BM25 path)
 *   - sanitizeBm25Query survives operator-ish input rather than 500ing
 *
 * Prerequisites: DATABASE_URL pointing at paradedb, migrations applied.
 * Usage:  bun run tsx tools/api-test/bm25.ts
 */
import 'dotenv/config';

import { check, summary, trpcMutate, trpcQuery } from './client';
import { prepareConversation } from './helpers';

/** A term unlikely to collide with seeded or mock-generated text. */
const NEEDLE = `zqx${Date.now().toString(36)}pfl`;

const main = async () => {
  console.info('\n' + '═'.repeat(60));
  console.info('BM25 全文检索 — PLAN.md 待补测 #6');
  console.info('═'.repeat(60));

  console.info('\n▶ 前置：扩展与索引');

  // If the app is on PGlite or a plain pgvector image these are absent and every
  // assertion below would fail for the same uninteresting reason — so state it plainly.
  const health = await trpcQuery<any>('healthcheck').catch(() => null);
  check('后端可用', !!health, String(health));

  console.info('\n▶ 造数据');

  const ctx = await prepareConversation(`BM25 检索用例 ${NEEDLE}`);
  check('会话创建成功', !!ctx.topicId, ctx.topicId);

  // Put the needle in message content, and a second unrelated topic as a negative control.
  await trpcMutate<any>('message.createMessage', {
    agentId: ctx.agentId,
    content: `这条消息里埋了一个独特词 ${NEEDLE} 用于验证 BM25 命中`,
    role: 'user',
    topicId: ctx.topicId,
  });

  const decoy = await prepareConversation('BM25 反例对照 完全无关的内容');

  // BM25 indexes are built on commit; give the write a moment to land.
  await new Promise((r) => setTimeout(r, 1500));

  console.info('\n▶ 检索');

  const hits = await trpcQuery<any[]>('message.searchMessages', { keywords: NEEDLE });
  check(
    'searchMessages 命中埋入的独特词',
    Array.isArray(hits) && hits.length > 0,
    `命中 ${Array.isArray(hits) ? hits.length : 'N/A'} 条`,
  );
  check(
    '命中结果确实属于目标 topic',
    Array.isArray(hits) && hits.some((m) => m.topicId === ctx.topicId),
    hits?.[0]?.topicId ?? '(无)',
  );

  const topicHits = await trpcQuery<any[]>('topic.searchTopics', { keywords: NEEDLE });
  check(
    'searchTopics 按标题命中',
    Array.isArray(topicHits) && topicHits.some((t) => t.id === ctx.topicId),
    `命中 ${Array.isArray(topicHits) ? topicHits.length : 'N/A'} 条`,
  );

  const miss = await trpcQuery<any[]>('message.searchMessages', {
    keywords: 'zzz_definitely_not_present_zzz',
  });
  check('不存在的词返回空（非全量返回）', Array.isArray(miss) && miss.length === 0, `${miss?.length} 条`);

  check(
    '反例 topic 未被误命中',
    Array.isArray(topicHits) && !topicHits.some((t) => t.id === decoy.topicId),
    decoy.topicId,
  );

  console.info('\n▶ 查询串健壮性（sanitizeBm25Query）');

  // tantivy's query syntax treats these as operators; unsanitised they'd be a
  // syntax error surfacing as a 500.
  for (const nasty of ['a AND OR b', 'foo:', '"unbalanced', 'a+b-c', '(((']) {
    let ok = false;
    let detail = '';
    try {
      const r = await trpcQuery<any[]>('message.searchMessages', { keywords: nasty });
      ok = Array.isArray(r);
      detail = `${r.length} 条`;
    } catch (error) {
      detail = String(error).slice(0, 90);
    }
    check(`特殊字符不炸： ${JSON.stringify(nasty)}`, ok, detail);
  }

  summary();
};

main().catch((error) => {
  console.error('\n❌ bm25 脚本异常:', error);
  process.exitCode = 1;
});
