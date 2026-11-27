import type { AiFullModelCard } from 'model-bank';

import type { LobehubRemoteConfig, LobehubRemoteZtripModel } from './types';

const mapRemoteModelsToBuiltin = (models: LobehubRemoteZtripModel[]): AiFullModelCard[] =>
  models.map((model) => ({
    abilities: model.abilities ?? {},
    contextWindowTokens: model.contextWindowTokens,
    description: model.description,
    displayName: model.displayName ?? model.id,
    enabled: model.enabled !== false,
    id: model.id,
    organization: model.organization,
    parameters: model.parameters as AiFullModelCard['parameters'],
    pricing: model.pricing,
    releasedAt: model.releasedAt,
    settings: model.settings,
    type: model.type ?? 'chat',
  }));

export const isUsernameWhitelistedForZtrip = (
  username: string | null | undefined,
  remote: LobehubRemoteConfig | null,
): boolean => {
  if (!remote?.whitelist?.length || !username) return false;

  return remote.whitelist.includes(username.trim());
};

export const remoteZtripModelsAsServerList = (
  remote: LobehubRemoteConfig | null,
): AiFullModelCard[] | undefined => {
  const models = remote?.ztrip?.models;
  if (!models?.length) return undefined;

  return mapRemoteModelsToBuiltin(models);
};
