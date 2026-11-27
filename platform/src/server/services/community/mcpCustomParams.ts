import { maskSensitiveHeaders } from '@/utils/mcpHeaders';

interface McpConnectionConfig {
  args?: unknown[];
  auth?: Record<string, unknown>;
  command?: string;
  description?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  type?: string;
  url?: string;
}

export interface McpCustomParamsPayload {
  avatar?: string;
  description?: string;
  mcp?: McpConnectionConfig;
  mcpServers?: Record<string, McpConnectionConfig>;
  type?: string;
}

const inferMcpConnectionType = (connection?: McpConnectionConfig): string | undefined => {
  if (!connection) return;
  if (connection.type) return connection.type;
  if (connection.command) return 'stdio';
  if (connection.url) return 'http';
};

const getMcpConnection = (
  customParams?: McpCustomParamsPayload | null,
): McpConnectionConfig | undefined => {
  if (!customParams) return undefined;
  if (customParams.mcp) return customParams.mcp;

  const firstMcpServer = customParams.mcpServers
    ? Object.values(customParams.mcpServers).find((server) => server && typeof server === 'object')
    : undefined;
  if (firstMcpServer) return firstMcpServer;

  return customParams as McpConnectionConfig;
};

export const getMcpConnectionType = (customParams?: McpCustomParamsPayload | null): string => {
  const mcp = getMcpConnection(customParams);
  return inferMcpConnectionType(mcp) || customParams?.type || 'http';
};

/**
 * Sanitize MCP customParams before writing to market_mcps.
 * Preserves header keys but masks sensitive values for installers to fill in.
 */
export const sanitizeMcpCustomParamsForMarket = (
  customParams?: McpCustomParamsPayload | null,
): McpCustomParamsPayload | undefined => {
  if (!customParams) return undefined;

  const mcp = getMcpConnection(customParams);
  if (!mcp) return customParams;

  const sanitizedMcp: McpConnectionConfig = {
    ...mcp,
    type: inferMcpConnectionType(mcp),
  };

  if (mcp.headers) {
    sanitizedMcp.headers = maskSensitiveHeaders(mcp.headers);
  }

  if (customParams.mcp) {
    return {
      ...customParams,
      mcp: sanitizedMcp,
    };
  }

  return {
    ...customParams,
    mcp: sanitizedMcp,
  };
};
