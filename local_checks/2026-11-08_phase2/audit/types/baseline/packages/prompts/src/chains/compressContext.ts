import type { ChatStreamPayload, UIChatMessage } from '@lobechat/types';

import {
  compressContextSystemPrompt,
  compressContextUserPrompt,
  compressionHistoryPrompts,
} from '../prompts';

/**
 * Chain for compressing conversation context into a summary
 * Used when conversation history exceeds token threshold
 */
export const chainCompressContext = (messages: UIChatMessage[]): Partial<ChatStreamPayload> => ({
  messages: [
    {
      content: compressContextSystemPrompt,
      role: 'system',
    },
    {
      content: `${compressionHistoryPrompts(messages)}

${compressContextUserPrompt}`,
      role: 'user',
    },
  ],
});
