import { SERVICE_MODEL_FALLBACK_MODEL, SERVICE_MODEL_FALLBACK_PROVIDER } from '@lobechat/const';
import type { GlobalAnnouncementConfig, UserSystemAgentConfigKey } from '@lobechat/types';
import type { AiFullModelCard, AiModelSettings, AiProviderModelListItem } from 'model-bank';

import { getQConfig } from './qconfig/index.js';

export { getQConfig };

export const AI_INFRA_QCONFIG_KEY = 'ai-infra-config.json';
export const APP_CONFIG_QCONFIG_KEY = 'app-config.json';

export interface QConfigAppConfig {
  announcement?: GlobalAnnouncementConfig;
}

export interface QConfigModelRegistryEntry extends AiFullModelCard {
  displayName: string;
}

export type QConfigProviderModelOverride = Partial<QConfigModelRegistryEntry>;

export interface QConfigProviderEntry {
  enabled?: boolean;
  enabledModels?: string[];
  modelOverrides?: Record<string, QConfigProviderModelOverride>;
  models: string[];
}

export interface QConfigProviderAccessEntry {
  whitelist?: string[];
}

export interface QConfigProviderRuntimeEntry {
  apiKey?: string;
  baseURL?: string;
  petaKeyId?: string;
  tags?: Record<string, string>;
}

export type ServiceModelCredential = 'builtin' | 'user';

