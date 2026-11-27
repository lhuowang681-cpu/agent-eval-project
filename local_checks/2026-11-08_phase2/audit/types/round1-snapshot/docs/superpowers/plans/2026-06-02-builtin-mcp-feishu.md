# Builtin MCP - 飞书 MCP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将飞书官方 MCP 服务作为内置 MCP 集成到 LobeChat，提供云文档和用户信息等 10 个工具能力。

**Architecture:** 新增 `builtin-mcp-feishu` 单包（硬编码 manifest）和 `builtin-mcps` 聚合包，复用现有 MCP 执行体系。前端通过 `feishuTokenService.getToken()` 获取 UAT 动态注入 headers，后端每次新建 MCPClient 不缓存。

**Tech Stack:** TypeScript, LobeChat MCP SDK (@modelcontextprotocol/sdk), @ctrip/lark-auth, zustand, TRPC

**Spec:** `docs/superpowers/specs/2026-06-02-builtin-mcp-feishu-design.md`
**Manifest 参考数据:** `.local/2026-05-20-feishu-mcp/feishu-mcp/tools-list-result.json`

---

## File Structure

### 新增文件

| 文件                                              | 职责                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `packages/builtin-mcp-feishu/package.json`        | 飞书 MCP 单包配置                                             |
| `packages/builtin-mcp-feishu/src/types.ts`        | identifier 常量 + 工具名称常量                                |
| `packages/builtin-mcp-feishu/src/config.ts`       | 飞书 MCP 连接配置（URL、Allowed-Tools、buildFeishuMcpParams） |
| `packages/builtin-mcp-feishu/src/systemRole.ts`   | 飞书 MCP 系统提示                                             |
| `packages/builtin-mcp-feishu/src/manifest.ts`     | 硬编码 10 个工具的完整 manifest                               |
| `packages/builtin-mcp-feishu/src/client/index.ts` | 前端客户端导出（feishuTokenService 引用）                     |
| `packages/builtin-mcp-feishu/src/index.ts`        | 主导出（manifest + types + config）                           |
| `packages/builtin-mcps/package.json`              | 内置 MCP 聚合包配置                                           |
| `packages/builtin-mcps/src/index.ts`              | 聚合所有内置 MCP manifest                                     |
| `packages/builtin-mcps/src/identifiers.ts`        | 内置 MCP identifier 常量                                      |

### 修改文件

| 文件                                                 | 改动内容                                    |
| ---------------------------------------------------- | ------------------------------------------- |
| `pnpm-workspace.yaml`                                | 已包含 `packages/**`，无需改动              |
| `src/helpers/toolEngineering/index.ts`               | allManifests 中加入 builtinMcpManifests     |
| `src/server/modules/Mecha/AgentToolsEngine/index.ts` | allManifests 中加入 builtinMcpManifests     |
| `src/services/mcp.ts`                                | invokeMcpToolCall 中识别飞书 MCP 并获取 UAT |
| `src/server/services/mcp/index.ts`                   | callTool 中飞书 MCP 不缓存 client           |

---

### Task 1: 创建飞书 MCP 单包基础结构

**Files:**

- Create: `packages/builtin-mcp-feishu/package.json`

- Create: `packages/builtin-mcp-feishu/src/types.ts`

- Create: `packages/builtin-mcp-feishu/src/config.ts`

- Create: `packages/builtin-mcp-feishu/src/systemRole.ts`

- Create: `packages/builtin-mcp-feishu/src/client/index.ts`

- Create: `packages/builtin-mcp-feishu/src/index.ts`

- [ ] **Step 1: 创建 package.json**

参考 `packages/builtin-tool-calculator/package.json` 的格式：

```json
{
  "dependencies": {
    "@lobechat/types": "workspace:*"
  },
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client/index.ts"
  },
  "main": "./src/index.ts",
  "name": "@lobechat/builtin-mcp-feishu",
  "private": true,
  "version": "1.0.0"
}
```

- [ ] **Step 2: 创建 types.ts**

```typescript
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
```

- [ ] **Step 3: 创建 config.ts**

