import { Then, When } from '@cucumber/cucumber';
import { expect } from '@playwright/test';

import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

When('用户打开任务调度配置', async function (this: CustomWorld) {
  console.log('   📍 Step: 打开调度配置 popover ...');
  // On the detail page the schedule popover is triggered by the inline trigger
  // tag, which reads "Set schedule" when no automation is configured yet.
  const trigger = this.page.getByText('Set schedule', { exact: true }).first();
  await expect(trigger).toBeVisible({ timeout: WAIT_TIMEOUT });
  await trigger.click();
  // Popover heading is "Automation".
  await expect(this.page.getByText('Automation', { exact: true }).first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

When('用户开启自动化', async function (this: CustomWorld) {
  console.log('   📍 Step: 开启自动化开关 ...');
  const sw = this.page.getByRole('switch').first();
  await expect(sw).toBeVisible({ timeout: WAIT_TIMEOUT });
  if (!(await sw.isChecked())) {
    await sw.click();
  }
  // Enabling reveals the Scheduled/Heartbeat segmented control.
  await expect(this.page.getByText('Scheduled', { exact: true }).first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
  await this.page.waitForTimeout(1200); // let the default schedule autosave
});

When('用户切换到心跳模式', async function (this: CustomWorld) {
  console.log('   📍 Step: 切换到 Heartbeat ...');
  await this.page.getByText('Heartbeat', { exact: true }).first().click();
  await this.page.waitForTimeout(500);
});

When('用户关闭自动化', async function (this: CustomWorld) {
  console.log('   📍 Step: 关闭自动化开关 ...');
  const sw = this.page.getByRole('switch').first();
  if (await sw.isChecked()) {
    await sw.click();
  }
  await this.page.waitForTimeout(1000);
});

Then('调度配置应处于已启用状态', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验自动化已启用 ...');
  const sw = this.page.getByRole('switch').first();
  await expect(sw).toBeChecked({ timeout: WAIT_TIMEOUT });
  // "Automation is off" must not be shown when enabled.
  await expect(this.page.getByText('Automation is off')).toHaveCount(0);
});

Then('任务详情应显示已配置定时调度', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验详情页调度已配置(刷新后保留) ...');
  // Once a schedule is set, the inline trigger no longer prompts "Set schedule".
  await expect(this.page.getByText('Set schedule', { exact: true })).toHaveCount(0, {
    timeout: WAIT_TIMEOUT,
  });
});

Then('调度配置应显示心跳间隔设置', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验显示心跳间隔 ...');
  // The interval row shows the "Every" label + a numeric input.
  await expect(this.page.getByText('Every', { exact: true }).first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});

Then('调度配置应显示自动化已关闭', async function (this: CustomWorld) {
  console.log('   📍 Step: 校验自动化已关闭 ...');
  await expect(this.page.getByText('Automation is off').first()).toBeVisible({
    timeout: WAIT_TIMEOUT,
  });
});
