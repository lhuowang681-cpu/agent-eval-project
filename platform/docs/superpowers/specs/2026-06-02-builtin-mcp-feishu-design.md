status: approved

# Builtin MCP - 飞书 MCP 设计文档

## 概述

在 LobeChat 的 `packages/` 下新增 `builtin-mcps`（内置 MCP 聚合包）和 `builtin-mcp-feishu`（飞书 MCP 单包），将飞书官方 MCP 服务作为内置 MCP 集成到系统中。飞书 MCP 提供云文档（搜索、创建、查看、更新、评论）和用户信息（搜索、获取）等 9 个工具能力。

## 设计决策记录

### 1. Manifest 策略：硬编码

飞书 MCP 的 9 个工具以硬编码 manifest 形式定义（name + description + inputSchema），不从飞书 `tools/list` API 动态获取。

**理由**：

- 飞书 MCP 工具列表很少更新，硬编码足够可靠
- 避免每次启动都调用 `initialize` + `tools/list` 的开销
- 和 builtin-tool 的 manifest 策略一致（从代码直接读取，不存数据库）
- Description 完整保留（包含飞书扩展语法参考等详细指南），这是模型正确使用工具所需的信息

### 2. 执行链路：复用现有 MCP 执行体系

飞书 MCP 的工具执行完全复用现有的 `MCPService → MCPClient → MCP SDK` 链路，不自己实现 HTTP JSON-RPC 调用。

**理由**：

- 避免重复实现飞书的 JSON-RPC 2.0 调用逻辑
- MCP SDK 已经处理了连接、超时、错误等基础设施
- 和用户配置的 MCP 保持一致的执行链路，降低维护成本

### 3. 认证方式：前端获取 UAT，动态注入 headers

每次飞书 MCP 工具调用时：

1. 前端识别飞书 MCP → 调用 `auth.getUserAccessToken()` 获取 UAT
2. UAT 注入到 `X-Lark-MCP-UAT` header
3. `X-Lark-MCP-Allowed-Tools` header 固定硬编码所有 9 个工具名
4. 通过现有 TRPC `mcp.callTool` body 传给后端

**理由**：

- `auth.getUserAccessToken()` 已封装好授权和刷新逻辑
- 和现有 MCP 调用链路一致（前端拼 headers → TRPC body → 后端）
- UAT 只能在前端获取，所以注入点在前端

### 4. MCPClient 缓存：不缓存飞书 MCP client

因为每次调用时 UAT 可能不同（动态获取、可能过期刷新），飞书 MCP 的 MCPClient 不缓存。每次调用创建新 client，调用完成后断开。

**理由**：

- 现有 MCPClient 缓存 key 基于 serialized params，UAT 变化会导致每次都创建新 client
- 不缓存更简单，避免缓存失效 / 过期问题
- 飞书 MCP 调用频率不高，创建开销可接受

### 5. 激活机制：和普通 MCP 完全一致

飞书 MCP 的激活机制和用户配置的 MCP 一致：

- **动态激活**：通过 `lobe-tools` 的 `activateTools` API + `<available_tools>` 列表
- **勾选激活**：用户在 UI 勾选后直接暴露给模型
- 不需要特殊的激活逻辑

**理由**：

- 保持一致性，降低开发和理解成本
- `activateTools` 机制已经完善，不需要额外设计

### 6. 存储策略：不存数据库

飞书 MCP 的 manifest 和 builtin-tool 一样从代码直接读取，不存数据库。

**理由**：

- manifest 是固定的，对所有用户都一样
- 用户授权状态由 `auth.getUserAccessToken` 管理，不需要额外数据库字段
- 和 builtin-tool 的存储策略一致

## 架构设计

### 包结构

