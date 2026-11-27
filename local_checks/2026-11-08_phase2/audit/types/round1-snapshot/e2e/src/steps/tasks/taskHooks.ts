import { Before } from '@cucumber/cucumber';

import { clearTasksForTestUser } from '../../support/taskDb';

/**
 * Isolate every @task scenario: wipe the test user's tasks first. Tasks persist
 * in a shared DB user across scenarios, so without this, same-named tasks from
 * earlier scenarios leak in and selectors hit the wrong (stale) card.
 *
 * DB-only, no page interaction, so it is order-independent w.r.t. the global
 * Before hook that initializes the browser.
 */
Before({ tags: '@task' }, async function () {
  await clearTasksForTestUser();
});
