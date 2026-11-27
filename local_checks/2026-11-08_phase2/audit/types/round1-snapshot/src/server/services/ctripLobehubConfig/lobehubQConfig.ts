import type { ResolvedQConfigModelEntry } from '@lobechat/utils/qconfig';
import {
  getQConfigProviderAccess,
  getQConfigProviderRuntime,
  resolveQConfigProviderModels,
} from '@lobechat/utils/qconfig';

import type { LobehubRemoteConfig, LobehubRemoteZtrip, LobehubRemoteZtripModel } from './types';

const normalizeOptionalString = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeZtripModelType = (
  type: ResolvedQConfigModelEntry['type'],
): LobehubRemoteZtripModel['type'] => {
  if (type === 'embedding' || type === 'image' || type === 'video') return type;

  return 'chat';
};

const normalizeModels = (
  models: ResolvedQConfigModelEntry[] | null | undefined,
): LobehubRemoteZtripModel[] | undefined => {
  if (!models?.length) return undefined;

  return models.map((model) => ({
    abilities: model.abilities ?? {},
    contextWindowTokens: model.contextWindowTokens,
    description: normalizeOptionalString(model.description),
    displayName: normalizeOptionalString(model.displayName) ?? model.id,
    enabled: model.enabled !== false,
    id: model.id,
    maxOutput: model.maxOutput,
    organization: normalizeOptionalString(model.organization),
    parameters: model.parameters,
    pricing: model.pricing,
    releasedAt: normalizeOptionalString(model.releasedAt),
    settings: model.settings,
    type: normalizeZtripModelType(model.type),
  }));
};

const normalizeWhitelist = (whitelist: string[] | undefined): string[] =>
  whitelist?.map((value) => String(value).trim()).filter(Boolean) ?? [];

const normalizeTags = (
  tags: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!tags) return undefined;

  const normalized = Object.fromEntries(
    Object.entries(tags)
      .map(([key, value]) => [key.trim(), value.trim()])
      .filter(([key, value]) => key && value),
  );

  return Object.keys(normalized).length ? normalized : undefined;
};

const normalizeZtrip = (): LobehubRemoteZtrip | undefined => {
  const runtime = getQConfigProviderRuntime('ztrip');
  const models = resolveQConfigProviderModels('ztrip');
  const petaKeyId = normalizeOptionalString(runtime?.petaKeyId);
  const tags = normalizeTags(runtime?.tags);

  if (!petaKeyId && !tags && !models?.length) return undefined;

  return {
    models: normalizeModels(models),
    petaKeyId,
    tags,
  };
};

export const getLobehubRemoteConfig = async (): Promise<LobehubRemoteConfig | null> => {
  const whitelist = normalizeWhitelist(getQConfigProviderAccess('ztrip')?.whitelist);
  const ztrip = normalizeZtrip();

  if (!whitelist.length && !ztrip) return null;

  return {
    whitelist,
    ztrip,
  };
};