```typescript
import { type HttpMCPClientParams } from '@/libs/mcp/types';

import { FEISHU_MCP_IDENTIFIER, FeishuMcpToolName } from './types';

/** 飞书 MCP 服务端点 */
export const FEISHU_MCP_URL = 'https://mcp.feishu.cn/mcp';

/** 固定的 Allowed-Tools 白名单（所有 10 个工具） */
export const FEISHU_MCP_ALLOWED_TOOLS: string[] = Object.values(FeishuMcpToolName);

/**
 * 构建飞书 MCP 的连接参数
 * 每次调用时需要动态传入 UAT（通过 feishuTokenService.getToken() 获取）
 */
export const buildFeishuMcpParams = (uat: string): HttpMCPClientParams => ({
  type: 'http',
  url: FEISHU_MCP_URL,
  name: FEISHU_MCP_IDENTIFIER,
  headers: {
    'X-Lark-MCP-UAT': uat,
    'X-Lark-MCP-Allowed-Tools': FEISHU_MCP_ALLOWED_TOOLS.join(','),
  },
});
```

注意：`config.ts` 引用了 `@/libs/mcp/types` 的 `HttpMCPClientParams`。由于这个包是独立 package，需要改为从 `@lobechat/types` 或其他 workspace 包引入。需要检查 `HttpMCPClientParams` 是否在 `@lobechat/types` 中导出。

**如果 `HttpMCPClientParams` 不在 `@lobechat/types` 中导出**，则需要在 `package.json` 中添加对包含该类型的包的依赖，或者将 `buildFeishuMcpParams` 移到 `src/services/` 中（因为它只在前端使用）。

- [ ] **Step 4: 创建 systemRole.ts**

飞书 MCP 的 systemRole 用于给模型额外的上下文指引。由于 description 已经很详细，systemRole 可以简短：

```typescript
export const feishuMcpSystemRole = `当使用飞书 MCP 工具时，请注意：
- 所有工具都需要用户通过飞书授权（UAT）才能调用
- 如果调用失败提示授权问题，请告知用户需要重新授权
- 搜索用户时，结果按亲密度排序，请告知用户
- 创建/更新文档时，遵循飞书扩展语法规则（详见各工具描述）
- 文档 ID 可以是 token 或 URL（支持自动解析），不要猜测或伪造`;
```

- [ ] **Step 5: 创建 client/index.ts**

```typescript
// 前端客户端导出
// feishuTokenService 在 src/services/feishuToken.ts 中定义
// 此文件仅作为 client 入口的占位，实际 UAT 获取逻辑在 src/services/mcp.ts 中实现

export { buildFeishuMcpParams } from '../config';
export { FEISHU_MCP_IDENTIFIER } from '../types';
```

- [ ] **Step 6: 创建 index.ts**

```typescript
export { buildFeishuMcpParams, FEISHU_MCP_ALLOWED_TOOLS, FEISHU_MCP_URL } from './config';
export { FeishuMcpManifest } from './manifest';
export { feishuMcpSystemRole } from './systemRole';
export { FEISHU_MCP_IDENTIFIER, FeishuMcpToolName, type FeishuMcpToolNameType } from './types';
```

- [ ] **Step 7: Commit**

```bash
git add packages/builtin-mcp-feishu/
git commit -m "✨ feat: 创建飞书 MCP 单包基础结构（types, config, systemRole, client）"
```

---

### Task 2: 创建飞书 MCP 硬编码 manifest

**Files:**

- Create: `packages/builtin-mcp-feishu/src/manifest.ts`

- [ ] **Step 1: 确认 HttpMCPClientParams 的导出位置**

检查 `HttpMCPClientParams` 是否从 `@lobechat/types` 导出，如果不是，确认 `buildFeishuMcpParams` 函数应该放在哪个位置。如果 `HttpMCPClientParams` 只在 `src/libs/mcp/types.ts` 中定义且不在任何 workspace 包中导出，则 `buildFeishuMcpParams` 应移到 `src/services/mcp.ts` 或 `src/services/feishuToken.ts` 中，`config.ts` 只导出常量。

Run: `grep -rn "HttpMCPClientParams" packages/types/src/ packages/ --include="*.ts" | head -5`

根据结果调整 `config.ts` 中 `buildFeishuMcpParams` 的位置。

- [ ] **Step 2: 创建 manifest.ts**

根据 `.local/2026-05-20-feishu-mcp/feishu-mcp/tools-list-result.json` 中的 10 个工具定义，编写硬编码 manifest。每个工具的 `description` 和 `parameters`（inputSchema）完整保留。

