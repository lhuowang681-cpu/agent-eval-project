import type { AIChatModelCard } from '../../../types/aiModel';

export const anthropicChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Opus 4.6 is Anthropic's most intelligent model for building agents and coding.",
    displayName: 'Claude Opus 4.6',
    enabled: false,
    id: 'claude-opus-4-6-v1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['enableAdaptiveThinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description: "Claude Sonnet 4.6 is Anthropic's best combination of speed and intelligence.",
    displayName: 'Claude Sonnet 4.6',
    enabled: false,
    id: 'claude-sonnet-4-6',
    maxOutput: 64_000,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.33, upTo: 200_000 },
            { rate: 0.66, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 3.3, upTo: 200_000 },
            { rate: 6.6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 16.5, upTo: 200_000 },
            { rate: 24.75, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheWrite',
          strategy: 'tiered',
          tiers: [
            { rate: 4.125, upTo: 200_000 },
            { rate: 8.25, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-18',
    settings: {
      extendParams: ['enableAdaptiveThinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      structuredOutput: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Haiku 4.5 is Anthropic's fastest and most intelligent Haiku model, with lightning speed and extended thinking.",
    displayName: 'Claude Haiku 4.5',
    enabled: false,
    id: 'claude-haiku-4-5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-16',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];
