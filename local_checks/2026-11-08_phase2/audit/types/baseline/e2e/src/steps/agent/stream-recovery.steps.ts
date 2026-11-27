/**
 * Agent stream recovery E2E steps
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { llmMockManager } from '../../mocks/llm';
import type { CustomWorld } from '../../support/world';
import { WAIT_TIMEOUT } from '../../support/world';

async function findAssistantMessage(page: CustomWorld['page']) {
  const messageWrappers = page.locator('.message-wrapper');

  for (let i = (await messageWrappers.count()) - 1; i >= 0; i--) {
    const wrapper = messageWrappers.nth(i);
    const titleText = await wrapper
      .locator('.message-header')
      .textContent()
      .catch(() => '');

    if (titleText?.includes('TripYoYo AI') || titleText?.includes('AI')) {
      return wrapper;
    }
  }

  return messageWrappers.last();
}

async function getAssistantPlainText(page: CustomWorld['page']): Promise<string> {
  const assistantMessage = await findAssistantMessage(page);
  const rawText = (await assistantMessage.innerText().catch(() => '')) || '';

  return rawText
    .replaceAll(/TripYoYo AI/gi, '')
    .replaceAll(/[·•]/g, '')
    .trim();
}

// ============================================
// Given
// ============================================

Given('用户进入 TripYoYo AI 对话页面且已启用流恢复 Mock', async function (this: CustomWorld) {
  llmMockManager.resetStreamRecoveryState();
  await llmMockManager.setup(this.page);

  await this.page.goto('/');
  await this.page.waitForLoadState('networkidle', { timeout: WAIT_TIMEOUT });

  const lobeAIAgent = this.page.locator('text=TripYoYo AI').first();
  await expect(lobeAIAgent).toBeVisible({ timeout: WAIT_TIMEOUT });
  await lobeAIAgent.click();
  await this.page.waitForLoadState('networkidle', { timeout: WAIT_TIMEOUT });
  await this.page.waitForTimeout(1000);

  console.log('   ✅ 已进入 TripYoYo AI 对话页面（流恢复 Mock 已启用）');
});

// ============================================
// Then
// ============================================

const STREAM_STEP_TIMEOUT = 60_000;

Then(
  '助手最终应显示完整回复 {string}',
  { timeout: STREAM_STEP_TIMEOUT },
  async function (this: CustomWorld, expectedContent: string) {
    console.log(`   📍 等待完整回复: "${expectedContent}"`);

    await expect
      .poll(
        async () => {
          const text = await getAssistantPlainText(this.page);
          return text.includes(expectedContent);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const finalText = await getAssistantPlainText(this.page);
    console.log(`   ✅ 助手回复已完整: "${finalText.slice(0, 80)}..."`);
  },
);

Then(
  '不应显示流中断提示横幅',
  { timeout: STREAM_STEP_TIMEOUT },
  async function (this: CustomWorld) {
    const banner = this.page.locator('[data-testid="incomplete-stream-banner"]');

    await expect.poll(async () => banner.count(), { timeout: 30_000 }).toBe(0);

    console.log('   ✅ 未显示流中断横幅');
  },
);

Then('应显示流中断提示横幅', { timeout: STREAM_STEP_TIMEOUT }, async function (this: CustomWorld) {
  await expect
    .poll(() => llmMockManager.getStreamRecoveryRequestCount('stream-fail'), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(2);

  const banner = this.page.locator('[data-testid="incomplete-stream-banner"]');
  await expect(banner).toBeVisible({ timeout: 30_000 });

  const alert = this.page.locator('[data-testid="incomplete-stream-alert"]');
  await expect(alert).toBeVisible();

  const continueButton = this.page.locator('[data-testid="incomplete-stream-continue"]');
  await expect(continueButton).toBeVisible();

  console.log('   ✅ 已显示流中断提示横幅');
});

// ============================================
// When
// ============================================

When(
  '用户点击流中断横幅上的继续按钮',
  { timeout: STREAM_STEP_TIMEOUT },
  async function (this: CustomWorld) {
    const continueButton = this.page.locator('[data-testid="incomplete-stream-continue"]');
    await expect(continueButton).toBeVisible({ timeout: WAIT_TIMEOUT });
    await continueButton.click();
    console.log('   ✅ 已点击继续生成按钮');
    await this.page.waitForTimeout(500);
  },
);