```
packages/
├── builtin-mcps/                    # 内置 MCP 聚合包（@lobechat/builtin-mcps）
│   ├── package.json
│   └── src/
│       ├── index.ts                 # 聚合所有内置 MCP manifest
│       └── identifiers.ts           # 内置 MCP identifier 常量
│
├── builtin-mcp-feishu/              # 飞书 MCP 单包（@lobechat/builtin-mcp-feishu）
│   ├── package.json
│   └── src/
│       ├── index.ts                 # 导出 manifest + types
│       ├── manifest.ts             # 硬编码的飞书 MCP manifest
│       ├── types.ts                 # 工具名称常量、参数类型
│       ├── systemRole.ts            # 飞书 MCP 的系统提示
│       └── client/
│       │   └── index.ts             # 前端客户端导出
│       └── config.ts                # 飞书 MCP 连接配置常量
```

### 关键配置常量（config.ts）

```typescript
// 飞书 MCP 服务端点
export const FEISHU_MCP_URL = 'https://mcp.feishu.cn/mcp';

// 固定的 Allowed-Tools 白名单
export const FEISHU_MCP_ALLOWED_TOOLS = [
  'search-doc',
  'create-doc',
  'fetch-doc',
  'update-doc',
  'list-docs',
  'get-comments',
  'add-comments',
  'search-user',
  'get-user',
  'fetch-file',
];

// MCP 连接参数构建函数
export const buildFeishuMcpParams = (uat: string): HttpMCPClientParams => ({
  type: 'http',
  url: FEISHU_MCP_URL,
  name: FEISHU_MCP_IDENTIFIER, // 'builtin-feishu-mcp'
  headers: {
    'X-Lark-MCP-UAT': uat,
    'X-Lark-MCP-Allowed-Tools': FEISHU_MCP_ALLOWED_TOOLS.join(','),
  },
});
```

### Manifest 结构

飞书 MCP 的 manifest 类型为 `LobeChatPluginManifest`（而非 `BuiltinToolManifest`），因为：

1. 飞书 MCP 的工具定义格式和 MCP 插件一致（`api[].parameters` 对应 MCP 的 `inputSchema`）
2. 执行链路走 MCP 体系，需要 `customParams.mcp` 字段来存储连接配置
3. 动态激活机制基于 `LobeChatPluginManifest`

> Manifest 中 9 个工具的 `description` 和 `parameters`（inputSchema）来源于飞书 MCP `tools/list` 的返回结果，参考文件：`.local/2026-05-20-feishu-mcp/feishu-mcp/tools-list-result.json`

```typescript
export const FeishuMcpManifest: LobeChatPluginManifest = {
  identifier: 'builtin-feishu-mcp',
  type: 'mcp',
  version: '1.0.0',
  api: [
    {
      name: 'search-doc',
      description: '...', // 完整保留飞书 MCP 的 description
      parameters: { ... }, // 从 tools-list-result.json 的 inputSchema 转换
    },
    {
      name: 'create-doc',
      description: '...',
      parameters: { ... },
    },
    // ... 其他 7 个工具
  ],
  meta: {
    avatar: '🪽', // 或飞书 logo
    title: 'Feishu MCP',
    description: '飞书云文档与用户信息工具',
  },
  // 注意：customParams.mcp 不在 manifest 中硬编码
  // 因为 UAT 是动态的，每次调用时在前端构建
};
```

### 参数格式转换

飞书 MCP `inputSchema` → LobeChat `parameters` 的转换规则：

| 飞书字段            | LobeChat 字段 | 说明                           |
| ------------------- | ------------- | ------------------------------ |
| `inputSchema`       | `parameters`  | 直接映射，JSON Schema 格式兼容 |
| `name`              | `name`        | 工具名，直接映射               |
| `description`       | `description` | 完整保留                       |
| `annotations.title` | -             | 中文标题，可选用于 UI 显示     |

### 执行流程

#### 完整调用链路

