import { EdgeConfig } from '@lobechat/edge-config';
import { createEnv } from '@t3-oss/env-nextjs';
import debug from 'debug';
import { z } from 'zod';

import { merge } from '@/utils/merge';

import { DEFAULT_FEATURE_FLAGS, mapFeatureFlagsEnvToState } from './schema';
import { type IFeatureFlags } from './schema';
import { parseFeatureFlag } from './utils/parser';

const log = debug('lobe-feature-flags');

const env = createEnv({
  runtimeEnv: {
    FEATURE_FLAGS: process.env.FEATURE_FLAGS,
    MARKET_ENABLED: process.env.MARKET_ENABLED,
    SANDBOX_ENABLED: process.env.SANDBOX_ENABLED,
  },

  server: {
    FEATURE_FLAGS: z.string().optional(),
    // 控制「市场」入口与各处「发布到市场」按钮是否展示。
    // 默认（未配置或非 '0'）展示；配置为 '0' 时隐藏。
    MARKET_ENABLED: z.string().optional(),
    // 控制「云沙箱」执行环境是否可用（web 与 desktop 共用）。与
    // FEATURE_FLAGS=-cloud_sandbox 是 OR 关系：两者任一表达关闭意图即关闭，
    // 避免运维环境变量的迁移状态（新旧命名）导致误开。
    // 默认（未配置或非 '0'）不额外影响；配置为 '0' 时强制禁用云沙箱。
    SANDBOX_ENABLED: z.string().optional(),
  },
});

/**
 * 将独立的 MARKET_ENABLED 环境变量叠加到 feature flags 上。
 * 仅当显式配置为 '0' 时关闭市场功能，其余情况（含未配置）保持默认。
 */
const applyMarketEnabledEnv = (flags: IFeatureFlags): IFeatureFlags => {
  if (env.MARKET_ENABLED === '0') return { ...flags, market: false };
  return flags;
};

/**
 * 将独立的 SANDBOX_ENABLED 环境变量叠加到 feature flags 上。
 * 仅当显式配置为 '0' 时禁用云沙箱执行，其余情况（含未配置）保持不变——
 * 云沙箱本身默认已关闭（见 DEFAULT_FEATURE_FLAGS.cloud_sandbox），这里只
 * 负责在需要时把它压回 false，不会把它打开。
 */
const applySandboxEnabledEnv = (flags: IFeatureFlags): IFeatureFlags => {
  if (env.SANDBOX_ENABLED === '0') return { ...flags, cloud_sandbox: false };
  return flags;
};

export const getServerFeatureFlagsValue = () => {
  const flags = parseFeatureFlag(env.FEATURE_FLAGS);

  const result = merge(DEFAULT_FEATURE_FLAGS, flags);
  return applySandboxEnabledEnv(applyMarketEnabledEnv(result));
};

/**
 * Get feature flags from EdgeConfig with fallback to environment variables
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsFromEdgeConfig = async (userId?: string) => {
  // Try to get feature flags from EdgeConfig first
  if (EdgeConfig.isEnabled()) {
    try {
      const edgeConfig = new EdgeConfig();
      const edgeFeatureFlags = await edgeConfig.getFeatureFlags();

      if (edgeFeatureFlags && Object.keys(edgeFeatureFlags).length > 0) {
        // Merge EdgeConfig flags with defaults
        const mergedFlags = merge(DEFAULT_FEATURE_FLAGS, edgeFeatureFlags);
        log('[FeatureFlags] Using EdgeConfig flags for user:', userId || 'anonymous');
        return applySandboxEnabledEnv(applyMarketEnabledEnv(mergedFlags));
      } else {
        log(
          '[FeatureFlags] EdgeConfig returned empty/null/undefined, falling back to environment variables',
        );
      }
    } catch (error) {
      log(
        '[FeatureFlags] Failed to fetch feature flags from EdgeConfig, falling back to environment variables:',
        error,
      );
    }
  } else {
    log('[FeatureFlags] EdgeConfig not enabled, using environment variables');
  }

  // Fallback to environment variable-based feature flags
  const envFlags = getServerFeatureFlagsValue();
  log('[FeatureFlags] Using environment variable flags for user:', userId || 'anonymous');
  return envFlags;
};

export const serverFeatureFlags = (userId?: string) => {
  const serverConfig = getServerFeatureFlagsValue();

  return mapFeatureFlagsEnvToState(serverConfig, userId);
};

/**
 * Get server feature flags from EdgeConfig and map them to state with user ID
 * @param userId - Optional user ID for user-specific feature flag evaluation
 */
export const getServerFeatureFlagsStateFromEdgeConfig = async (userId?: string) => {
  const flags = await getServerFeatureFlagsFromEdgeConfig(userId);
  return mapFeatureFlagsEnvToState(flags, userId);
};

export * from './schema';
