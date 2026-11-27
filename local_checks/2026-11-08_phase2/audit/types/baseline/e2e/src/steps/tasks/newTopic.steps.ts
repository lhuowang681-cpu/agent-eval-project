import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { TEST_INBOX_AGENT_ID } from '../../support/seedTestUser';
import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

/**
 * Re-open the task just created (currently at the cross-agent `/task/:id` route)
 * under its owning agent's route `/agent/:aid/task/:id`. The agent-scoped detail
 * page mounts the agent sidebar — including the "Start New Topic" button that the
 * cross-agent route does not have.
 */
When('用户进入该任务所属 agent 的任务详情页', async function (this: CustomWorld) {
  const { page } = this;
  const url = new URL(page.url());
  const identifier = url.pathname.split('/').findLast(Boolean);
  if (!identifier) throw new Error(`无法从当前 URL 解析任务标识: ${page.url()}`);
  this.testContext.lastTaskIdentifier = identifier;

  console.log(
    `   📍 Step: 进入 agent 任务详情页 /agent/${TEST_INBOX_AGENT_ID}/task/${identifier} ...`,
  );
  await page.goto(`/agent/${TEST_INBOX_AGENT_ID}/task/${identifier}`);
  await page.waitForURL(/\/agent\/.+\/task\//, { timeout: WAIT_TIMEOUT });
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
  await page.waitForTimeout(800);
  console.log('   ✅ 已进入 agent 任务详情页');
});

When('用户点击侧边栏的开启新话题', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击侧边栏"开启新话题" ...');
  const btn = this.page.getByTestId('agent-new-topic').first();
  await expect(btn).toBeVisible({ timeout: WAIT_TIMEOUT });
  // Hold a beat on the task detail page so the recording shows the starting
  // point before the click.
  await this.page.waitForTimeout(1200);
  await btn.click();
});

Then('页面应跳转到该 agent 的聊天页', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验已跳转到 agent 聊天页 ...');
  // Fix: from an agent sub-route (task), "Start New Topic" must navigate back to
  // the agent chat root. So the URL should land on /agent/:aid without /task/.
  await this.page.waitForURL(
    (url) => /\/agent\/[^/]+$/.test(url.pathname) && !url.pathname.includes('/task/'),
    { timeout: WAIT_TIMEOUT },
  );
  const path = new URL(this.page.url()).pathname;
  expect(path).toMatch(new RegExp(`/agent/${TEST_INBOX_AGENT_ID}$`));
  expect(path).not.toContain('/task/');

  // Wait for the chat view to actually render the new (empty) topic — the chat
  // input — and hold a beat so the screen recording clearly captures landing on
  // the new topic, not just the URL change.
  const chatInput = this.page.getByTestId('chat-input').first();
  await expect(chatInput).toBeVisible({ timeout: WAIT_TIMEOUT });
  await this.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await this.page.waitForTimeout(2500);
  console.log(`   ✅ 已跳转到聊天页并渲染新话题: ${path}`);
});