export interface QConfigServiceModelTaskEntry {
  credential?: ServiceModelCredential;
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export type ServiceModelTaskKey = 'defaultAgent' | UserSystemAgentConfigKey;

export interface QConfigServiceModelConfig {
  defaultAgent?: QConfigServiceModelTaskEntry;
  systemAgent?: Partial<Record<UserSystemAgentConfigKey, QConfigServiceModelTaskEntry>>;
}

export interface QConfigAiInfraConfig {
  access?: Record<string, QConfigProviderAccessEntry>;
  modelRegistry?: Record<string, QConfigModelRegistryEntry>;
  providers?: Record<string, QConfigProviderEntry>;
  runtime?: Record<string, QConfigProviderRuntimeEntry>;
  serviceModel?: QConfigServiceModelConfig;
}

export interface ResolvedServiceModelTaskConfig {
  credential: ServiceModelCredential;
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export interface ResolvedQConfigModelEntry extends AiProviderModelListItem {
  description?: string;
  maxOutput?: number;
  organization?: string;
}

const mergeModelSettings = (
  base?: AiModelSettings,
  override?: AiModelSettings,
): AiModelSettings | undefined => {
  if (!base) return override;
  if (!override) return base;

  return {
    ...base,
    ...override,
    devParams: override.devParams ?? base.devParams,
    extendParams: override.extendParams ?? base.extendParams,
  };
};

const mergeModelEntry = (
  id: string,
  base: QConfigModelRegistryEntry,
  override: QConfigProviderModelOverride | undefined,
  enabled: boolean,
): ResolvedQConfigModelEntry => {
  return {
    ...base,
    ...override,
    abilities: override?.abilities ?? base.abilities ?? {},
    enabled,
    id,
    settings: mergeModelSettings(base.settings, override?.settings),
  };
};

const normalizeStringArray = (values: string[] | undefined): string[] => {
  if (!values?.length) return [];

  return values.map((value) => value.trim()).filter(Boolean);
};

export const getQConfigAiInfraConfig = (): QConfigAiInfraConfig | null => {
  try {
    return getQConfig(AI_INFRA_QCONFIG_KEY) ?? null;
  } catch {
    return null;
  }
};

export const getQConfigAppConfig = (): QConfigAppConfig | null => {
  try {
    return getQConfig(APP_CONFIG_QCONFIG_KEY) ?? null;
  } catch {
    return null;
  }
};

export const getQConfigAnnouncementConfig = (): GlobalAnnouncementConfig | undefined => {
  const announcement = getQConfigAppConfig()?.announcement;

  if (!announcement?.enabled || !announcement.message?.trim()) return undefined;

  return {
    enabled: true,
    level: announcement.level ?? 'info',
    message: announcement.message.trim(),
    title: announcement.title?.trim() || undefined,
  };
};

export const resolveQConfigProviderModels = (
  providerId: string,
): ResolvedQConfigModelEntry[] | null => {
  const config = getQConfigAiInfraConfig();
  const provider = config?.providers?.[providerId];

  if (!provider) return null;

  const enabledModels = new Set(normalizeStringArray(provider.enabledModels));
  const modelRegistry = config?.modelRegistry ?? {};

  return provider.models.flatMap((modelId) => {
    const base = modelRegistry[modelId];
    if (!base) return [];

    return mergeModelEntry(
      modelId,
      base,
      provider.modelOverrides?.[modelId],
      enabledModels.has(modelId),
    );
  });
};

export const getQConfigProviderAccess = (
  providerId: string,
): QConfigProviderAccessEntry | undefined => {
  const config = getQConfigAiInfraConfig();
  return config?.access?.[providerId];
};

export const getQConfigProviderRuntime = (
  providerId: string,
): QConfigProviderRuntimeEntry | undefined => {
  const config = getQConfigAiInfraConfig();
  return config?.runtime?.[providerId];
};

const normalizeProviderId = (provider: string) => provider.trim().toLowerCase();

export const resolveServiceModelCredential = (
  provider: string,
  credential?: ServiceModelCredential,
): ServiceModelCredential => {
  const normalizedProvider = normalizeProviderId(provider);

  if (normalizedProvider === 'ada') {
    return 'user';
  }

  if (credential === 'builtin') {
    if (normalizedProvider !== 'tripflow') {
      console.error(
        `[qconfig] credential "builtin" is only allowed for tripflow, got provider="${provider}". Falling back to "user".`,
      );
      return 'user';
    }

    return 'builtin';
  }

  if (credential === 'user') {
    return 'user';
  }

  return normalizedProvider === 'tripflow' ? 'builtin' : 'user';
};

export const getQConfigServiceModelConfig = (): QConfigServiceModelConfig | null => {
  const config = getQConfigAiInfraConfig();
  return config?.serviceModel ?? null;
};

const resolveTaskEntry = (
  entry: QConfigServiceModelTaskEntry | undefined,
): ResolvedServiceModelTaskConfig | null => {
  if (!entry?.provider || !entry?.model) return null;

  const provider = entry.provider.trim();
  const model = entry.model.trim();

  return {
    credential: resolveServiceModelCredential(provider, entry.credential),
    customPrompt: entry.customPrompt,
    enabled: entry.enabled,
    model,
    provider,
  };
};

const getFallbackTaskConfig = (): ResolvedServiceModelTaskConfig => ({
  credential: 'user',
  model: SERVICE_MODEL_FALLBACK_MODEL,
  provider: SERVICE_MODEL_FALLBACK_PROVIDER,
});

export const getMemoryAnalysisTaskConfig = (): ResolvedServiceModelTaskConfig | null =>
  resolveTaskEntry(getQConfigServiceModelConfig()?.systemAgent?.memoryAnalysis);

export const getQConfigServiceModelTask = (
  key: ServiceModelTaskKey,
): ResolvedServiceModelTaskConfig => {
  const serviceModel = getQConfigServiceModelConfig();

  if (key === 'defaultAgent') {
    return resolveTaskEntry(serviceModel?.defaultAgent) ?? getFallbackTaskConfig();
  }

  return resolveTaskEntry(serviceModel?.systemAgent?.[key]) ?? getFallbackTaskConfig();
};

export const getServiceModelCredentialSource = (
  provider: string,
  credential?: ServiceModelCredential,
): ServiceModelCredential => resolveServiceModelCredential(provider, credential);