```typescript
import { type LobeToolManifest } from '@lobechat/context-engine';

import { feishuMcpSystemRole } from './systemRole';
import { FEISHU_MCP_IDENTIFIER, FeishuMcpToolName } from './types';

export const FeishuMcpManifest: LobeToolManifest = {
  identifier: FEISHU_MCP_IDENTIFIER,
  type: 'mcp',
  api: [
    {
      name: FeishuMcpToolName.AddComments,
      description:
        '在飞书云文档或知识库页面添加一条全文评论（不是修改正文）。本工具采用严格白名单规则。仅允许使用本描述中明确声明支持的能力。当前仅支持富文本中的文本内容 @用户 和超链接。除上述能力外 任何未在本描述中明确说明支持的内容或行为一律不允许 包括但不限于 图片 截图 附件 文件 表情 Markdown 媒体内容 或其他富文本扩展形式。评论将被追加到文档的全文评论区。AI 禁止 推测 `open_id` 伪造 URL 构造不存在的用户 或生成无效的富文本结构。如需 @ 用户 必须调用 `search-user` 接口获取正确的 `open_id`。若用户请求的能力不在白名单范围内 AI 必须拒绝调用本工具 并明确告知用户不支持。',
      parameters: {
        type: 'object',
        properties: {
          doc_id: {
            description:
              '文档 ID 或文档 URL（支持自动解析）。工具会在该文档的全文评论区域追加一条新评论。AI 不能伪造或猜测。',
            type: 'string',
          },
          elements: {
            description:
              '评论内容的富文本元素数组。每个元素代表评论中的一段文本、一个@用户或一个超链接。元素按顺序组合成最终评论。AI 必须构建格式合法且结构有效的数组，禁止生成文档不支持的类型。重要：mention 类型会自动渲染为 @用户名 样式，无需在 text 元素中额外添加 @ 符号。例如：[{type:text,text:请查看这里},{type:mention,open_id:ou_xxx},{type:link,url:https://example.com}]',
            items: {
              properties: {
                open_id: {
                  description:
                    '被 @ 用户的 open_id。当 type=mention 时必填。如果用户输入 @用户名，AI 必须先调用 search-user 获取 open_id，禁止凭空构造。',
                  type: 'string',
                },
                text: {
                  description: '文本内容。当 type=text 时必填。AI 不得生成空文本元素。',
                  type: 'string',
                },
                type: {
                  description:
                    '元素类型。text 表示纯文本；mention 表示 @ 用户；link 表示超链接。不得使用未定义的类型。',
                  enum: ['text', 'mention', 'link'],
                  type: 'string',
                },
                url: {
                  description:
                    '超链接 URL。当 type=link 时必填，AI 必须确保 URL 是用户提供或明确可得的，禁止凭空生成。',
                  type: 'string',
                },
              },
              required: ['type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['doc_id', 'elements'],
      },
    },
    // ... 其他 9 个工具，完整保留 description 和 inputSchema
    // 每个工具的 name 使用 FeishuMcpToolName 常量
    // inputSchema 中的字段名直接映射为 parameters
  ],
  meta: {
    avatar: '🪽',
    title: 'Feishu MCP',
    description: '飞书云文档与用户信息工具',
  },
  systemRole: feishuMcpSystemRole,
};
```

> **注意：** manifest.ts 文件会很长（因为 create-doc 的 description 有 6000+ 字符），需要完整粘贴 tools-list-result.json 中所有 10 个工具的 description 和 inputSchema。实际实现时需要逐一从 JSON 转换为 TypeScript 对象。

- [ ] **Step 3: 验证 manifest 类型兼容**

确认 `FeishuMcpManifest` 的类型 `LobeToolManifest`（来自 `@lobechat/context-engine`）包含 `systemRole` 字段且 `type` 支持 `'mcp'` 值。

Run: 检查 `packages/context-engine/src/engine/tools/types.ts` 中 `LobeToolManifest.type` 是否包含 `'mcp'`

根据之前调研，`LobeToolManifest.type` 的可选值包含 `'mcp' | 'builtin'`，所以类型兼容。

- [ ] **Step 4: Commit**

```bash
git add packages/builtin-mcp-feishu/src/manifest.ts
git commit -m "✨ feat: 添加飞书 MCP 硬编码 manifest（10 个工具完整定义）"
```

---

### Task 3: 创建内置 MCP 聚合包

**Files:**

- Create: `packages/builtin-mcps/package.json`

- Create: `packages/builtin-mcps/src/identifiers.ts`

- Create: `packages/builtin-mcps/src/index.ts`

- [ ] **Step 1: 创建 package.json**

参考 `packages/builtin-tools/package.json` 的格式：