```
模型调用飞书工具（如 fetch-doc）
    ↓
前端 invokeMcpToolCall(payload)
    ↓
识别 identifier === FEISHU_MCP_IDENTIFIER
    ↓
调用 auth.getUserAccessToken() → 获取 UAT
    ↓
调用 buildFeishuMcpParams(uat) → 构建 MCP params
    ↓
params 作为 mcp.callTool 的 input.params
    ↓
TRPC mcp.callTool → 后端 MCPService.callTool
    ↓
MCPClient 创建（url: mcp.feishu.cn/mcp, headers 含 UAT + Allowed-Tools）
    ↓
initialize + tools/call → 飞书 MCP 服务
    ↓
返回结果 → 断开 MCPClient（不缓存）
    ↓
结果返回给模型
```

#### 前端代码改动（src/services/mcp.ts）

在 `invokeMcpToolCall` 方法中增加飞书 MCP 识别和 UAT 获取逻辑：

```typescript
// 在构建 params 之前
if (identifier === FEISHU_MCP_IDENTIFIER) {
  const uat = await auth.getUserAccessToken();
  // auth.getUserAccessToken 会自动跳转授权页面，获取成功后返回 token
  // 如果获取失败（如授权被拒绝），直接返回错误信息提示用户重试
  if (!uat) {
    return { success: false, content: '飞书授权失败，请重试授权后再次使用飞书工具' };
  }
  params = buildFeishuMcpParams(uat);
} else {
  // 现有逻辑：从 plugin customParams 获取 MCP 连接信息
  params = { ...connection, name: identifier };
}
```

#### 后端代码改动（src/server/services/mcp/index.ts）

在 `callTool` 方法中增加飞书 MCP 不缓存的逻辑：

```typescript
// 飞书 MCP 不缓存 client（每次 UAT 可能不同）
if (params.name === FEISHU_MCP_IDENTIFIER) {
  // 不使用 getClient 缓存，每次新建
  const client = new MCPClient(params);
  await client.initialize();
  const result = await client.callTool(toolName, args);
  await client.disconnect();
  return result;
} else {
  // 现有逻辑：使用缓存的 client
  const client = await this.getClient(params);
  // ...
}
```

### 激活流程

#### 动态激活（通过 activateTools）

```
模型看到 <available_tools> 中有 feishu-mcp
    ↓
模型调用 activateTools(["feishu-mcp"])
    ↓
lobe-tools executor 标记 feishu-mcp 已激活
    ↓
下一次 LLM 调用：generateToolsDetailed({toolIds: ["feishu-mcp"], isExplicitActivation: true})
    ↓
FeishuMcpManifest 从代码直接获取（不存数据库）
    ↓
9 个工具的完整定义加入 tools 参数
    ↓
模型看到所有飞书工具并可直接调用
```

#### 勾选激活

```
用户在 UI 勾选飞书 MCP
    ↓
feishu-mcp identifier 加入 agentConfig.plugins
    ↓
enableChecker.rules["feishu-mcp"] = true
    ↓
从第一次 LLM 调用开始，飞书工具就完整暴露给模型
```

### 工具注册（和 builtin-tool 一样从代码获取）

#### 前端（src/helpers/toolEngineering/index.ts）

```typescript
import { builtinMcpManifests } from '@lobechat/builtin-mcps';

// 在 allManifests 中加入内置 MCP manifests
const allManifests = [
  ...pluginManifests,
  ...builtinManifests,
  ...builtinMcpManifests, // ← 新增
  ...klavisManifests,
  ...lobehubSkillManifests,
  ...additionalManifests,
];
```

#### 后端（src/server/modules/Mecha/AgentToolsEngine/index.ts）

```typescript
import { builtinMcpManifests } from '@lobechat/builtin-mcps';

// 同样在 allManifests 中加入
const allManifests = [
  ...pluginManifests,
  ...builtinManifests,
  ...builtinMcpManifests,
  ...additionalManifests,
];
```

#### 聚合包（packages/builtin-mcps/src/index.ts）

```typescript
import { FeishuMcpManifest } from '@lobechat/builtin-mcp-feishu';

export const builtinMcpManifests: LobeChatPluginManifest[] = [FeishuMcpManifest];
```

