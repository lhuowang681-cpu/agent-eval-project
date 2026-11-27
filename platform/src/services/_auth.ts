import {
  type AWSBedrockKeyVault,
  type AzureOpenAIKeyVault,
  type ClientSecretPayload,
  type CloudflareKeyVault,
  type ComfyUIKeyVault,
  type OpenAICompatibleKeyVault,
  type VertexAIKeyVault,
} from '@lobechat/types';
import { clientApiKeyManager } from '@lobechat/utils/client';
import { ModelProvider } from 'model-bank';

import { CANARY_IDC_HEADER, CANARY_REQ_HEADER } from '@/const/canary';
import { LOBE_CHAT_AUTH_HEADER, SECRET_XOR_KEY } from '@/envs/auth';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { obfuscatePayloadWithXOR } from '@/utils/client/xor-obfuscation';

import { resolveRuntimeProvider } from './chat/helper';

export const getProviderAuthPayload = (
  provider: string,
  keyVaults: OpenAICompatibleKeyVault &
    AzureOpenAIKeyVault &
    AWSBedrockKeyVault &
    CloudflareKeyVault &
    ComfyUIKeyVault &
    VertexAIKeyVault,
) => {
  switch (provider) {
    case ModelProvider.Bedrock: {
      const { accessKeyId, region, secretAccessKey, sessionToken } = keyVaults;

      const awsSecretAccessKey = secretAccessKey;
      const awsAccessKeyId = accessKeyId;

      const apiKey = (awsSecretAccessKey || '') + (awsAccessKeyId || '');

      return {
        accessKeyId,
        accessKeySecret: awsSecretAccessKey,
        apiKey,
        /** @deprecated */
        awsAccessKeyId,
        /** @deprecated */
        awsRegion: region,
        /** @deprecated */
        awsSecretAccessKey,
        /** @deprecated */
        awsSessionToken: sessionToken,
        region,
        sessionToken,
      };
    }

    case ModelProvider.Azure: {
      return {
        apiKey: clientApiKeyManager.pick(keyVaults.apiKey),

        apiVersion: keyVaults.apiVersion,
        /** @deprecated */
        azureApiVersion: keyVaults.apiVersion,
        baseURL: keyVaults.baseURL || keyVaults.endpoint,
      };
    }

    case ModelProvider.Ollama: {
      return { baseURL: keyVaults?.baseURL };
    }

    case ModelProvider.Cloudflare: {
      return {
        apiKey: clientApiKeyManager.pick(keyVaults?.apiKey),

        baseURLOrAccountID: keyVaults?.baseURLOrAccountID,
        /** @deprecated */
        cloudflareBaseURLOrAccountID: keyVaults?.baseURLOrAccountID,
      };
    }

    case ModelProvider.ComfyUI: {
      return {
        apiKey: keyVaults?.apiKey,
        authType: keyVaults?.authType,
        baseURL: keyVaults?.baseURL,
        customHeaders: keyVaults?.customHeaders,
        password: keyVaults?.password,
        username: keyVaults?.username,
      };
    }

    case ModelProvider.VertexAI: {
      // Vertex AI uses JSON credentials, should not split by comma
      return {
        apiKey: keyVaults?.apiKey,
        baseURL: keyVaults?.baseURL,
        vertexAIRegion: keyVaults?.region,
      };
    }

    default: {
      return { apiKey: clientApiKeyManager.pick(keyVaults?.apiKey), baseURL: keyVaults?.baseURL };
    }
  }
};

const createAuthTokenWithPayload = (payload = {}) => {
  const userId = userProfileSelectors.userId(useUserStore.getState());

  return obfuscatePayloadWithXOR<ClientSecretPayload>({ userId, ...payload }, SECRET_XOR_KEY);
};

interface AuthParams {
  headers?: HeadersInit;
  payload?: Record<string, any>;
  provider?: string;
}

export const createPayloadWithKeyVaults = (provider: string) => {
  const keyVaults =
    aiProviderSelectors.providerKeyVaults(provider)(useAiInfraStore.getState()) || {};

  const runtimeProvider = resolveRuntimeProvider(provider);

  return {
    ...getProviderAuthPayload(runtimeProvider, keyVaults as any),
    runtimeProvider,
  };
};

export const createXorKeyVaultsPayload = (provider: string) => {
  const payload = createPayloadWithKeyVaults(provider);
  return obfuscatePayloadWithXOR(payload, SECRET_XOR_KEY);
};

/**
 * Bastion (canary) routing headers, toggled from Settings > Debug Center.
 * When enabled, every request should be routed to the canary test environment.
 */
export const getCanaryHeaders = (): HeadersInit => {
  const state = useUserStore.getState();

  if (!userGeneralSettingsSelectors.enableCanary(state)) return {};

  return {
    [CANARY_IDC_HEADER]: userGeneralSettingsSelectors.canaryIdc(state),
    [CANARY_REQ_HEADER]: '1',
  };
};

export const createHeaderWithAuth = async (params?: AuthParams): Promise<HeadersInit> => {
  let payload = params?.payload || {};

  if (params?.provider) {
    payload = { ...payload, ...createPayloadWithKeyVaults(params?.provider) };
  }

  const token = createAuthTokenWithPayload(payload);

  return { ...params?.headers, ...getCanaryHeaders(), [LOBE_CHAT_AUTH_HEADER]: token };
};
