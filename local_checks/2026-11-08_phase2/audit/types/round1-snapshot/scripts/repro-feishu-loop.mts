/* eslint-disable */
/**
 * Playwright 复现脚本：feishu update-doc 空 markdown 死循环
 *
 * 机制：
 *  - mock /webapi/chat/* 的 SSE：每轮都吐一条 tool_calls，调用 update-doc 且不带 markdown
 *    （arguments 每次完全相同），模拟模型反复发起同一个失败调用
 *  - mock TRPC mcp.callTool：每次回 {"error":"[VALIDATION:1002] Markdown content cannot be empty"}
 *
 * 旧代码：triggerAIMessage 无熔断 → 无限重试（脚本检测到 ≥5 次相同失败调用 = 已复现）
 * 新代码：连续 3 次相同失败即熔断 → 出现 stopRepeatedToolCalls 提示且调用数 ≤3
 *
 * 用法：bunx tsx scripts/repro-feishu-loop.mts
 */
import { chromium } from '@playwright/test';

const SPA_URL = process.env.SPA_URL || 'http://localhost:9876';
const DEV_USER = process.env.DEV_USER_NAME!;
const DEV_PASS = process.env.DEV_USER_PASSWORD!;
const TOOL_NAME = 'builtin-feishu-mcp____update-doc____mcp';
const FIXED_ARGS = JSON.stringify({ doc_id: 'D_REPRO', mode: 'append' }); // 故意无 markdown

