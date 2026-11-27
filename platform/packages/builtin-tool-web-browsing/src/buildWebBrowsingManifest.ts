import type { BuiltinToolManifest } from '@lobechat/types';
import dayjs from 'dayjs';

import { WebBrowsingManifest } from './manifest';
import { systemPrompt, type WebBrowsingSystemPromptOptions } from './systemRole';

/**
 * Build web-browsing manifest with runtime systemRole (e.g. when public page crawl is disabled on server).
 */
export const buildWebBrowsingManifest = (
  options?: WebBrowsingSystemPromptOptions,
): BuiltinToolManifest => ({
  ...WebBrowsingManifest,
  systemRole: systemPrompt(dayjs().format('YYYY-MM-DD'), options),
});
