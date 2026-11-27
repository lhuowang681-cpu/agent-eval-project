#!/usr/bin/env node
/**
 * F17.4 —— 移动端 UI 端到端完成一次对话（生产构建 + 真实键盘事件）。
 *
 * 为什么必须用 Playwright 而不是在页面里注入脚本：
 * 输入区是 **Lexical 富文本编辑器**，它自管状态、只认真实的 beforeinput/keydown 序列。
 * 实测 `document.execCommand('insertText')` 返回 true 但文本根本不进编辑器
 * （见 §22.2）——「合成事件进不去」正是此前 F17.4 一直无法验证的原因，
 * 而那是**测试手段的限制，不是产品缺陷**。Playwright 发的是真实输入事件。
 *
 * 前置：
 *   1. 生产产物：bun run build:spa:mobile
 *   2. 静态服务（带鉴权注入，否则被 /signin 拦下）：
 *        node scripts/local/serveMobileDist.mjs --port 3014 --dev-auth
 *   3. 应用与 mock LLM 在 :3010 / :8088
 *
 * Usage:  node tools/api-test/mobile-f17.mjs
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';

const ROOT = join(import.meta.dirname, '..', '..');
const BASE = process.env.MOBILE_BASE_URL ?? 'http://127.0.0.1:3014';
const MOCK_LLM = process.env.TEST_MOCK_LLM_URL ?? 'http://localhost:8088';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.info(`  ✅ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
};

const setScenario = async (scenario) => {
  const res = await fetch(`${MOCK_LLM}/__mock/config`, {
    body: JSON.stringify({ firstTokenDelayMs: 0, scenario, tokensPerSecond: 0 }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!res.ok) throw new Error(`set scenario failed: ${await res.text()}`);
};

const main = async () => {
  console.info('═'.repeat(64));
  console.info('F17.4 · 移动端 UI 完成一次对话（生产构建）');
  console.info('═'.repeat(64));

  const require = createRequire(import.meta.url);
  const { chromium } = require(
    join(ROOT, 'node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'),
  );

  await setScenario('simple');

  const browser = await chromium.launch();
  // 与之前的观测保持同一视口，结论才可比
  const context = await browser.newContext({
    isMobile: true,
    hasTouch: true,
    viewport: { height: 812, width: 375 },
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // antd 的废弃提示走的是 console.error，但它是**告知性**的、不影响功能。
    // 不过滤的话这条断言会恒失败，久而久之就没人看它了 —— 护栏因噪音失效比没有护栏更糟。
    if (/\[antd: .*\] `.*` is deprecated/.test(text)) return;
    consoleErrors.push(text.slice(0, 160));
  });

  try {
    console.info('\n▶ 入口与路由');
    await page.goto(`${BASE}/index.mobile.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    check('移动端入口加载', await page.locator('body').isVisible());

    const agentHref = await page
      .locator('a[href^="/agent/"]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    check('会话列表存在助理入口', !!agentHref, `href=${agentHref}`);
    // 已知缺陷，生产构建下同样存在（§14c）；这里只做记录，不因它中断流程
    check(
      '🐛 列表项链接 id 为 undefined（既有缺陷，dev 与生产一致）',
      agentHref === '/agent/undefined',
      agentHref ?? '(null)',
    );

    await page.locator('a[href^="/agent/"]').first().click();
    await page.waitForTimeout(3000);

    check('点击后未被 /signin 拦截', !page.url().includes('signin'), page.url());

    console.info('\n▶ 输入区');
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.waitFor({ state: 'visible', timeout: 15_000 });
    check('聊天页渲染输入区（Lexical 编辑器）', await editor.isVisible());
    check(
      '编辑器可编辑',
      (await editor.getAttribute('contenteditable')) === 'true' &&
        (await editor.getAttribute('data-lexical-editor')) === 'true',
    );

    console.info('\n▶ 真实键盘输入并发送');
    const prompt = `移动端 F17.4 验证 ${Date.now()}`;
    await editor.click();
    // 真实键盘事件 —— 这是 execCommand 做不到的部分
    await page.keyboard.type(prompt, { delay: 12 });
    await page.waitForTimeout(400);

    const typed = (await editor.innerText()).trim();
    check('文本确实进入编辑器', typed.includes(prompt.slice(0, 12)), typed.slice(0, 60));

    await page.keyboard.press('Enter');

    console.info('\n▶ 等待助手回复');
    // 用户消息先上屏，再等助手回复出现
    await page
      .locator(`text=${prompt.slice(0, 20)}`)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => {});

    let replied = false;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const text = await page.locator('body').innerText();
      // mock 的 'simple' 场景回的是固定中文短句；只要出现"编辑器里没打过的新内容"即可
      if (text.includes('这是一条') || /助理|assistant/i.test(text)) {
        const afterPrompt = text.split(prompt.slice(0, 20)).pop() ?? '';
        if (afterPrompt.trim().length > 10) {
          replied = true;
          break;
        }
      }
      await page.waitForTimeout(1000);
    }

    check('F17.4 助手回复上屏（UI 端到端完成一次对话）', replied);

    console.info('\n▶ 控制台');

    /*
     * 🐛 新发现（2026-08-09）：`sendMessage` 里对 agent 配置**无保护地解构**。
     *
     *   TypeError: Cannot destructure property 'model' of
     *   'getAgentConfigById(...)(...)' as it is undefined
     *
     * 它出现在 `/agent/undefined` 这条路径上 —— 列表项链接的 agent id 是字面量
     * `undefined`（既有缺陷），配置自然查不到，而调用方直接解构了返回值。
     *
     * ⚠️ 值得注意的是：**对话仍然完成了**（上面那条断言通过）。也就是说这个异常
     * 被兜底路径吸收了，用户看不见 —— 只在控制台留下一条 TypeError。
     * 这类"报错但还能用"的状态最容易长期无人处理，故单独钉成断言。
     */
    const configDestructureErrors = consoleErrors.filter((e) =>
      /Cannot destructure property 'model'/.test(e),
    );
    check(
      "🐛 sendMessage 对 agent 配置无保护解构（此断言通过 = 缺陷存在）",
      configDestructureErrors.length > 0,
      configDestructureErrors[0]?.slice(0, 110) ?? '(未复现)',
    );

    const otherErrors = consoleErrors.filter(
      (e) => !/Cannot destructure property 'model'/.test(e),
    );
    check(
      '除上述已知缺陷外无其它控制台错误',
      otherErrors.length === 0,
      otherErrors.length ? otherErrors.slice(0, 2).join(' | ') : '无',
    );
  } finally {
    await browser.close();
  }

  console.info(`\n${'─'.repeat(60)}`);
  console.info(`通过 ${passed} / 失败 ${failed}`);
  console.info('─'.repeat(60));
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error('\n💥 mobile-f17 异常:', e);
  process.exit(1);
});
