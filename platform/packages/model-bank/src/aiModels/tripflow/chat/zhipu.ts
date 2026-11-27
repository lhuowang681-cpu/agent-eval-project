import type { AIChatModelCard } from '../../../types/aiModel';

export const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 198_000,
    description:
      'GLM-5.1 是我们面向智能体工程（agentic engineering）的下一代旗舰模型，其代码能力相比前代显著增强。它在 SWE-Bench Pro 上达到了当前最优水平，并在 NL2Repo（仓库生成）和 Terminal-Bench 2.0（真实终端任务）上大幅领先于 GLM-5。 但更有意义的飞跃并不仅限于首次通过的表现。以往的模型（包括 GLM-5）往往过早耗尽其策略库：它们会快速应用熟悉的技巧取得初步成果，随后便陷入停滞。即使给予更多时间也无济于事。 相比之下，GLM-5.1 的设计目标是在智能体任务中维持更长时间的有效性。我们发现，该模型能以更好的判断力处理模糊问题，并在更长的会话中保持高效产出。它能够分解复杂问题、运行实验、解读结果，并精准识别阻碍因素。通过不断回顾自身推理过程并反复迭代调整策略，GLM-5.1 能在数百轮次和数千次工具调用中持续优化。运行时间越长，结果越好。',
    displayName: 'GLM-5.1',
    enabled: false,
    id: 'GLM-5.1',
    maxOutput: 65_536,
    organization: 'Zhipu',
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 4, upTo: 32_000 },
            { rate: 6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 18, upTo: 32_000 },
            { rate: 22, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.8, upTo: 32_000 },
            { rate: 1.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-08',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 198_000,
    description: 'GLM-5.1 阿里云版本，通过阿里云平台提供服务，继承 GLM-5.1 全部能力。',
    displayName: 'GLM-5.1 (Ali)',
    enabled: true,
    id: 'glm-5.1-ali',
    maxOutput: 65_536,
    organization: 'Zhipu',
    releasedAt: '2026-04-08',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];
