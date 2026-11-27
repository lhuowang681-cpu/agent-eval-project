export const BBZAI_MCP_TOKEN_HEADER = 'x-bbzai-mcp-token';
const INTERNAL_NPM_PACKAGE_PATTERN = /(?:^|[\s=])@ctrip\/[^\s=]+/;

export const MCP_ADA_TOKEN_MARKET_URL =
  'http://aicoding.console.ctripcorp.com/admin/personal/ada-config';

export const MCP_ADA_TOKEN_INSTRUCTION =
  '点击链接进入 ada-config 页面，复制您的 ada_token 后粘贴到输入框。';

export const MCP_ADA_TOKEN_PLACEHOLDER = 'ada_xxx';

interface McpAdaTokenHeaderTarget {
  args?: string[];
  command?: string;
  packageName?: string;
  url?: string;
}

const normalizeToken = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return;

  const token = value.trim();
  return token || undefined;
};

const isInternalCtripcorpUrl = (value?: string): boolean => {
  if (!value) return false;

  try {
    return new URL(value).hostname.toLowerCase().includes('.ctripcorp.');
  } catch {
    return false;
  }
};

export const parseMcpAdaTokenInput = (input: string): string | undefined => {
  return normalizeToken(input);
};

export const hasBbzaiMcpTokenHeader = (headers?: Record<string, string>): boolean => {
  if (!headers) return false;

  return Object.entries(headers).some(
    ([key, value]) =>
      key.toLowerCase() === BBZAI_MCP_TOKEN_HEADER && Boolean(normalizeToken(value)),
  );
};

export const shouldInjectBbzaiMcpTokenHeader = (params: McpAdaTokenHeaderTarget): boolean => {
  if (isInternalCtripcorpUrl(normalizeToken(params.url))) return true;

  const packageCandidates = [params.packageName, params.command, ...(params.args || [])];
  return packageCandidates.some((item) => {
    const value = normalizeToken(item);
    return value ? INTERNAL_NPM_PACKAGE_PATTERN.test(value) : false;
  });
};

export const withBbzaiMcpTokenHeader = <
  T extends McpAdaTokenHeaderTarget & { headers?: Record<string, string> },
>(
  params: T,
  fallbackToken?: string | null,
): T => {
  const token = normalizeToken(fallbackToken);
  if (
    !token ||
    !shouldInjectBbzaiMcpTokenHeader(params) ||
    hasBbzaiMcpTokenHeader(params.headers)
  ) {
    return params;
  }

  return {
    ...params,
    headers: {
      ...params.headers,
      [BBZAI_MCP_TOKEN_HEADER]: token,
    },
  };
};

export const maskMcpAdaToken = (token?: string | null) => {
  const normalized = normalizeToken(token);
  if (!normalized) return '';
  if (normalized.length <= 12) return '********';

  return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
};
