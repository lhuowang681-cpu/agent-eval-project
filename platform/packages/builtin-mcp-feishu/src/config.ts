import { FeishuMcpToolName } from './types';

/** 飞书 MCP 服务端点 */
export const FEISHU_MCP_URL = 'https://mcp.feishu.cn/mcp';

/** 固定的 Allowed-Tools 白名单（所有 10 个工具） */
export const FEISHU_MCP_ALLOWED_TOOLS: string[] = Object.values(FeishuMcpToolName);

/**
 * 飞书登录授权请求的 scope —— 单一数据源在零依赖叶子包 `@lobechat/feishu-auth-scopes`，
 * 此处转出供 web 端按原路径 `@lobechat/builtin-mcp-feishu` 引用（desktop 直接引那个叶子包）。
 */
export { FEISHU_LOGIN_SCOPES } from '@lobechat/feishu-auth-scopes';
