/**
 * Header keys that must be published to market with empty values.
 * Installers fill in their own credentials after installing.
 */
export const MARKET_MASKED_HEADER_KEYS = ['x-bbzai-mcp-token'] as const;

const SENSITIVE_HEADER_KEYWORDS = [
  'token',
  'password',
  'secret',
  'key',
  'auth',
  'credential',
  'api-key',
] as const;

const shouldMaskHeaderKey = (headerKey: string): boolean => {
  const lowerKey = headerKey.toLowerCase();

  if (MARKET_MASKED_HEADER_KEYS.some((key) => key.toLowerCase() === lowerKey)) {
    return true;
  }

  return SENSITIVE_HEADER_KEYWORDS.some((keyword) => lowerKey.includes(keyword));
};

/**
 * Mask sensitive header values for market display and storage.
 * Keeps all header keys so installers know what to configure.
 */
export const maskSensitiveHeaders = (
  headers?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!headers) return undefined;

  const masked: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    masked[key] = shouldMaskHeaderKey(key) ? '' : value;
  }

  return masked;
};
