import type { ChatModelCard } from '@lobechat/types';
import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';
import { createTripflowImage } from './image/createImage';
import { createVideo } from './video/createVideo';
import { handleCreateVideoWebhook } from './video/handleCreateVideoWebhook';

export interface TripflowOpenAIModelCard {
  id: string;
}

export const params = {
  chatCompletion: {
    cacheControl: true,
  },
  createImage: createTripflowImage,
  createVideo,
  debug: {
    chatCompletion: () => process.env.DEBUG_TRIPFLOW_CHAT_COMPLETION === '1',
  },
  handleCreateVideoWebhook,
  models: async ({ client }) => {
    const { LOBE_DEFAULT_MODEL_LIST } = await import('model-bank');

    const modelsPage = (await client.models.list()) as any;
    const modelList: TripflowOpenAIModelCard[] = modelsPage.data;

    return modelList
      .map((model) => {
        const knownModel = LOBE_DEFAULT_MODEL_LIST.find(
          (m) =>
            model.id.toLowerCase() === m.id.toLowerCase() &&
            m.providerId === ModelProvider.Tripflow,
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
  // Tripflow / MiniMax models may return prose instead of json_schema output.
  // Qwen3 models default to thinking mode which is incompatible with tool_choice;
  // disable thinking for all generateObject tool-calling requests.
  generateObject: {
    toolsCallingExtraParams: { enable_thinking: false },
    useToolsCalling: true,
  },
  provider: ModelProvider.Tripflow,
} satisfies OpenAICompatibleFactoryOptions;

export const tripFlowAI = createOpenAICompatibleRuntime(params, {
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

// Alias for test compatibility
export const LobeTripflowAI = tripFlowAI;
