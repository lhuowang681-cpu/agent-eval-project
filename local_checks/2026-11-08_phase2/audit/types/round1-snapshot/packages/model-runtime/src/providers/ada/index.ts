import { ModelProvider } from 'model-bank';

import type { OpenAICompatibleFactoryOptions } from '../../core/openaiCompatibleFactory';
import { createOpenAICompatibleRuntime } from '../../core/openaiCompatibleFactory';

export const params = {
  baseURL: 'http://ada-cli-golang.ctripcorp.com/coding-plan/v1',
  chatCompletion: {
    cacheControl: true,
    handlePayload: (payload: any) => {
      const { model, messages, ...rest } = payload;
      // 追加 ada- 前缀（Ada 网关要求）
      const adaModel = model.startsWith('ada-') ? model : `ada-${model}`;

      // Ada 网关底层转 Anthropic Messages API，Claude 模型不支持以 assistant 消息结尾（assistant prefill），
      // 否则上游会报："This model does not support assistant message prefill.
      // The conversation must end with a user message." 这里仅对 Claude 模型剥离尾部 assistant 兜底；
      // 非 Claude 模型可能支持 prefill，不误剥。
      // （走 anthropicCompatibleFactory 的通道已有同等保护，ada 走 openai-compatible 通道需在此补齐）
      const sanitizedMessages = Array.isArray(messages) ? [...messages] : messages;
      if (typeof model === 'string' && model.toLowerCase().includes('claude')) {
        while (sanitizedMessages.length > 0 && sanitizedMessages.at(-1)?.role === 'assistant') {
          sanitizedMessages.pop();
        }
      }

      return { ...rest, messages: sanitizedMessages, model: adaModel, stream: rest.stream ?? true };
    },
  },
  debug: {
    chatCompletion: () => process.env.DEBUG_ADA_CHAT_COMPLETION === '1',
  },
  provider: ModelProvider.Ada,
} satisfies OpenAICompatibleFactoryOptions;

export const LobeAdaAI = createOpenAICompatibleRuntime(params);

export default LobeAdaAI;
