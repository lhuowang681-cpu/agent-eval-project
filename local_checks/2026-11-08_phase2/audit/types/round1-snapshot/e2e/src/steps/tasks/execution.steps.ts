import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { getTaskByName, makeTaskDueNow, waitForTaskTopic } from '../../support/taskDb';
import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

const DISPATCH_PATH = '/api/workflows/task/schedule-dispatch';

When('用户点击运行任务', async function (this: CustomWorld) {
  console.log('   📍 Step: 点击 Run 运行任务 ...');
  const runBtn = this.page.getByRole('button', { name: 'Run', exact: true }).first();
  await expect(runBtn).toBeVisible({ timeout: WAIT_TIMEOUT });
  await runBtn.click();
});

When('将该任务设为立即到点的定时任务', async function (this: CustomWorld) {
  const name = this.testContext.lastTaskName as string;
  console.log(`   📍 Step: 将任务 "${name}" 设为立即到点(每分钟)的定时任务 ...`);
  const task = await getTaskByName(name);
  if (!task) throw new Error(`找不到任务: ${name}`);
  await makeTaskDueNow(task.id);
  this.testContext.lastTaskId = task.id;
});

When('触发后台定时派发', async function (this: CustomWorld) {
  console.log('   📍 Step: POST /schedule-dispatch (dryRun=false) ...');
  const res = await this.page.request.post(DISPATCH_PATH, { data: { dryRun: false } });
  expect(res.ok()).toBeTruthy();
  this.testContext.dispatchResult = await res.json();
  console.log('   ↳ dispatch 结果:', JSON.stringify(this.testContext.dispatchResult));
});

When('以 dryRun 触发后台定时派发', async function (this: CustomWorld) {
  console.log('   📍 Step: POST /schedule-dispatch (dryRun=true) ...');
  const res = await this.page.request.post(DISPATCH_PATH, { data: { dryRun: true } });
  expect(res.ok()).toBeTruthy();
  this.testContext.dispatchResult = await res.json();
  console.log('   ↳ dispatch 结果:', JSON.stringify(this.testContext.dispatchResult));
});

Then('派发结果应至少派发 1 个任务', async function (this: CustomWorld) {
  const result = this.testContext.dispatchResult;
  expect(result?.success).toBeTruthy();
  expect(result?.dispatched).toBeGreaterThanOrEqual(1);
});

Then('派发结果的实际派发数应为 0', async function (this: CustomWorld) {
  const result = this.testContext.dispatchResult;
  expect(result?.success).toBeTruthy();
  expect(result?.dispatched ?? 0).toBe(0);
  // dryRun should still have found our due task.
  expect(result?.due ?? 0).toBeGreaterThanOrEqual(1);
});

Then('任务应产生一次运行记录', async function (this: CustomWorld) {
  const name = this.testContext.lastTaskName as string;
  console.log(`   📍 Step: 校验任务 "${name}" 产生了运行 topic ...`);
  const task = this.testContext.lastTaskId
    ? { id: this.testContext.lastTaskId as string }
    : await getTaskByName(name);
  if (!task?.id) throw new Error(`找不到任务: ${name}`);
  const topics = await waitForTaskTopic(task.id, 20_000);
  expect(topics).toBeGreaterThanOrEqual(1);
  console.log(`   ✅ 任务已发起运行，topic 数=${topics}`);
});
