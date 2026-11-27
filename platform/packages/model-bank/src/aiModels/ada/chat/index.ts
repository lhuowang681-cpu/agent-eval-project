import type { AIChatModelCard } from '../../../types/aiModel';
import { anthropicChatModels } from './anthropic';
import { googleChatModels } from './google';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { qwenChatModels } from './qwen';
import { zhipuChatModels } from './zhipu';

export const adaChatModels: AIChatModelCard[] = [
  ...anthropicChatModels,
  ...googleChatModels,
  ...minimaxChatModels,
  ...moonshotChatModels,
  ...qwenChatModels,
  ...zhipuChatModels,
];

export { anthropicChatModels } from './anthropic';
export { googleChatModels } from './google';
export { minimaxChatModels } from './minimax';
export { moonshotChatModels } from './moonshot';
export { qwenChatModels } from './qwen';
export { zhipuChatModels } from './zhipu';
