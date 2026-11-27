import { useServerConfigStore } from '@/store/serverConfig';

/**
 * 读取「市场」功能开关（由 MARKET_ENABLED 环境变量驱动）。
 * 默认展示；仅当显式关闭时返回 false。
 */
export const useShowMarket = (): boolean => {
  const showMarket = useServerConfigStore((s) => s.featureFlags.showMarket);

  return showMarket ?? true;
};
