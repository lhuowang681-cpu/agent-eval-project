import type { AIChatModelCard } from '../types/aiModel';

/** Ztrip 模型由服务端从统一的 `ai-infra-config.json` 注入，这里保持空数组。 */
const ztripChatModels: AIChatModelCard[] = [];

export const allModels = [...ztripChatModels];

export default allModels;
