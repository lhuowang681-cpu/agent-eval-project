import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export interface ZtripOpenAIModelCard {
  id: string;
}

export const params = {
  baseURL: 'https://api.openai.com/v1',
  chatCompletion: {
    cacheControl: true,
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ZTRIP_CHAT_COMPLETION === '1',
  },
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: ZtripOpenAIModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) =>
            model.id.toLowerCase() === m.id.toLowerCase() && m.providerId === ModelProvider.Ztrip,
        );

        return {
          contextWindowTokens: knownModel?.contextWindowTokens ?? undefined,
          displayName: knownModel?.displayName ?? undefined,
          enabled: knownModel?.enabled || false,
          functionCall: knownModel?.abilities?.functionCall || false,
          id: model.id,
          reasoning: knownModel?.abilities?.reasoning || false,
          vision: knownModel?.abilities?.vision || false,
        };
      })
      .filter(Boolean) as ChatModelCard[];
  },
  provider: ModelProvider.Ztrip,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeZtripAI = createOpenAICompatibleRuntime(params, {
  chatMethodOptions: (payload, options) => {
    if (payload.model.includes('claude')) {
      return {
        ...options,
        requestHeaders: {
          'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
        },
      };
    }
    return options || {};
  },
});
