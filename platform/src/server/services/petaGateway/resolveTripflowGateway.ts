import { resolvePetaLlmGateway } from '@ctrip/peta-ai-client';
import { eq } from 'drizzle-orm';

import { users } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';

export const TRIPFLOW_MISSING_PETA_KEY_ID_MESSAGE = 'TripFlow petaKeyId is required';
export const ZTRIP_MISSING_PETA_KEY_ID_MESSAGE = 'Ztrip petaKeyId is required';
export const TRIPFLOW_MISSING_USERNAME_MESSAGE = '请通过 Ctrip SSO 登录后再使用 Peta 模型服务';

export const MISSING_PETA_KEY_ID_ERROR_TYPE = 'missing_peta_key_id';
export const MISSING_PETA_USERNAME_ERROR_TYPE = 'missing_peta_username';

export class PetaGatewayConfigError extends Error {
  provider: string;
  type: string;

  constructor(message: string, type: string, provider: string) {
    super(message);
    this.name = 'PetaGatewayConfigError';
    this.provider = provider;
    this.type = type;
  }
}

export const TripflowGatewayConfigError = PetaGatewayConfigError;

export const normalizePetaKeyId = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith('peta-')) return trimmed;

  return `peta-${trimmed}`;
};

const getUsernameByUserId = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<string | null> => {
  const row = await db.query.users.findFirst({
    columns: { username: true },
    where: eq(users.id, userId),
  });

  const username = row?.username;
  return typeof username === 'string' && username.trim() ? username.trim() : null;
};

const getMissingPetaKeyIdMessage = (provider: string) =>
  provider === 'ztrip' ? ZTRIP_MISSING_PETA_KEY_ID_MESSAGE : TRIPFLOW_MISSING_PETA_KEY_ID_MESSAGE;

interface ResolvePetaRuntimeCredentialParams {
  db: LobeChatDatabase;
  petaKeyId?: string;
  provider: string;
  tags?: Record<string, string>;
  userId: string;
}

export const resolvePetaRuntimeCredential = async ({
  db,
  petaKeyId,
  provider,
  tags,
  userId,
}: ResolvePetaRuntimeCredentialParams) => {
  if (!petaKeyId?.trim()) {
    throw new PetaGatewayConfigError(
      getMissingPetaKeyIdMessage(provider),
      MISSING_PETA_KEY_ID_ERROR_TYPE,
      provider,
    );
  }

  const username = await getUsernameByUserId(db, userId);

  if (!username) {
    throw new PetaGatewayConfigError(
      TRIPFLOW_MISSING_USERNAME_MESSAGE,
      MISSING_PETA_USERNAME_ERROR_TYPE,
      provider,
    );
  }

  const normalizedPetaKeyId = normalizePetaKeyId(petaKeyId);
  const gateway = await resolvePetaLlmGateway(normalizedPetaKeyId, {
    ...tags,
    user: username,
  });

  return {
    apiKey: gateway.apiKey,
    baseURL: gateway.baseUrl,
    petaKeyId: gateway.petaKeyId ?? normalizedPetaKeyId,
  };
};

export const resolveTripflowRuntimeCredential = (
  params: Omit<ResolvePetaRuntimeCredentialParams, 'provider'>,
) => resolvePetaRuntimeCredential({ ...params, provider: 'tripflow' });
