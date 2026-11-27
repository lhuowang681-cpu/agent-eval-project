export const TRIPFLOW_PETA_KEY_ID_PATTERN = /^(?:peta-)?\d+$/;

const LEGACY_BASE_URL_PATTERN = /\/llm\/(\d+)(?:\/|$)/;

export const extractLegacyPetaKeyIdFromBaseURL = (baseURL?: string): string | undefined => {
  if (!baseURL) return undefined;

  const match = LEGACY_BASE_URL_PATTERN.exec(baseURL);
  const candidate = match?.[1];
  if (!candidate) return undefined;

  return TRIPFLOW_PETA_KEY_ID_PATTERN.test(candidate) ? candidate : undefined;
};
