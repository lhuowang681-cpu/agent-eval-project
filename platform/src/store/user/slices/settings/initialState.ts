import { DEFAULT_SETTINGS } from '@lobechat/config';
import { type UserSettings } from '@lobechat/types';
import { type PartialDeep } from 'type-fest';

import { loadCanarySettings } from './canaryStorage';

export interface UserSettingsState {
  defaultSettings: UserSettings;
  settings: PartialDeep<UserSettings>;
  updateSettingsSignal?: AbortController;
}

/**
 * settings 初始值预填本地 canary 设置，使刷新后 `getCanaryHeaders()` 在
 * `getUserState` 网络请求返回前即可读到正确的堡垒路由开关。
 * 仅在本地确有 canary 值时才填入 general 键，保持空状态仍为 `{}`，
 * 不影响 setSettings 的 diff 逻辑与既有测试断言。
 */
const preloadedCanary = loadCanarySettings();

export const initialSettingsState: UserSettingsState = {
  defaultSettings: DEFAULT_SETTINGS,
  settings: Object.keys(preloadedCanary).length > 0 ? { general: preloadedCanary } : {},
};
