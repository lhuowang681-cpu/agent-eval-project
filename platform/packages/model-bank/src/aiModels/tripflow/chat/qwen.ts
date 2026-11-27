import type { AIChatModelCard } from '../../../types/aiModel';

export const qwenChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 Plus is a versatile multimodal model with strong text, vision, and agent capabilities.',
    displayName: 'Qwen3.6 Plus',
    enabled: false,
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 256_000 },
            { rate: 8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 12, upTo: 256_000 },
            { rate: 48, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 2.5, upTo: 256_000 },
            { rate: 10, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 256_000 },
            { rate: 0.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-01',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];
