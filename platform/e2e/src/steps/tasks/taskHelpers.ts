import { expect } from '@playwright/test';

import { type CustomWorld, WAIT_TIMEOUT } from '../../support/world';

/** Escape a literal string for use inside a RegExp. */
export const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Navigate to the tasks list page and wait for it to settle. */
export async function gotoTaskList(world: CustomWorld): Promise<void> {
  await world.page.goto('/tasks');
  await world.page.waitForLoadState('networkidle', { timeout: 15_000 });
  await world.page.waitForTimeout(800);
}

/**
 * Create a task from the list page's inline / hero entry (the always-available
 * create surface). The task name is derived from the first line of the
 * instruction, so we can later locate the card / detail by the same text.
 */
export async function createTaskOnList(world: CustomWorld, instruction: string): Promise<void> {
  const { page } = world;

  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible({ timeout: WAIT_TIMEOUT });
  await editor.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(instruction, { delay: 20 });

  const submit = page.getByTestId('task-create-submit').first();
  await expect(submit).toBeEnabled({ timeout: WAIT_TIMEOUT });
  await submit.click();

  // The new card shows up in the list once creation resolves.
  const card = page.getByTestId('task-card').filter({ hasText: instruction }).first();
  await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });
}

/** Open a task's detail page by clicking its card in the list. */
export async function openTaskCard(world: CustomWorld, name: string): Promise<void> {
  const { page } = world;
  const card = page.getByTestId('task-card').filter({ hasText: name }).first();
  await expect(card).toBeVisible({ timeout: WAIT_TIMEOUT });
  await card.click();
  await page.waitForURL(/\/task\//, { timeout: WAIT_TIMEOUT });
  await page.waitForLoadState('networkidle', { timeout: 15_000 });
}

/** Locator for a task card matching the given visible text. */
export const taskCard = (world: CustomWorld, name: string) =>
  world.page.getByTestId('task-card').filter({ hasText: name });
