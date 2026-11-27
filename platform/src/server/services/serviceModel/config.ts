import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import type {
  UserDefaultAgent,
  UserSystemAgentConfig,
  UserSystemAgentConfigKey,
} from '@lobechat/types';
import {
  getMemoryAnalysisTaskConfig,
  getQConfigServiceModelTask,
  getServiceModelCredentialSource as resolveServiceModelCredentialSource,
  type ResolvedServiceModelTaskConfig,
  type ServiceModelCredential,
  type ServiceModelTaskKey,
} from '@lobechat/utils/qconfig';

export { getMemoryAnalysisTaskConfig };

export type { ResolvedServiceModelTaskConfig, ServiceModelCredential };

export const getServiceModelTaskConfig = (
  key: ServiceModelTaskKey,
): ResolvedServiceModelTaskConfig => getQConfigServiceModelTask(key);

export const getServiceModelCredentialSource = resolveServiceModelCredentialSource;

export const buildDefaultAgentFromServiceModel = (): UserDefaultAgent['config'] => {
  const { model, provider } = getServiceModelTaskConfig('defaultAgent');
  return { model, provider };
};

const SYSTEM_AGENT_KEYS = Object.keys(DEFAULT_SYSTEM_AGENT_CONFIG) as UserSystemAgentConfigKey[];

export const buildSystemAgentFromServiceModel = (): Partial<UserSystemAgentConfig> => {
  const systemAgent: Partial<UserSystemAgentConfig> = {};

  for (const key of SYSTEM_AGENT_KEYS) {
    const task = getServiceModelTaskConfig(key);
    const defaults = DEFAULT_SYSTEM_AGENT_CONFIG[key];

    if (key === 'queryRewrite') {
      systemAgent.queryRewrite = {
        customPrompt: task.customPrompt ?? defaults.customPrompt,
        enabled: task.enabled ?? defaults.enabled ?? true,
        model: task.model,
        provider: task.provider,
      };
      continue;
    }

    systemAgent[key] = {
      customPrompt: task.customPrompt ?? defaults.customPrompt,
      enabled: task.enabled ?? defaults.enabled,
      model: task.model,
      provider: task.provider,
    };
  }

  return systemAgent;
};