```json
{
  "dependencies": {
    "@lobechat/builtin-mcp-feishu": "workspace:*",
    "@lobechat/context-engine": "workspace:*"
  },
  "exports": {
    ".": "./src/index.ts"
  },
  "main": "./src/index.ts",
  "name": "@lobechat/builtin-mcps",
  "private": true,
  "version": "1.0.0"
}
```

- [ ] **Step 2: 创建 identifiers.ts**

```typescript
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';

/**
 * 所有内置 MCP identifier 常量
 */
export const builtinMcpIdentifiers = [FEISHU_MCP_IDENTIFIER] as const;

export type BuiltinMcpIdentifier = (typeof builtinMcpIdentifiers)[number];
```

- [ ] **Step 3: 创建 index.ts**

```typescript
import { FeishuMcpManifest } from '@lobechat/builtin-mcp-feishu';
import { type LobeToolManifest } from '@lobechat/context-engine';

import { builtinMcpIdentifiers } from './identifiers';

/**
 * 所有内置 MCP 的 manifest 列表
 * 和 builtin-tools 一样从代码直接获取，不存数据库
 */
export const builtinMcpManifests: LobeToolManifest[] = [FeishuMcpManifest];

export { builtinMcpIdentifiers } from './identifiers';
export type { BuiltinMcpIdentifier } from './identifiers';
```

- [ ] **Step 4: Commit**

```bash
git add packages/builtin-mcps/
git commit -m "✨ feat: 创建内置 MCP 聚合包（builtin-mcps）"
```

---

### Task 4: 将 builtin-mcp manifest 注入到前端 ToolsEngine

**Files:**

- Modify: `src/helpers/toolEngineering/index.ts`

- [ ] **Step 1: 添加 import**

在 `src/helpers/toolEngineering/index.ts` 的 import 区域添加：

```typescript
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
```

- [ ] **Step 2: 在 allManifests 中加入 builtinMcpManifests**

在 `createToolsEngine` 函数中（约第 83-89 行），修改 `allManifests` 数组：

```typescript
// 原来:
const allManifests = [
  ...pluginManifests,
  ...builtinManifests,
  ...klavisManifests,
  ...lobehubSkillManifests,
  ...additionalManifests,
];

// 改为:
const allManifests = [
  ...pluginManifests,
  ...builtinManifests,
  ...builtinMcpManifests,
  ...klavisManifests,
  ...lobehubSkillManifests,
  ...additionalManifests,
];
```

- [ ] **Step 3: Commit**

```bash
git add src/helpers/toolEngineering/index.ts
git commit -m "✨ feat: 前端 ToolsEngine 注入内置 MCP manifest"
```

---

### Task 5: 将 builtin-mcp manifest 注入到后端 ToolsEngine

**Files:**

- Modify: `src/server/modules/Mecha/AgentToolsEngine/index.ts`

- [ ] **Step 1: 添加 import**

在文件顶部 import 区域添加：

```typescript
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
```

- [ ] **Step 2: 在 allManifests 中加入 builtinMcpManifests**

在 `createServerToolsEngine` 函数中（约第 72 行），修改 `allManifests` 数组：

```typescript
// 原来:
const allManifests = [...pluginManifests, ...builtinManifests, ...additionalManifests];

// 改为:
const allManifests = [
  ...pluginManifests,
  ...builtinManifests,
  ...builtinMcpManifests,
  ...additionalManifests,
];
```

- [ ] **Step 3: Commit**

```bash
git add src/server/modules/Mecha/AgentToolsEngine/index.ts
git commit -m "✨ feat: 后端 ToolsEngine 注入内置 MCP manifest"
```

---

### Task 6: 前端 invokeMcpToolCall 添加飞书 MCP UAT 获取逻辑

**Files:**

- Modify: `src/services/mcp.ts`

- [ ] **Step 1: 添加 import**

在 `src/services/mcp.ts` 顶部 import 区域添加：

```typescript
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu/client';
```

同时在文件中已有 import 的位置，确保 `feishuTokenService` 可用：

```typescript
import { feishuTokenService } from './feishuToken';
```

注意：`buildFeishuMcpParams` 函数需要在 `src/services/mcp.ts` 或 `src/services/feishuToken.ts` 中定义（因为 `HttpMCPClientParams` 类型只在 `src/libs/mcp/types.ts` 中定义，不在 workspace 包中导出）。如果 `HttpMCPClientParams` 已从 `@lobechat/types` 导出，则可以保留在 `config.ts` 中。

