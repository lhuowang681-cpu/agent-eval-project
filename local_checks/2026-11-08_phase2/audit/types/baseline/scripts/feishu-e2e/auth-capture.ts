/* eslint-disable */
/**
 * 一次性：捕获飞书授权态。
 *
 * 流程：
 *  1) 打开有头浏览器，程序化登录应用（DEV_USER_NAME/DEV_USER_PASSWORD）
 *  2) 进入主聊天，你手动发一句会触发飞书工具的话（如"列出我飞书云空间的文档"），
 *     点开授权卡片完成飞书 OAuth 授权
 *  3) 脚本轮询 localStorage 里的 lark-auth key，出现即保存 storageState
 *
 * 用法：bunx tsx scripts/feishu-e2e/auth-capture.ts
 */
import { chromium } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { DEV_PASS, DEV_USER, LARK_AUTH_STORAGE_KEY, SPA_URL, STORAGE_STATE_PATH } from './config';

async function main() {
  const authDir = path.dirname(STORAGE_STATE_PATH);
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { height: 800, width: 1280 } });
  const page = await context.newPage();

  if (DEV_USER && DEV_PASS) {
    const res = await page.request.post(`${SPA_URL}/api/auth/sign-in/email`, {
      data: { email: DEV_USER, password: DEV_PASS },
      headers: { 'content-type': 'application/json' },
    });
    console.log('[auth-capture] 应用登录 status', res.status());
  } else {
    console.log('[auth-capture] 未配置 DEV_USER_NAME/PASSWORD，请在浏览器里手动登录');
  }

  await page.goto(SPA_URL, { timeout: 60_000, waitUntil: 'domcontentloaded' });

  console.log('\n========================================================');
  console.log('请在打开的浏览器里：');
  console.log('  1. 发一句会用到飞书的话，例如：列出我飞书云空间最近的文档');
  console.log('  2. 出现飞书授权卡片后点击授权，完成 OAuth');
  console.log('脚本会自动检测授权完成并保存 storageState。最多等 5 分钟。');
  console.log('========================================================\n');

  const deadline = Date.now() + 5 * 60_000;
  let captured = false;
  while (Date.now() < deadline) {
    const token = await page
      .evaluate((key) => localStorage.getItem(key), LARK_AUTH_STORAGE_KEY)
      .catch(() => null);
    if (token) {
      // 简单校验含 userAccessToken
      if (/userAccessToken/.test(token)) {
        captured = true;
        break;
      }
    }
    await page.waitForTimeout(2_000);
  }

  if (!captured) {
    console.error('[auth-capture] 超时未检测到飞书授权态，未保存。请重试。');
    await browser.close();
    process.exit(1);
  }

  await context.storageState({ path: STORAGE_STATE_PATH });
  console.log(`[auth-capture] ✅ 已保存授权态 → ${STORAGE_STATE_PATH}`);
  console.log('[auth-capture] 该文件含真实凭证，已在 .gitignore，勿提交。');
  await browser.close();
}

main().catch((e) => {
  console.error('[FATAL]', e);
  process.exit(1);
});