// ---- SSE 帧（参照 e2e/src/mocks/llm + streams/protocol.ts）----
const sseId = `msg_repro_${Date.now()}`;
const initialData = {
  content: [],
  id: sseId,
  model: 'claude-opus-4-7',
  role: 'assistant',
  stop_reason: null,
  stop_sequence: null,
  type: 'message',
  usage: { input_tokens: 10, output_tokens: 0 },
};
const toolCallData = [
  {
    function: { arguments: FIXED_ARGS, name: TOOL_NAME },
    id: `call_repro_fixed`,
    index: 0,
    type: 'function' as const,
  },
];
const usageData = {
  cost: 0.0001,
  inputCacheMissTokens: 10,
  inputCachedTokens: 0,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalTokens: 15,
};
function buildLoopSSE(): string {
  const id = `msg_repro_${Date.now()}`;
  const callId = `call_repro_${Date.now()}`;
  const tcData = [
    {
      function: { arguments: FIXED_ARGS, name: TOOL_NAME },
      id: callId,
      index: 0,
      type: 'function' as const,
    },
  ];
  const initData = { ...initialData, id };
  return [
    `id: ${id}\nevent: data\ndata: ${JSON.stringify(initData)}\n\n`,
    `id: ${id}\nevent: tool_calls\ndata: ${JSON.stringify(tcData)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "tool_use"\n\n`,
    `id: ${id}\nevent: usage\ndata: ${JSON.stringify(usageData)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "message_stop"\n\n`,
  ].join('');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    recordVideo: { dir: '/tmp/repro-video', maxSize: { height: 720, width: 1280 } },
  });
  // 开启 debug 日志(浏览器内 debug 包读 localStorage.debug)，在页面脚本前注入
  await context.addInitScript(() => {
    localStorage.setItem('debug', 'agent-runtime:*,*');
  });
  const page = await context.newPage();

  const toolCallCount = { value: 0 };
  const consoleErrors: string[] = [];

  // ---- 1. mock LLM SSE ----
  await page.route('**/webapi/chat/**', async (route) => {
    const body = buildLoopSSE();
    await route.fulfill({
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
      body,
    });
  });

  // ---- 2. mock MCP callTool（TRPC tools/mcp.callTool，URL 形如 /trpc/tools/mcp.callTool?batch=1）----
  await page.route(/mcp\.callTool/, async (route) => {
    toolCallCount.value += 1;
    const reqBody = route.request().postDataJSON();
    console.log(`[mock-MCP] #${toolCallCount.value} callTool, toolName=${reqBody?.[0]?.toolName || reqBody?.toolName}`);
    // 服务端 processToolCallResult 返回 {content:string, state, success:true}（superjson 信封）
    const payload = {
      content: '{"error":"[VALIDATION:1002] Markdown content cannot be empty"}',
      state: { isError: true, content: [{ type: 'text', text: '{"error":"[VALIDATION:1002]"}' }] },
      success: true,
    };
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify([{ result: { data: { json: payload } } }]),
    });
  });

  page.on('request', (req) => {
    const u = req.url();
    if (/\/webapi\/|\/trpc\/|\/api\/(auth|agent)/.test(u) && !u.includes('auth/sign')) {
      console.log(`[req] ${req.method()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
    }
  });
  page.on('response', (res) => {
    const u = res.url();
    if (/\/webapi\/chat/.test(u)) console.log(`[resp] ${res.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`);
  });
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error') consoleErrors.push(t);
    // 捕获 Mecha runtime 内部日志(step/phase/call_tool/tool_result)
    if (/step-|call_tool|tool_result|call_llm|llm_result|phase=|nextContext|stuck tool|stopRepeated|internal_execAgentRuntime|VALIDATION|update-doc/i.test(t))
      console.log('[dbg]', t.slice(0, 200));
  });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));

  // ---- 3. 程序化登录（Better Auth /api/auth/sign-in/email）----
  console.log('[step] login as', DEV_USER);
  const loginRes = await page.request.post(`${SPA_URL}/api/auth/sign-in/email`, {
    data: { email: DEV_USER, password: DEV_PASS },
    headers: { 'content-type': 'application/json' },
  });
  console.log('[step] login status', loginRes.status());
  if (!loginRes.ok()) {
    console.log('[step] login body', await loginRes.text().catch(() => '<binary>'));
  }

  // ---- 4. 打开 SPA 主聊天 ----
  console.log('[step] goto', SPA_URL);
  await page.goto(SPA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // 注入假飞书 user_access_token，让 feishuTokenService.requestToken 返回 ready，
  // 从而使 invokeMCPTypePlugin 走到 toolsClient.mcp.callTool（再由 mock 返回 VALIDATION:1002）
  await page.evaluate(() => {
    const key = 'lark-auth:cli_aaa103c9df7c9be5';
    const val = JSON.stringify({
      userAccessToken: { token: 'fake-repro-uat', expiredAt: Date.now() + 3600_000 },
      refreshToken: { token: 'fake-repro-rt', expiredAt: Date.now() + 3600_000 },
    });
    localStorage.setItem(key, val);
  });
  console.log('[step] injected fake feishu token into localStorage');
  console.log('[diag] url:', page.url());
  console.log('[diag] title:', await page.title());
  console.log('[diag] body text (first 500):', (await page.locator('body').innerText().catch(() => '<none>')).slice(0, 500));
  console.log('[diag] textarea count:', await page.locator('textarea').count());
  console.log('[diag] contenteditable count:', await page.locator('[contenteditable="true"]').count());
  console.log('[diag] input count:', await page.locator('input:visible').count());
  const ceDiag = page.locator('[contenteditable="true"]');
  if (await ceDiag.count() > 0) {
    console.log('[diag] first contenteditable placeholder:', await ceDiag.first().getAttribute('data-placeholder').catch(async () => (await ceDiag.first().innerText().catch(() => ''))) );
  }

  // ---- 5. 发送一条消息触发对话 ----
  // 输入框是 contenteditable div（Enter=换行，需点发送按钮或 Cmd+Enter）
  const ce = page.locator('[contenteditable="true"]').first();
  try {
    await ce.waitFor({ state: 'visible', timeout: 30000 });
    await ce.click();
    await page.keyboard.type('帮我把文档写回飞书', { delay: 30 });
    await page.waitForTimeout(800);
    console.log('[diag] editor textContent:', JSON.stringify((await ce.innerText().catch(() => '<none>')).slice(0, 60)));
    // 该用户偏好未知：先试 plain Enter，3s 内无 chat 请求再试 Meta+Enter
    const chatReqAfter = () => new Promise<boolean>((resolve) => {
      const t = setTimeout(() => { page.off('request', h); resolve(false); }, 3500);
      const h = (r: any) => { if (/\/webapi\/chat/.test(r.url())) { clearTimeout(t); page.off('request', h); resolve(true); } };
      page.on('request', h);
    });
    await page.keyboard.press('Enter');
    let sent = await chatReqAfter();
    if (!sent) {
      console.log('[diag] plain Enter did not send, trying Meta+Enter');
      await page.keyboard.press('Meta+Enter');
      sent = await chatReqAfter();
    }
    console.log(`[step] message sent=${sent}`);
  } catch (e) {
    console.log('[step] send failed:', (e as Error).message);
    await page.screenshot({ path: '/tmp/repro-screenshot.png' });
  }

  // ---- 6. 观察循环 30s ----
  console.log('[step] observing loop for 30s...');
  await page.waitForTimeout(18000);

  // 统计 DOM 里的 tool 消息数量（update-doc 失败结果）
  const toolMessages = await page
    .locator('[data-testid], [class*="tool"], [class*="message"]')
    .count()
    .catch(() => 0);

  console.log('================ RESULT ================');
  console.log('mocked MCP callTool count:', toolCallCount.value);
  console.log('DOM node count (rough):', toolMessages);
  // 抓取页面里是否出现熔断提示文案
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const broke = /已自动停止|Automatically stopped/.test(bodyText);
  console.log('breaker message shown:', broke);
  console.log('console errors (first 5):', consoleErrors.slice(0, 5).join('\n  '));
  await page.screenshot({ path: '/tmp/repro-final.png' });
  await context.close();
  const video = page.video();
  console.log('[step] video:', video ? await video.path() : '<none>');
  console.log('[step] final screenshot: /tmp/repro-final.png');

  await browser.close();
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
