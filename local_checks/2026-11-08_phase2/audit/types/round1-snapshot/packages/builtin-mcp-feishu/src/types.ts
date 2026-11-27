/**
 * 飞书 MCP identifier
 */
export const FEISHU_MCP_IDENTIFIER = 'builtin-feishu-mcp';

/**
 * 飞书 MCP 工具名称常量
 */
export const FeishuMcpToolName = {
  SearchDoc: 'search-doc',
  CreateDoc: 'create-doc',
  FetchDoc: 'fetch-doc',
  UpdateDoc: 'update-doc',
  ListDocs: 'list-docs',
  GetComments: 'get-comments',
  AddComments: 'add-comments',
  SearchUser: 'search-user',
  GetUser: 'get-user',
  FetchFile: 'fetch-file',
} as const;

export type FeishuMcpToolNameType = (typeof FeishuMcpToolName)[keyof typeof FeishuMcpToolName];
