import type { AiModelSettings, ModelAbilities, Pricing } from 'model-bank';

/** `ai-infra-config.json` 中 ztrip 远程配置的运行时结构 */
export interface LobehubRemoteZtripModel {
  abilities?: ModelAbilities;
  contextWindowTokens?: number;
  description?: string;
  displayName?: string;
  enabled?: boolean;
  id: string;
  maxOutput?: number;
  organization?: string;
  parameters?: Record<string, unknown>;
  pricing?: Pricing;
  releasedAt?: string;
  settings?: AiModelSettings;
  type?: 'chat' | 'embedding' | 'image' | 'video';
}

export interface LobehubRemoteZtrip {
  /** Ztrip 模型列表 */
  models?: LobehubRemoteZtripModel[];
  /** 白名单用户通过 Peta Key ID 解析运行时网关凭据 */
  petaKeyId?: string;
  tags?: Record<string, string>;
}

export interface LobehubRemoteConfig {
  whitelist: string[];
  ztrip?: LobehubRemoteZtrip;
}