根据 Task 2 Step 1 的调研结果决定 `buildFeishuMcpParams` 的位置。**这里假设它需要在 `src/services/` 中定义**，因为 `HttpMCPClientParams` 不在 workspace 包中导出。

在 `src/services/feishuToken.ts` 中添加 `buildFeishuMcpParams`：

```typescript
import { type HttpMCPClientParams } from '@/libs/mcp/types';
import { FEISHU_MCP_URL, FEISHU_MCP_ALLOWED_TOOLS } from '@lobechat/builtin-mcp-feishu';
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';

// ... 已有的 feishuTokenService ...

export const buildFeishuMcpParams = (uat: string): HttpMCPClientParams => ({
  type: 'http',
  url: FEISHU_MCP_URL,
  name: FEISHU_MCP_IDENTIFIER,
  headers: {
    'X-Lark-MCP-UAT': uat,
    'X-Lark-MCP-Allowed-Tools': FEISHU_MCP_ALLOWED_TOOLS.join(','),
  },
});
```

相应地，`packages/builtin-mcp-feishu/src/config.ts` 中移除 `buildFeishuMcpParams` 函数（只保留常量），并在 `client/index.ts` 中不再导出它。

- [ ] **Step 2: 在 invokeMcpToolCall 中添加飞书 MCP 识别逻辑**

在 `invokeMcpToolCall` 方法中，在 `const params = { ...connection, name: identifier } as any;` 之前（约第 68 行），添加飞书 MCP 分支：

```typescript
// 飞书 MCP：需要动态获取 UAT
if (identifier === FEISHU_MCP_IDENTIFIER) {
  const uat = await feishuTokenService.getToken();
  // feishuTokenService.getToken() 会自动跳转授权页面
  // 如果获取不到 token，返回错误提示用户重试
  if (!uat) {
    return {
      content: '飞书授权失败，请重试授权后再次使用飞书工具',
      error: { message: 'UAT获取失败' },
      success: false,
    };
  }

  const params = buildFeishuMcpParams(uat);
  const data = {
    args,
    env: undefined,
    meta: {
      customPluginInfo: undefined,
      isCustomPlugin: false,
      sessionId: topicId,
      version: FeishuMcpManifest.version || '1.0.0',
    },
    params,
    toolName: apiName,
  };

  // 飞书 MCP 走 HTTP TRPC 链路（和普通 HTTP MCP 一样）
  result = await toolsClient.mcp.callTool.mutate(data, { signal });
  success = true;
  return result;
}
```

这段逻辑需要在 `if (!plugin) return;` 之后、现有的 params 构建逻辑之前插入。

注意：飞书 MCP 没有 `plugin` 对象（它是内置的，不在 installedPlugins 中），所以 `if (!plugin) return;` 这行逻辑需要调整 —— 飞书 MCP 不依赖 plugin lookup，而是直接走自己的 params 构建路径。

- [ ] **Step 3: 调整 plugin 查找逻辑**

现有的 `if (!plugin) return;` 在飞书 MCP 场景下会导致提前退出。需要在 plugin 查找之后加一个条件：

```typescript
const plugin = installPlugin || customPlugin;

// 飞书 MCP 是内置 MCP，不需要从 plugin store 中查找
if (!plugin && identifier !== FEISHU_MCP_IDENTIFIER) return;
```

- [ ] **Step 4: Commit**

```bash
git add src/services/mcp.ts src/services/feishuToken.ts packages/builtin-mcp-feishu/src/config.ts packages/builtin-mcp-feishu/src/client/index.ts
git commit -m "✨ feat: 前端 invokeMcpToolCall 添加飞书 MCP UAT 获取逻辑"
```

---

### Task 7: 后端 MCPService.callTool 添加飞书 MCP 不缓存逻辑

**Files:**

- Modify: `src/server/services/mcp/index.ts`

- [ ] **Step 1: 添加 import**

在文件顶部 import 区域添加：

```typescript
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';
```

- [ ] **Step 2: 在 callTool 方法中添加飞书 MCP 不缓存逻辑**

在 `callTool` 方法中（约第 225 行），修改 `getClient` 调用：

```typescript
// 原来:
const client = await this.getClient(clientParams);

// 改为:
// 飞书 MCP 不缓存 client（每次 UAT 可能不同）
const client =
  clientParams.name === FEISHU_MCP_IDENTIFIER
    ? await this.createUncachedClient(clientParams)
    : await this.getClient(clientParams);
```

