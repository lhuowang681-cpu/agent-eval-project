import type { OpenAIChatMessage } from '@lobechat/model-runtime';

const MEMORY_EXTRACTION_ROLES = new Set<OpenAIChatMessage['role']>(['assistant', 'user']);

export const sanitizeMemoryExtractionMessages = (
  messages: OpenAIChatMessage[] | undefined,
): OpenAIChatMessage[] => {
  if (!messages?.length) return [];

  return messages.flatMap((message) => {
    if (!MEMORY_EXTRACTION_ROLES.has(message.role)) return [];

    const content =
      typeof message.content === 'string'
        ? message.content.trim()
        : Array.isArray(message.content)
          ? message.content
              .map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'thinking') return `[Thinking: ${part.thinking}]`;
                return '';
              })
              .join('\n')
              .trim()
          : '';

    if (!content) return [];

    return [{ content, role: message.role }];
  });
};
