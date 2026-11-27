import { getQConfig } from '@lobechat/utils/qconfig';

import { type LobeChatDatabase } from '@/database/type';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';

export const MARKET_AVATAR_QCONFIG_KEY = 'marketAvatar.json';

export interface MarketAvatarQConfig {
  enabled?: boolean;
  model?: string;
  promptTemplate?: string;
  provider?: string;
}

const DEFAULT_PROMPT =
  'Generate a minimal flat app icon for a marketplace item named "{{name}}". Category: {{category}}. Description: {{description}}. Use vibrant colors, no text, square composition.';

export class MarketAvatarService {
  constructor(
    private db: LobeChatDatabase,
    private userId: string,
  ) {}

  generateAvatar = async (params: {
    category?: string;
    description?: string;
    name: string;
  }): Promise<string | undefined> => {
    try {
      const config = getQConfig<MarketAvatarQConfig>(MARKET_AVATAR_QCONFIG_KEY);

      if (!config?.enabled) return undefined;

      const provider = config.provider || 'tripflow';
      const model = config.model || 'gpt-image-1';
      const prompt = (config.promptTemplate || DEFAULT_PROMPT)
        .replaceAll('{{name}}', params.name)
        .replaceAll('{{category}}', params.category || 'other')
        .replaceAll('{{description}}', params.description || params.name);

      const modelRuntime = await initModelRuntimeFromDB(this.db, this.userId, provider);
      if (!modelRuntime.createImage) return undefined;

      const response = await modelRuntime.createImage({
        model,
        params: {
          prompt,
          size: '1024x1024',
        },
      });

      return response?.imageUrl;
    } catch (error) {
      console.error('[MarketAvatarService] generateAvatar failed:', error);
      return undefined;
    }
  };
}
