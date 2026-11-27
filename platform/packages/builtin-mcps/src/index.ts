import { FeishuMcpManifest } from '@lobechat/builtin-mcp-feishu';
import { type LobeToolManifest } from '@lobechat/context-engine';

/**
 * 所有内置 MCP 的 manifest 列表
 * 和 builtin-tools 一样从代码直接获取，不存数据库
 */
export const builtinMcpManifests: LobeToolManifest[] = [FeishuMcpManifest];

export type { BuiltinMcpIdentifier } from './identifiers';
export { builtinMcpIdentifiers } from './identifiers';
