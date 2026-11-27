import { z } from 'zod';

// Define a union type for feature flag values: either boolean or array of user IDs
const FeatureFlagValue = z.union([z.boolean(), z.array(z.string())]);

export const FeatureFlagsSchema = z.object({
  check_updates: FeatureFlagValue.optional(),

  // settings
  provider_settings: FeatureFlagValue.optional(),

  openai_api_key: FeatureFlagValue.optional(),
  openai_proxy_url: FeatureFlagValue.optional(),

  // profile
  api_key_manage: FeatureFlagValue.optional(),
  edit_agent: FeatureFlagValue.optional(),

  ai_image: FeatureFlagValue.optional(),
  speech_to_text: FeatureFlagValue.optional(),
  token_counter: FeatureFlagValue.optional(),

  welcome_suggest: FeatureFlagValue.optional(),
  changelog: FeatureFlagValue.optional(),

  market: FeatureFlagValue.optional(),
  market_stats: FeatureFlagValue.optional(),
  knowledge_base: FeatureFlagValue.optional(),

  // 控制「云沙箱」执行环境是否可用（web 与 desktop 共用此开关）。
  cloud_sandbox: FeatureFlagValue.optional(),

  // 控制「数据存储」设置页中「清除数据」一栏是否显示。
  clear_data: FeatureFlagValue.optional(),

  // 控制 Agent Gateway 图标是否显示在聊天输入框底部。
  agent_gateway_icon: FeatureFlagValue.optional(),

  rag_eval: FeatureFlagValue.optional(),

  // internal flag
  cloud_promotion: FeatureFlagValue.optional(),

  // the flags below can only be used with commercial license
  // if you want to use it in the commercial usage
  // please contact us for more information: hello@calcifer.train.ctripcorp.com
  commercial_hide_github: FeatureFlagValue.optional(),
  commercial_hide_docs: FeatureFlagValue.optional(),
});

export type IFeatureFlags = z.infer<typeof FeatureFlagsSchema>;

/**
 * Evaluate a feature flag value against a user ID
 * @param flagValue - The feature flag value (boolean or array of user IDs)
 * @param userId - The current user ID
 * @returns boolean indicating if the feature is enabled for the user
 */
export const evaluateFeatureFlag = (
  flagValue: boolean | string[] | undefined,
  userId?: string,
): boolean | undefined => {
  if (typeof flagValue === 'boolean') return flagValue;

  if (Array.isArray(flagValue)) {
    return userId ? flagValue.includes(userId) : false;
  }
};

export const DEFAULT_FEATURE_FLAGS: IFeatureFlags = {
  provider_settings: true,

  openai_api_key: true,
  openai_proxy_url: true,

  api_key_manage: false,
  edit_agent: true,

  ai_image: true,

  check_updates: true,
  welcome_suggest: true,
  token_counter: true,

  knowledge_base: true,
  rag_eval: false,

  cloud_sandbox: false,

  clear_data: true,

  // Agent Gateway 图标默认显示
  agent_gateway_icon: true,

  cloud_promotion: false,

  market: true,
  market_stats: true,
  speech_to_text: true,
  changelog: true,

  // the flags below can only be used with commercial license
  // if you want to use it in the commercial usage
  // please contact us for more information: hello@calcifer.train.ctripcorp.com
  commercial_hide_github: false,
  commercial_hide_docs: false,
};

export const mapFeatureFlagsEnvToState = (config: IFeatureFlags, userId?: string) => {
  return {
    isAgentEditable: evaluateFeatureFlag(config.edit_agent, userId),
    showProvider: evaluateFeatureFlag(config.provider_settings, userId),

    showOpenAIApiKey: evaluateFeatureFlag(config.openai_api_key, userId),
    showOpenAIProxyUrl: evaluateFeatureFlag(config.openai_proxy_url, userId),

    showApiKeyManage: evaluateFeatureFlag(config.api_key_manage, userId),

    showAiImage: evaluateFeatureFlag(config.ai_image, userId),
    showChangelog: evaluateFeatureFlag(config.changelog, userId),

    enableCheckUpdates: evaluateFeatureFlag(config.check_updates, userId),
    showWelcomeSuggest: evaluateFeatureFlag(config.welcome_suggest, userId),

    enableKnowledgeBase: evaluateFeatureFlag(config.knowledge_base, userId),
    enableRAGEval: evaluateFeatureFlag(config.rag_eval, userId),

    // DEFAULT_FEATURE_FLAGS.cloud_sandbox 默认 false（云沙箱默认关闭），
    // 需显式 FEATURE_FLAGS=+cloud_sandbox 才开启；`!== false` 仅用于兜底
    // config 对象整体缺失该字段（如旧版客户端缓存的 config）的极端情况。
    enableCloudSandbox: evaluateFeatureFlag(config.cloud_sandbox, userId) !== false,

    // undefined（未配置）视为开启，仅显式 false 时隐藏「清除数据」一栏。
    showClearData: evaluateFeatureFlag(config.clear_data, userId) !== false,

    // Agent Gateway 图标：默认显示，仅显式 false 时隐藏
    showAgentGatewayIcon: evaluateFeatureFlag(config.agent_gateway_icon, userId) !== false,

    showCloudPromotion: evaluateFeatureFlag(config.cloud_promotion, userId),

    showMarket: evaluateFeatureFlag(config.market, userId),
    showMarketStats: evaluateFeatureFlag(config.market_stats, userId),
    enableSTT: evaluateFeatureFlag(config.speech_to_text, userId),

    hideGitHub: evaluateFeatureFlag(config.commercial_hide_github, userId),
    hideDocs: evaluateFeatureFlag(config.commercial_hide_docs, userId),
  };
};

export type IFeatureFlagsState = ReturnType<typeof mapFeatureFlagsEnvToState>;
