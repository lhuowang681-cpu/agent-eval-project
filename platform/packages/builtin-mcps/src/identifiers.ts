import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';

/**
 * 所有内置 MCP identifier 常量
 */
export const builtinMcpIdentifiers = [FEISHU_MCP_IDENTIFIER] as const;

export type BuiltinMcpIdentifier = (typeof builtinMcpIdentifiers)[number];