### available_tools 列表注入

飞书 MCP 需要在 `<available_tools>` XML 中出现，让模型知道有这个工具可激活。

这需要确保 `FeishuMcpManifest` 被包含在 ToolsEngine 的 `manifestSchemas` 中（即 `allManifests`），这样：

- 未激活时：出现在 `<available_tools>` 列表（identifier + meta.title + meta.description）
- 激活后：完整 api 定义加入 `ChatCompletionTool[]`

## 9 个工具清单

| 工具名         | 中文标题     | 功能                         | 支持 UAT/TAT |
| -------------- | ------------ | ---------------------------- | ------------ |
| `search-doc`   | 搜索云文档   | 根据关键词搜索飞书云文档     | UAT          |
| `create-doc`   | 创建云文档   | 从 Markdown 创建飞书云文档   | UAT/TAT      |
| `fetch-doc`    | 查看云文档   | 获取飞书云文档内容           | UAT/TAT      |
| `update-doc`   | 更新云文档   | 7 种模式更新文档内容         | UAT/TAT      |
| `list-docs`    | 获取文档列表 | 获取知识空间节点下的文档列表 | UAT/TAT      |
| `get-comments` | 查看评论     | 获取云文档中的评论           | UAT/TAT      |
| `add-comments` | 添加评论     | 在云文档添加全文评论         | UAT/TAT      |
| `search-user`  | 搜索用户     | 搜索企业内的用户             | UAT          |
| `get-user`     | 获取用户信息 | 获取用户个人信息             | UAT/TAT      |
| `fetch-file`   | 获取文件     | 获取文件 / 图片的二进制内容  | UAT/TAT      |

## 影响范围

### 新增文件

| 文件                                              | 说明                      |
| ------------------------------------------------- | ------------------------- |
| `packages/builtin-mcps/package.json`              | 内置 MCP 聚合包           |
| `packages/builtin-mcps/src/index.ts`              | 聚合所有内置 MCP manifest |
| `packages/builtin-mcps/src/identifiers.ts`        | identifier 常量           |
| `packages/builtin-mcp-feishu/package.json`        | 飞书 MCP 单包             |
| `packages/builtin-mcp-feishu/src/index.ts`        | 导出                      |
| `packages/builtin-mcp-feishu/src/manifest.ts`     | 硬编码 manifest           |
| `packages/builtin-mcp-feishu/src/types.ts`        | 工具名称和参数类型        |
| `packages/builtin-mcp-feishu/src/systemRole.ts`   | 系统提示                  |
| `packages/builtin-mcp-feishu/src/config.ts`       | 连接配置常量              |
| `packages/builtin-mcp-feishu/src/client/index.ts` | 前端客户端导出            |

### 修改文件

| 文件                                                 | 改动                                          |
| ---------------------------------------------------- | --------------------------------------------- |
| `src/helpers/toolEngineering/index.ts`               | 在 allManifests 中加入 builtinMcpManifests    |
| `src/server/modules/Mecha/AgentToolsEngine/index.ts` | 同上                                          |
| `src/services/mcp.ts`                                | invokeMcpToolCall 中增加飞书 MCP UAT 获取逻辑 |
| `src/server/services/mcp/index.ts`                   | callTool 中增加飞书 MCP 不缓存 client 逻辑    |
| `pnpm-workspace.yaml`                                | 加入 builtin-mcps 和 builtin-mcp-feishu       |

## 已确认的决策

1. **飞书 MCP 的 identifier**：`builtin-feishu-mcp`
2. **UAT 获取失败的处理**：`auth.getUserAccessToken()` 会自动跳转授权页面。如果获取不到 token，直接返回错误信息提示用户授权失败重试
3. **TAT 支持**：第一版只支持 UAT 模式，TAT 后续再考虑
4. **工具 UI 渲染**：第一版不需要自定义渲染组件，使用默认渲染
5. **i18n**：第一版不做 i18n
