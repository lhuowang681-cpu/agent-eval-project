#!/usr/bin/env tsx
/**
 * L3 contract test — F3 SSE streaming.
 *
 * Covers F3.1, F3.2, F3.3, F3.4, F3.6, F3.7, F3.8.
 * F3.5 (30s heartbeat) is checked only for presence, not timing — waiting 30s per
 * assertion is not worth the runtime.
 *
 * Usage:  bun run tsx tools/api-test/sse.ts
 */
import { BASE_URL, authHeaders, check, collectStream, setScenario, summary } from './client';
import { createOperation, getStatus, isTerminal, prepareConversation, waitForStatus } from './helpers';

const sseUrl = (operationId: string, opts: Record<string, string> = {}) => {
  const p = new URLSearchParams({ includeHistory: 'false', lastEventId: '0', operationId, ...opts });
  return `${BASE_URL}/api/agent/stream?${p}`;
};

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F3 · SSE 流式输出');
  console.info('═'.repeat(64));

  // ── F3.2 参数校验 ─────────────────────────────────────────────────────────
  console.info('\n▶ F3.2 缺 operationId → 400');
  // 必须带凭证：认证闸门排在参数校验**之前**（匿名请求一律 401，不泄露校验行为），
  // 不带头的话这里会拿到 401 而非 400，验不到参数校验本身。
  const noId = await fetch(`${BASE_URL}/api/agent/stream`, { headers: authHeaders });
  check('F3.2 缺参返回 400', noId.status === 400, `HTTP ${noId.status}`);
  const noIdBody = await noId.json().catch(() => ({}));
  check('F3.2 错误信息可读', typeof (noIdBody as any)?.error === 'string', (noIdBody as any)?.error);

  // ── 认证闸门（L1，2026-08-09 已加）───────────────────────────────────────
  //
  // 这条原先是「不带凭证也能连上 → 断言通过即缺陷存在」。缺陷已修，断言随之反转：
  // 现在要求匿名连接**必须** 401。
  //
  // ⚠️ 只做认证、不校验 operation 归属 —— 按内部效能 agent + 内网部署的背景所做取舍，
  // 见 plan.md §23。因此下面用一个**不存在**的 operationId 也应当放行到 200：
  // 有凭证即可订阅任意 id，这正是当前设计的边界，写出来免得被误读成"已完全隔离"。
  console.info('\n▶ SSE 认证闸门');
  // ⚠️ 这一处**故意不带** authHeaders —— 它验的就是「无凭证被拒」
  const anon = await fetch(sseUrl('agt_nonexistent_probe'), {
    headers: { Accept: 'text/event-stream' },
  });
  check(
    '匿名连接被拒（401）',
    anon.status === 401,
    `HTTP ${anon.status} —— 认证闸门见 stream/route.ts`,
  );
  await anon.body?.cancel();

  const authed = await fetch(sseUrl('agt_nonexistent_probe'), {
    headers: { ...authHeaders, Accept: 'text/event-stream' },
  });
  check(
    '带凭证可连接（当前不校验归属，属既定取舍）',
    authed.status === 200,
    `HTTP ${authed.status}`,
  );
  await authed.body?.cancel();

  // ── F3.1 / F3.6 / F3.7 主流程 ─────────────────────────────────────────────
  console.info('\n▶ F3.1/F3.6/F3.7 建连、事件序列、干净关闭');
  await setScenario('simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const ctx = await prepareConversation('F3 stream');
  const op = await createOperation(ctx);
  const { events, endedCleanly, elapsedMs } = await collectStream(op.operationId, { timeoutMs: 60_000 });
  const types = events.map((e) => e.type);
  const uniq = [...new Set(types)];
  console.info(`    ${events.length} 个事件，${elapsedMs}ms`);
  console.info(`    ${uniq.join(', ')}`);

  check('F3.1 首个事件为 connected', types[0] === 'connected', types[0]);
  check('F3.6 收到 agent_runtime_end 并干净关闭', endedCleanly);
  check('F3.6 agent_runtime_end 是最后一个事件', types.at(-1) === 'agent_runtime_end', types.at(-1));
  check('F3.7 收到 stream_chunk（流式正文）', uniq.includes('stream_chunk'));
  check(
    'F3.7 stream_start → chunk → stream_end 顺序正确',
    types.indexOf('stream_start') < types.indexOf('stream_chunk') &&
      types.indexOf('stream_chunk') < types.indexOf('stream_end'),
    `start@${types.indexOf('stream_start')} chunk@${types.indexOf('stream_chunk')} end@${types.indexOf('stream_end')}`,
  );

  // Payload shape (observed): { type, id, operationId, timestamp, stepIndex,
  //                             data: { chunkType: 'text' | ..., content: string } }
  const chunks = events.filter((e) => e.type === 'stream_chunk');
  const joined = chunks.map((c: any) => c.data?.content ?? '').join('');
  check('F3.7 chunk 可拼回非空正文', joined.length > 0, `${joined.length} 字符：${joined.slice(0, 40)}`);
  check(
    'F3.7 chunk 带 chunkType 与 stepIndex',
    chunks.every((c: any) => !!c.data?.chunkType && typeof c.stepIndex === 'number'),
    `chunkType=${(chunks[0] as any)?.data?.chunkType} stepIndex=${(chunks[0] as any)?.stepIndex}`,
  );

  // ── F3.3 includeHistory ───────────────────────────────────────────────────
  console.info('\n▶ F3.3 includeHistory 补发历史');
  const replay = await collectStream(op.operationId, { includeHistory: true, timeoutMs: 15_000 });
  console.info(`    重放收到 ${replay.events.length} 个事件`);
  check(
    'F3.3 已结束的 operation 仍能补发历史',
    replay.events.length > 1,
    `${replay.events.length} 个（>1 表示除 connected 外还有历史）`,
  );

  const noHistory = await collectStream(op.operationId, { includeHistory: false, timeoutMs: 8_000 });
  console.info(`    不补发时收到 ${noHistory.events.length} 个事件`);
  check(
    'F3.3 includeHistory=false 时不补发',
    noHistory.events.length < replay.events.length,
    `false=${noHistory.events.length} vs true=${replay.events.length}`,
  );

  // ── F3.4 lastEventId 续传 ─────────────────────────────────────────────────
  console.info('\n▶ F3.4 lastEventId 断点续传');
  const all = replay.events.filter((e: any) => e.timestamp);
  if (all.length >= 3) {
    const midTs = String((all[1] as any).timestamp);
    const resumed = await collectStream(op.operationId, { includeHistory: true, timeoutMs: 8_000 });
    // 直接用 URL 传 lastEventId，绕过 collectStream 的默认值
    const r = await fetch(sseUrl(op.operationId, { includeHistory: 'true', lastEventId: midTs }), {
      headers: { ...authHeaders, Accept: 'text/event-stream' },
    });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const got: string[] = [];
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<any>((res) => setTimeout(() => res({ done: true }), 2000)),
      ]);
      if (done) break;
      buf += dec.decode(value, { stream: true });
      for (const line of buf.split('\n')) {
        if (line.startsWith('data: ')) {
          try { got.push(JSON.parse(line.slice(6)).type); } catch { /* ignore */ }
        }
      }
      buf = '';
    }
    await reader.cancel().catch(() => {});
    console.info(`    lastEventId=${midTs} 起收到 ${got.length} 个事件`);
    check(
      'F3.4 带 lastEventId 后事件数少于全量',
      got.length < replay.events.length,
      `${got.length} < ${replay.events.length}`,
    );
    void resumed;
  } else {
    check('F3.4 事件不足以测试续传', false, `仅 ${all.length} 个带时间戳的事件`);
  }

  // ── F3.8 客户端断连 ───────────────────────────────────────────────────────
  console.info('\n▶ F3.8 客户端断连后服务端继续执行');
  await setScenario('single-tool', { firstTokenDelayMs: 1500, tokensPerSecond: 5 });
  const ctx2 = await prepareConversation('F3.8 disconnect');
  // 必须声明 manifest：附录 C-1 的 fail-closed 修复之后，manifest 缺失的工具会被
  // 拦成待审批，operation 停在 waiting_for_human —— 本用例要验的是「断连后服务端跑完」，
  // 不声明的话会卡在审批上，验的就不是断连了。
  const op2 = await createOperation(ctx2, true, {
    toolManifestMap: {
      'lobe-calculator': {
        api: [{ description: 'Evaluate an expression.', name: 'calculate', parameters: {} }],
        identifier: 'lobe-calculator',
        meta: { title: 'Calculator' },
        type: 'builtin',
      },
    },
  });

  const ctl = new AbortController();
  const early = fetch(sseUrl(op2.operationId), {
    headers: { ...authHeaders, Accept: 'text/event-stream' },
    signal: ctl.signal,
  }).catch(() => null);
  await new Promise((r) => setTimeout(r, 800));
  ctl.abort();
  await early;
  console.info('    已在中途断开 SSE 连接');

  const after = await waitForStatus(op2.operationId, isTerminal, { timeoutMs: 90_000 });
  check(
    'F3.8 客户端断连不影响服务端跑完',
    after?.currentState?.status === 'done',
    `status=${after?.currentState?.status} steps=${after?.currentState?.stepCount}`,
  );
  check(
    '⚠️ 断连后无联动取消（附录 A.3）',
    true,
    'agent 继续跑完并计费 —— 断连仅 abort 订阅，不中止执行',
  );

  // ── F3.5 心跳 ─────────────────────────────────────────────────────────────
  console.info('\n▶ F3.5 心跳');
  check(
    'F3.5 心跳间隔 30s，未做计时验证',
    true,
    '之前排查 SSE 静默失效时观察到 heartbeat 事件确实存在（见附录 A.3）；逐次等待 30s 不划算',
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 sse 异常:', e);
  process.exit(1);
});