- [ ] **Step 3: 添加 createUncachedClient 方法**

在 `MCPService` 类中添加 `createUncachedClient` 方法：

```typescript
/**
 * 创建不缓存的 MCPClient（用于飞书 MCP 等每次调用需动态认证的场景）
 * 调用完成后需要手动 disconnect
 */
private async createUncachedClient(params: MCPClientParams): Promise<MCPClient> {
  const client = new MCPClient(params);
  await client.initialize({
    onProgress: (progress) => {
      log(`Uncached client initializing... ${progress.progress}/${progress.total}`);
    },
  });
  return client;
}
```

- [ ] **Step 4: 在 callTool 末尾添加 disconnect 逻辑**

在 `callTool` 方法的 `result` 获取之后，添加飞书 MCP client 的 disconnect：

```typescript
// 在获取 result 之后（约第 238 行之后）
const result = await client.callTool(toolName, args);

// 飞书 MCP 不缓存 client，调用完成后断开
if (clientParams.name === FEISHU_MCP_IDENTIFIER) {
  await client.disconnect();
  log('Feishu MCP client disconnected after tool call');
}

// 继续现有的 result 处理逻辑
const processedResult = await MCPService.processToolCallResult(result, processContentBlocksFn);
```

- [ ] **Step 5: Commit**

```bash
git add src/server/services/mcp/index.ts
git commit -m "✨ feat: 后端 MCPService 飞书 MCP 不缓存 client"
```

---

### Task 8: 验证和测试

**Files:**

- Test: 手动验证

- [ ] **Step 1: 运行 type-check**

确认所有新增和修改的文件通过 TypeScript 类型检查：

```bash
bun run type-check
```

Expected: 无类型错误

- [ ] **Step 2: 启动 dev:spa 验证前端**

```bash
bun run dev:spa
```

打开 Debug Proxy URL，确认：

1. 飞书 MCP 在 `<available_tools>` 列表中可见（identifier: `builtin-feishu-mcp`）
2. 勾选飞书 MCP 后，10 个工具定义正确暴露给模型
3. 模型调用飞书工具时，前端正确获取 UAT 并构建 params

- [ ] **Step 3: 测试飞书 MCP 工具调用**

在对话框中：

1. 让模型调用 `activateTools(["builtin-feishu-mcp"])`
2. 确认 10 个飞书工具被激活
3. 让模型调用 `search-doc` 或 `fetch-doc`
4. 确认 UAT 正确注入、MCPClient 正确创建和断开

- [ ] **Step 4: 测试 UAT 获取失败场景**

模拟 UAT 获取失败（如清除 localStorage 中的飞书 token），确认返回错误信息 "飞书授权失败，请重试授权后再次使用飞书工具"

- [ ] **Step 5: Commit（如有修复）**

```bash
git add -A
git commit -m "🐛 fix: 验证飞书 MCP 集成后的修复"
```

---

## Self-Review

**1. Spec coverage:**

- ✅ Manifest 硬编码 → Task 2
- ✅ 复用 MCP 执行体系 → Task 6, 7
- ✅ 前端获取 UAT 动态注入 headers → Task 6
- ✅ MCPClient 不缓存 → Task 7
- ✅ 激活机制和普通 MCP 一致 → Task 4, 5（注入 allManifests 即可）
- ✅ 不存数据库 → 无需额外操作（从代码读取）
- ✅ identifier = builtin-feishu-mcp → Task 1
- ✅ UAT 失败返回错误提示 → Task 6
- ✅ 只支持 UAT → 无 TAT 逻辑
- ✅ 不做自定义渲染 → 无额外 UI 代码
- ✅ 不做 i18n → meta 直接用中文 / 英文原文

**2. Placeholder scan:**

- manifest.ts 中有 `// ... 其他 9 个工具` 注释 → 实际实现时需完整粘贴所有工具定义，不能省略。已在注释中标注 "实际实现时需要逐一从 JSON 转换为 TypeScript 对象"。

**3. Type consistency:**

- `FEISHU_MCP_IDENTIFIER` 在 types.ts 定义为 `'builtin-feishu-mcp'`，所有引用处一致
- `LobeToolManifest` 是 context-engine 包的类型，和 ToolsEngine 的 manifestSchemas 一致
- `HttpMCPClientParams` 的 import 路径需要根据 Task 2 Step 1 的调研结果调整
