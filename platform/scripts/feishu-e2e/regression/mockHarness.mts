/* eslint-disable */
/**
 * C 组确定性回归共享 mock 引擎（扩展 scripts/repro-feishu-loop.mts 的套路）。
 *
 * 全程 mock：
 *  - /webapi/chat/**：按 turn 返回 SSE（可控制每轮的 tool_call / 文本）
 *  - mcp.callTool：按调用序返回结果（成功 / VALIDATION / 401），并捕获请求 args
 *
 * 不打真实飞书；用来锁定已修 bug 的稳定 pass/fail 基线，无需真实授权/模型。
 */
import { type Page, chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPA_URL = process.env.SPA_URL || 'http://localhost:3010';
const VIDEO_DIR = path.join(__dirname, '..', 'videos');
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const STORAGE_STATE = path.join(__dirname, '..', '.auth', 'storageState.json');

export const FEISHU_UPDATE_TOOL = 'builtin-feishu-mcp____update-doc____mcp';

export interface MockState {
  /** 页面正文文本（用于检测熔断提示） */
  bodyText: string;
  /** 检测到熔断提示（stopRepeatedToolCalls 文案） */
  breakerShown: boolean;
  /** 捕获到的 mcp.callTool 请求 args（已解析） */
  capturedArgs: any[];
  consoleErrors: string[];
  /** mcp.callTool 被调用次数 */
  mcpCallCount: number;
}

export interface MockScenario {
  /** 期望断言 */
  assert: (s: MockState) => { notes: string[]; passed: boolean };
  /** 每轮 chat 请求返回的 SSE（turnIndex 从 0 起） */
  buildSSE: (turnIndex: number) => string;
  id: string;
  /** 是否注入假飞书 token（让调用走到 mcp.callTool） */
  injectFakeToken?: boolean;
  /** mcp.callTool 的响应（callIndex 从 0 起，reqArgs 已解析） */
  mcpHandler: (callIndex: number, reqArgs: any) => { body: string; status?: number };
  /** 观察时长 ms（默认 20s） */
  observeMs?: number;
  title: string;
}

// ---- SSE 帧工具 ----
const USAGE = {
  cost: 0.0001,
  inputCacheMissTokens: 10,
  inputCachedTokens: 0,
  totalInputTokens: 10,
  totalOutputTokens: 5,
  totalTokens: 15,
};

/** 一轮：发起一个工具调用（arguments 为字符串） */
export function sseToolCall(toolName: string, argsString: string): string {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const init = {
    content: [],
    id,
    model: 'claude-opus-4-7',
    role: 'assistant',
    stop_reason: null,
    type: 'message',
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  const tc = [{ function: { arguments: argsString, name: toolName }, id: callId, index: 0, type: 'function' }];
  return [
    `id: ${id}\nevent: data\ndata: ${JSON.stringify(init)}\n\n`,
    `id: ${id}\nevent: tool_calls\ndata: ${JSON.stringify(tc)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "tool_use"\n\n`,
    `id: ${id}\nevent: usage\ndata: ${JSON.stringify(USAGE)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "message_stop"\n\n`,
  ].join('');
}

/** 一轮：纯文本结束（end_turn），用于让对话停下来 */
export function sseText(text: string): string {
  const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const init = {
    content: [],
    id,
    model: 'claude-opus-4-7',
    role: 'assistant',
    stop_reason: null,
    type: 'message',
    usage: { input_tokens: 10, output_tokens: 0 },
  };
  return [
    `id: ${id}\nevent: data\ndata: ${JSON.stringify(init)}\n\n`,
    `id: ${id}\nevent: text\ndata: ${JSON.stringify(text)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "end_turn"\n\n`,
    `id: ${id}\nevent: usage\ndata: ${JSON.stringify(USAGE)}\n\n`,
    `id: ${id}\nevent: stop\ndata: "message_stop"\n\n`,
  ].join('');
}

/** mcp.callTool 成功响应信封 */
export function mcpOk(content: string): { body: string; status: number } {
  const payload = {
    content,
    state: { content: [{ text: content, type: 'text' }], isError: false },
    success: true,
  };
  return { body: JSON.stringify([{ result: { data: { json: payload } } }]), status: 200 };
}

/** mcp.callTool 失败响应信封（结果体含 error，success 仍 true，模拟服务端业务错误） */
export function mcpBizError(errText: string): { body: string; status: number } {
  const payload = {
    content: JSON.stringify({ error: errText }),
    state: { content: [{ text: JSON.stringify({ error: errText }), type: 'text' }], isError: true },
    success: true,
  };
  return { body: JSON.stringify([{ result: { data: { json: payload } } }]), status: 200 };
}

function parseReqArgs(post: any): any {
  const entry = Array.isArray(post) ? post[0] : post?.['0'] ?? post;
  const raw = entry?.args ?? entry?.json?.args;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function runMockScenario(scn: MockScenario): Promise<{ notes: string[]; passed: boolean }> {
  for (const d of [VIDEO_DIR, SHOT_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });

  if (!fs.existsSync(STORAGE_STATE)) {
    throw new Error(`缺少授权态 ${STORAGE_STATE}，请先运行 auth-capture.ts`);
  }
  const browser = await chromium.launch({ headless: process.env.HEADLESS === 'true' });
  const context = await browser.newContext({
    recordVideo: { dir: VIDEO_DIR, size: { height: 720, width: 1280 } },
    storageState: STORAGE_STATE,
    viewport: { height: 720, width: 1280 },
  });
  await context.addInitScript(() => localStorage.setItem('debug', 'agent-runtime:*'));
  const page: Page = await context.newPage();

  const state: MockState = {
    bodyText: '',
    breakerShown: false,
    capturedArgs: [],
    consoleErrors: [],
    mcpCallCount: 0,
  };
  let turn = 0;

  await page.route('**/webapi/chat/**', async (route) => {
    const body = scn.buildSSE(turn++);
    await route.fulfill({
      body,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache', 'x-accel-buffering': 'no' },
    });
  });

  await page.route(/mcp\.callTool/, async (route) => {
    const reqArgs = parseReqArgs(route.request().postDataJSON());
    const idx = state.mcpCallCount;
    state.mcpCallCount += 1;
    state.capturedArgs.push(reqArgs);
    const { body, status } = scn.mcpHandler(idx, reqArgs);
    await route.fulfill({ body, contentType: 'application/json', status: status ?? 200 });
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') state.consoleErrors.push(msg.text());
  });

  // 会话来自 storageState；无需程序化登录
  await page.goto(SPA_URL, { timeout: 60_000, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6_000);

  if (scn.injectFakeToken) {
    await page.evaluate(() => {
      localStorage.setItem(
        'lark-auth:cli_aaa103c9df7c9be5',
        JSON.stringify({
          refreshToken: { expiredAt: Date.now() + 3600_000, token: 'fake-rt' },
          userAccessToken: { expiredAt: Date.now() + 3600_000, token: 'fake-uat' },
        }),
      );
    });
  }

  const ce = page.locator('[contenteditable="true"]').first();
  await ce.waitFor({ state: 'visible', timeout: 30_000 });
  await ce.click();
  await page.keyboard.type('帮我把内容写回飞书文档', { delay: 10 });
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2_000);
  // 兜底用 Meta+Enter 再发一次（若首次未触发）
  const fired = await page
    .waitForRequest(/\/webapi\/chat/, { timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!fired && turn === 0) {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  }

  await page.waitForTimeout(scn.observeMs ?? 20_000);

  state.bodyText = await page.locator('body').innerText().catch(() => '');
  state.breakerShown = /已自动停止|自动停止|Automatically stopped|停止了重复/i.test(state.bodyText);

  await page.screenshot({ path: path.join(SHOT_DIR, `${scn.id}.png`) }).catch(() => {});
  const video = page.video();
  await context.close();
  if (video) {
    const raw = await video.path().catch(() => undefined);
    if (raw) {
      try {
        fs.renameSync(raw, path.join(VIDEO_DIR, `${scn.id}.webm`));
      } catch {}
    }
  }
  await browser.close();

  const verdict = scn.assert(state);
  console.log(
    `[${scn.id}] ${verdict.passed ? 'PASS' : 'FAIL'} | mcpCalls=${state.mcpCallCount} breaker=${state.breakerShown} | ${verdict.notes.join('；')}`,
  );
  return verdict;
}
