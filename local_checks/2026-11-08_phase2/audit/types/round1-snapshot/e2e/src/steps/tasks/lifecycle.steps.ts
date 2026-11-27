import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { getTaskByName, waitForTask } from '../../support/taskDb';
import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';
import { taskCard } from './taskHelpers';

When(
  '用户通过右键菜单将任务 {string} 状态设为 {string}',
  async function (this: CustomWorld, name: string, status: string) {
    console.log(`   📍 Step: 右键菜单将 "${name}" 状态设为 "${status}" ...`);
    const card = taskCard(this, name).first();
    await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });
    await card.click({ button: 'right' });

    const menuItem = (text: string | RegExp) =>
      this.page.locator('[role="menuitem"], .ant-dropdown-menu-item').filter({ hasText: text });

    // The context menu has a "Status" parent item whose submenu lists statuses.
    const statusItem = menuItem(/^\s*Status\s*$/).first();
    await expect(statusItem).toBeVisible({ timeout: WAIT_TIMEOUT });
    await statusItem.hover();
    await this.page.waitForTimeout(400);

    const target = menuItem(status).last();
    if (!(await target.isVisible().catch(() => false))) {
      // Some menus expand the submenu on click rather than hover.
      await statusItem.click();
      await this.page.waitForTimeout(400);
    }
    await expect(target).toBeVisible({ timeout: WAIT_TIMEOUT });
    await target.click();
    await this.page.waitForTimeout(1000);
  },
);

Then(
  '任务 {string} 的状态应为 {string}',
  async function (this: CustomWorld, name: string, expectedStatus: string) {
    console.log(`   📍 Step: 校验任务 "${name}" 状态为 "${expectedStatus}" ...`);
    const task = await waitForTask(name, (t) => t.status === expectedStatus, 10_000).catch(
      async () => getTaskByName(name),
    );
    expect(task?.status).toBe(expectedStatus);
  },
);
