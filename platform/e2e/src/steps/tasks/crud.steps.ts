import { Given, Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';
import {
  createTaskOnList,
  escapeRegExp,
  gotoTaskList,
  openTaskCard,
  taskCard,
} from './taskHelpers';

Given('用户进入任务列表页', async function (this: CustomWorld) {
  console.log('   📍 Step: 进入任务列表页 /tasks ...');
  await gotoTaskList(this);
  console.log('   ✅ 已进入任务列表页');
});

When('用户返回任务列表页', async function (this: CustomWorld) {
  console.log('   📍 Step: 返回任务列表页 ...');
  await gotoTaskList(this);
});

When('用户创建一个任务，指令为 {string}', async function (this: CustomWorld, instruction: string) {
  console.log(`   📍 Step: 创建任务 "${instruction}" ...`);
  await createTaskOnList(this, instruction);
  this.testContext.lastTaskName = instruction;
  // The inline entry stays on the list; open the new task's detail page so the
  // common "创建后进入详情" flow holds.
  await openTaskCard(this, instruction);
  console.log('   ✅ 任务已创建并打开详情');
});

When('用户将任务标题改为 {string}', async function (this: CustomWorld, newTitle: string) {
  console.log(`   📍 Step: 修改任务标题为 "${newTitle}" ...`);
  const title = this.page.getByTestId('task-detail-title');
  await expect(title).toBeVisible({ timeout: WAIT_TIMEOUT });
  await title.fill(newTitle);
  // Title autosave is debounced (~300ms) then persisted via updateTask.
  await this.page.waitForTimeout(1500);
  this.testContext.lastTaskName = newTitle;
  console.log('   ✅ 标题已修改');
});

When('用户刷新当前页面', async function (this: CustomWorld) {
  console.log('   📍 Step: 刷新页面 ...');
  await this.page.reload({ waitUntil: 'networkidle' });
  await this.page.waitForTimeout(800);
});

When('用户右键删除任务 {string}', async function (this: CustomWorld, name: string) {
  console.log(`   📍 Step: 右键删除任务 "${name}" ...`);
  const card = taskCard(this, name).first();
  await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });
  await card.click({ button: 'right' });

  // Context menu "Delete" item (en: Delete / zh: 删除).
  const deleteItem = this.page
    .locator('[role="menuitem"], .ant-dropdown-menu-item')
    .filter({ hasText: /^\s*(Delete|删除)\s*$/ })
    .first();
  await expect(deleteItem).toBeVisible({ timeout: WAIT_TIMEOUT });
  await deleteItem.click();

  // Confirm modal — danger "Delete" button.
  const confirmBtn = this.page.getByRole('button', { name: /^(Delete|删除)$/ }).first();
  await expect(confirmBtn).toBeVisible({ timeout: WAIT_TIMEOUT });
  await confirmBtn.click();
  await this.page.waitForTimeout(1000);
  console.log('   ✅ 已确认删除');
});

Then('页面应该跳转到任务详情页', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验已在任务详情页 ...');
  expect(this.page.url()).toMatch(/\/task\//);
});

Then('任务详情标题应包含 {string}', async function (this: CustomWorld, text: string) {
  console.log(`   📍 Step: 校验详情标题包含 "${text}" ...`);
  const title = this.page.getByTestId('task-detail-title');
  await expect(title).toHaveValue(new RegExp(escapeRegExp(text)), { timeout: WAIT_TIMEOUT });
});

Then('任务列表中应出现 {string}', async function (this: CustomWorld, name: string) {
  console.log(`   📍 Step: 校验列表中出现 "${name}" ...`);
  await expect(taskCard(this, name).first()).toBeVisible({ timeout: WAIT_TIMEOUT });
});

Then('任务列表中不应出现 {string}', async function (this: CustomWorld, name: string) {
  console.log(`   📍 Step: 校验列表中不存在 "${name}" ...`);
  await expect(taskCard(this, name)).toHaveCount(0, { timeout: WAIT_TIMEOUT });
});
