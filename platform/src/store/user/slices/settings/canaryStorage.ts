import { CANARY_IDC_LATEST } from '@/const/canary';

const STORAGE_KEY = 'LOBE_CANARY';

export interface CanaryLocalSettings {
  canaryIdc?: string;
  enableCanary?: boolean;
}

/**
 * SSR 安全的同步读取，用于 initialState 预填和 getCanaryHeaders 兜底。
 * 刷新后 store 重建时第一时间恢复 canary 状态，不等 getUserState 网络请求。
 */
export const loadCanarySettings = (): CanaryLocalSettings => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CanaryLocalSettings) : {};
  } catch {
    return {};
  }
};

/** 同步写入，忽略 quota/序列化错误。 */
export const saveCanarySettings = (settings: CanaryLocalSettings): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore QuotaExceededError
  }
};

/** 规范化：缺失时回退到默认值，便于合并。 */
export const normalizeCanarySettings = (
  settings: CanaryLocalSettings,
): Required<Pick<CanaryLocalSettings, 'enableCanary' | 'canaryIdc'>> => ({
  canaryIdc: settings.canaryIdc || CANARY_IDC_LATEST,
  enableCanary: settings.enableCanary ?? false,
});
