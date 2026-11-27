export const LLMProviderConfigKey = 'languageModel';
export const KeyVaultsConfigKey = 'keyVaults';

/**
 * we use this key to define default api key
 * equal GOOGLE_API_KEY or ZHIPU_API_KEY
 */
export const LLMProviderApiTokenKey = 'apiKey';

/**
 * we use this key to define the baseURL
 * equal OPENAI_PROXY_URL
 */
export const LLMProviderBaseUrlKey = 'baseURL';

/**
 * TripFlow/Peta gateway key id. The server resolves real baseURL/apiKey via Peta SDK.
 */
export const LLMProviderPetaKeyIdKey = 'petaKeyId';

/**
 * we use this key to define the custom model name
 * equal CUSTOM_MODELS
 */
export const LLMProviderModelListKey = 'enabledModels';
