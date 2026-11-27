import type { AIChatModelCard } from '../../../types/aiModel';

// export const googleChatModels: AIChatModelCard[] = [
//   {
//     abilities: {
//       // functionCall: true,
//       reasoning: true,
//       structuredOutput: true,
//       vision: true,
//     },
//     contextWindowTokens: 1_048_576 + 65_536,
//     description:
//       'Gemini 3.1 Pro Preview improves on Gemini 3 Pro with enhanced reasoning capabilities (ARC-AGI-2 77.1%) and adds medium thinking level support.',
//     displayName: 'Gemini 3.1 Pro Preview',
//     enabled: false,
//     id: 'gemini-3.1-pro-preview',
//     maxOutput: 65_536,
//     pricing: {
//       units: [
//         // 命中缓存 Token 价格 (Hit cache input tokens)
//         {
//           name: 'textInput_cacheRead',
//           strategy: 'tiered',
//           tiers: [
//             { rate: 0.2, upTo: 200_000 },
//             { rate: 0.4, upTo: 'infinity' },
//           ],
//           unit: 'millionTokens',
//         },
//         // 输入文本 Token 价格
//         {
//           name: 'textInput',
//           strategy: 'tiered',
//           tiers: [
//             { rate: 2, upTo: 200_000 },
//             { rate: 4, upTo: 'infinity' },
//           ],
//           unit: 'millionTokens',
//         },
//         // 输入图片 Token 价格
//         {
//           name: 'imageInput',
//           strategy: 'tiered',
//           tiers: [
//             { rate: 2, upTo: 200_000 },
//             { rate: 4, upTo: 'infinity' },
//           ],
//           unit: 'millionTokens',
//         },
//         // 输入音频 Token 价格
//         {
//           name: 'audioInput',
//           strategy: 'tiered',
//           tiers: [
//             { rate: 2, upTo: 200_000 },
//             { rate: 4, upTo: 'infinity' },
//           ],
//           unit: 'millionTokens',
//         },
//         // 输出文本 Token 价格
//         {
//           name: 'textOutput',
//           strategy: 'tiered',
//           tiers: [
//             { rate: 12, upTo: 200_000 },
//             { rate: 18, upTo: 'infinity' },
//           ],
//           unit: 'millionTokens',
//         },
//       ],
//     },
//     releasedAt: '2026-02-19',
//     settings: {
//       extendParams: ['thinkingLevel3', 'urlContext'],
//       // searchImpl: 'params',
//       // searchProvider: 'google',
//     },
//     type: 'chat',
//   },
// ];

export const googleChatModels: AIChatModelCard[] = [];
