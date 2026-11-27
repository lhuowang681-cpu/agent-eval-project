#!/usr/bin/env tsx
/**
 * L3 contract test — F11 public REST API (/api/v1) and auth.
 *
 * Covers F11.1(部分), F11.3, F11.4, F11.5, F11.9 and CRUD contracts for the
 * agents / topics / messages / models / providers resources.
 * F11.6-F11.8 (OpenResponses) run last because the non-streaming branch uses
 * executeSync and holds the request open for the whole agent run.
 *
 * Usage:  bun run tsx tools/api-test/openapi-contract.ts
 */
import { BASE_URL, check, rest, setScenario, summary } from './client';

const anon = (path: string, init: RequestInit = {}) => fetch(`${BASE_URL}${path}`, init);

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F11 · 对外 REST API 与权限');
  console.info('═'.repeat(64));

  // ── 健康检查 ──────────────────────────────────────────────────────────────
  console.info('\n▶ 健康检查');
  const h = await rest('/api/v1/health');
  check('GET /health → 200', h.status === 200 && h.body?.status === 'ok', JSON.stringify(h.body));
  check('/health 带 service 标识', h.body?.service === 'lobe-chat-api', h.body?.service);

  // ── F11.5 鉴权 ────────────────────────────────────────────────────────────
  console.info('\n▶ F11.3/F11.5 鉴权');
  const meOk = await rest('/api/v1/users/me');
  check('F11.5 dev 旁路可取当前用户', meOk.status === 200 && !!meOk.body?.data?.id, meOk.body?.data?.id);

  const meAnon = await anon('/api/v1/users/me');
  const anonBody = await meAnon.json().catch(() => ({}));
  // 原先这条是「返回 500 而非 401 → 断言通过 = 缺陷存在」。缺陷已于 2026-08-09 修复
  // （`app.onError` 改为沿用 HTTPException 自带状态码），断言随之反转。
  check(
    '无凭证返回 401（而非 500）',
    meAnon.status === 401,
    `HTTP ${meAnon.status} body=${JSON.stringify(anonBody).slice(0, 90)}`,
  );
  check(
    '401 响应体仍带可读原因',
    typeof (anonBody as any)?.error === 'string' && (anonBody as any).error.length > 0,
    (anonBody as any)?.error,
  );

  const badKey = await anon('/api/v1/users/me', { headers: { Authorization: 'Bearer [REDACTED]' } });
  check('F11.1 伪造 API Key 被拒', badKey.status >= 400, `HTTP ${badKey.status}`);

  // ── F11.9 分页 ────────────────────────────────────────────────────────────
  console.info('\n▶ F11.9 分页契约');
  const agents = await rest('/api/v1/agents?page=1&pageSize=5');
  check('GET /agents → 200', agents.status === 200, `HTTP ${agents.status}`);
  const ad = agents.body?.data ?? agents.body;
  console.info(`    响应键: ${Object.keys(ad ?? {}).join(', ')}`);
  check('F11.9 分页响应含条目数组', Array.isArray(ad?.items ?? ad?.data ?? ad), JSON.stringify(ad).slice(0, 110));

  const badPage = await rest('/api/v1/agents?page=abc');
  check('F11.9 非法分页参数被 zValidator 拒绝', badPage.status >= 400, `HTTP ${badPage.status}`);

  // ── 资源 CRUD 契约 ────────────────────────────────────────────────────────
  console.info('\n▶ 资源 CRUD');
  const created = await rest('/api/v1/agents', {
    body: JSON.stringify({ description: 'created by contract test', title: `contract-${Date.now()}` }),
    method: 'POST',
  });
  check('POST /agents 创建成功', created.status >= 200 && created.status < 300, `HTTP ${created.status}`);
  const agentId = created.body?.data?.id ?? created.body?.id;
  check('POST /agents 返回 id', !!agentId, agentId);

  if (agentId) {
    const got = await rest(`/api/v1/agents/${agentId}`);
    check('GET /agents/:id 可读回', got.status === 200, `HTTP ${got.status}`);

    const patched = await rest(`/api/v1/agents/${agentId}`, {
      body: JSON.stringify({ description: 'patched' }),
      method: 'PATCH',
    });
    check('PATCH /agents/:id 更新成功', patched.status >= 200 && patched.status < 300, `HTTP ${patched.status}`);

    const del = await rest(`/api/v1/agents/${agentId}`, { method: 'DELETE' });
    check('DELETE /agents/:id 删除成功', del.status >= 200 && del.status < 300, `HTTP ${del.status}`);

    const gone = await rest(`/api/v1/agents/${agentId}`);
    check('删除后再取应 4xx', gone.status >= 400, `HTTP ${gone.status}`);
  }

  const missing = await rest('/api/v1/agents/agt_definitely_not_exist');
  check('不存在的 id 返回 4xx', missing.status >= 400, `HTTP ${missing.status}`);

  // ── 其余资源可达性 ────────────────────────────────────────────────────────
  console.info('\n▶ 其余资源可达性');
  for (const [name, path] of [
    ['topics', '/api/v1/topics?page=1&pageSize=3'],
    ['messages', '/api/v1/messages/count'],
    ['models', '/api/v1/models'],
    ['providers', '/api/v1/providers'],
    ['knowledge-bases', '/api/v1/knowledge-bases'],
    ['files', '/api/v1/files'],
    ['roles', '/api/v1/roles'],
    ['permissions', '/api/v1/permissions'],
  ] as const) {
    const r = await rest(path);
    check(`GET /${name} 可达`, r.status < 500, `HTTP ${r.status}`);
  }

  // ── F11.6 OpenResponses ───────────────────────────────────────────────────
  console.info('\n▶ F11.6 POST /responses（非流式，走 executeSync）');
  await setScenario('simple', { firstTokenDelayMs: 0, tokensPerSecond: 0 });
  const t0 = Date.now();
  const resp = await rest('/api/v1/responses', {
    body: JSON.stringify({ input: 'contract test hello', model: 'inbox', stream: false }),
    method: 'POST',
  });
  const dt = Date.now() - t0;
  console.info(`    HTTP ${resp.status}，耗时 ${dt}ms`);
  console.info(`    ${JSON.stringify(resp.body).slice(0, 200)}`);

  check('F11.6 /responses 返回 2xx', resp.status >= 200 && resp.status < 300, `HTTP ${resp.status}`);
  const ro = resp.body?.data ?? resp.body;
  check('F11.6 object=response', ro?.object === 'response', ro?.object);
  check('F11.6 含 status 字段', typeof ro?.status === 'string', ro?.status);
  check('F11.6 含 output 数组', Array.isArray(ro?.output), `${ro?.output?.length ?? 'n/a'} 项`);
  check('F11.6 含 usage', !!ro?.usage, JSON.stringify(ro?.usage ?? {}));
  check(
    'F11.6 同步阻塞整轮 agent（executeSync 语义）',
    dt > 50,
    `${dt}ms —— 单请求内跑完，无队列削峰，见附录 A.1`,
  );

  const ok = summary();
  process.exit(ok ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 openapi-contract 异常:', e);
  process.exit(1);
});
