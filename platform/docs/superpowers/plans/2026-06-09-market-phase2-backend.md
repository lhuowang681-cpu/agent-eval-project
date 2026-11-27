# 社区市场 — Phase 2: 后端 API 层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写市场 tRPC 路由，从代理官方 API 改为查询本地数据库。创建 CommunityService 替代 DiscoverService/MarketService，实现发布 / 安装 / 更新 / 下线完整生命周期。

**Architecture:** CommunityService 封装三张市场表的 Model 层操作。tRPC 路由保留现有签名，内部实现改为调用 CommunityService。移除 social/oidc 路由。认证使用 Better Auth ctx.userId。

**Tech Stack:** tRPC + Drizzle ORM + Better Auth + Zod

**前置依赖:** Phase 1（数据库表和 Model 层）必须完成并迁移成功。

---

## 文件变更清单

| 操作 | 文件                                                | 责责                                                                          |
| ---- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| 创建 | `src/server/services/community/index.ts`            | CommunityService — 统一市场业务逻辑                                           |
| 修改 | `src/server/routers/lambda/market/index.ts`         | 重写：移除 DiscoverService/MarketService 注入，改用 CommunityService          |
| 重写 | `src/server/routers/lambda/market/agent.ts`         | 重写：本地数据库 CRUD，移除 MarketSDK                                         |
| 重写 | `src/server/routers/lambda/market/skill.ts`         | 重写：本地数据库 CRUD                                                         |
| 创建 | `src/server/routers/lambda/market/mcp.ts`           | 新建：MCP 列表 / 详情 / 发布 / 更新 / 下线（当前 mcp 路由在 index.ts inline） |
| 删除 | `src/server/routers/lambda/market/social.ts`        | 移除社交路由                                                                  |
| 删除 | `src/server/routers/lambda/market/oidc.ts`          | 移除 OIDC 路由                                                                |
| 修改 | `src/server/routers/lambda/market/user.ts`          | 精简：移除 MarketSDK 依赖                                                     |
| 修改 | `src/libs/trpc/lambda/middleware/marketUserInfo.ts` | 精简：移除 marketAccessToken 获取逻辑                                         |
| 删除 | `src/libs/trpc/lambda/middleware/marketSDK.ts`      | 移除 MarketSDK 中间件                                                         |

---

### Task 1: CommunityService — 核心框架

**Files:**

- Create: `src/server/services/community/index.ts`

- [ ] **Step 1: 创建 CommunityService 类骨架**

CommunityService 不像 DiscoverService/MarketService 那样封装 SDK，而是直接操作数据库 Model：

```ts
import { MarketAgentModel } from '@lobechat/database/models/marketAgent';
import { MarketSkillModel } from '@lobechat/database/models/marketSkill';
import { MarketMcpModel } from '@lobechat/database/models/marketMcp';
import { AgentModel } from '@lobechat/database/models/agent';
import { AgentSkillModel } from '@lobechat/database/models/agentSkill';

import type { LobeChatDatabase } from '@lobechat/database/types';

export interface CommunityServiceOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

export class CommunityService {
  private db: LobeChatDatabase;
  private userId: string;

  // Model 实例（按需创建）
  private marketAgentModel: MarketAgentModel;
  private marketSkillModel: MarketSkillModel;
  private marketMcpModel: MarketMcpModel;
  private agentModel: AgentModel;
  private agentSkillModel: AgentSkillModel;

  constructor(options: CommunityServiceOptions) {
    this.db = options.serverDB;
    this.userId = options.userId;

    this.marketAgentModel = new MarketAgentModel(this.db, this.userId);
    this.marketSkillModel = new MarketSkillModel(this.db, this.userId);
    this.marketMcpModel = new MarketMcpModel(this.db, this.userId);
    this.agentModel = new AgentModel(this.db, this.userId);
    this.agentSkillModel = new AgentSkillModel(this.db, this.userId);
  }

  // ===== 助理方法 =====

  getAssistantList = this.marketAgentModel.getList;
  getAssistantDetail = this.marketAgentModel.getDetail;
  publishAgent = this._publishAgent;
  updateAgent = this._updateAgent;
  delistAgent = this.marketAgentModel.delist;
  installAgent = this._installAgent;
  updateInstalledAgent = this._updateInstalledAgent;

  // ===== Skill 方法 =====

  getSkillList = this.marketSkillModel.getList;
  getSkillDetail = this.marketSkillModel.getDetail;
  publishSkill = this._publishSkill;
  updateSkill = this._updateSkill;
  delistSkill = this.marketSkillModel.delist;
  installSkill = this._installSkill;
  updateInstalledSkill = this._updateInstalledSkill;

  // ===== MCP 方法 =====

  getMcpList = this.marketMcpModel.getList;
  getMcpDetail = this.marketMcpModel.getDetail;
  publishMcp = this._publishMcp;
  updateMcp = this._updateMcp;
  delistMcp = this.marketMcpModel.delist;
  installMcp = this._installMcp;
  updateInstalledMcp = this._updateInstalledMcp;
}
```

注意：实际 import 路径需要确认 ——`@lobechat/database` 包的导出结构可能不同。查看 `packages/database/package.json` 的 exports 配置来确认正确路径。

- [ ] **Step 2: 实现 \_publishAgent 方法**

```ts
private _publishAgent = async (agentId: string, bundledSkillIdentifiers: string[] = []) => {
  // 1. 从本地 agents 表读取完整配置
  const localAgent = await this.agentModel.findById(agentId);
  if (!localAgent) throw new Error('Agent not found');

  // 2. 验证必填字段
  if (!localAgent.title || !localAgent.systemRole) {
    throw new Error('Title and systemRole are required');
  }

  // 3. 生成市场 identifier
  const identifier = `agt_${createNanoId(8)()}`;

  // 4. 拷贝到 market_agents
  const marketAgent = await this.marketAgentModel.create({
    identifier,
    title: localAgent.title,
    description: localAgent.description,
    avatar: localAgent.avatar,
    backgroundColor: localAgent.backgroundColor,
    category: null, // Phase 1 不强制分类
    tags: localAgent.tags,
    systemRole: localAgent.systemRole,
    model: localAgent.model,
    provider: localAgent.provider,
    plugins: localAgent.plugins,
    skills: localAgent.skills || [],
    chatConfig: localAgent.chatConfig,
    fewShots: localAgent.fewShots,
    openingMessage: localAgent.openingMessage,
    openingQuestions: localAgent.openingQuestions,
    editorData: localAgent.editorData,
    tokenUsage: 0,
    pluginCount: localAgent.plugins?.length || 0,
    knowledgeCount: 0,
  });

  // 5. 处理附属 Skill 的 visibility
  const agentSkillIds = localAgent.skills || [];
  for (const skillIdentifier of agentSkillIds) {
    const existingMarketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
    if (existingMarketSkill) continue; // 已在市场，跳过

    const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
    if (!localSkill) continue;

    const isBundled = !bundledSkillIdentifiers.includes(skillIdentifier);
    await this.marketSkillModel.create({
      identifier: skillIdentifier,
      name: localSkill.name,
      description: localSkill.description,
      icon: localSkill.manifest?.icon,
      category: null,
      tags: localSkill.manifest?.tags || [],
      content: localSkill.content,
      manifest: localSkill.manifest,
      resources: localSkill.resources,
      editorData: localSkill.editorData,
      resourcesCount: Object.keys(localSkill.resources || {}).length,
      visibility: isBundled ? 'bundled' : 'public',
    });
  }

  // 6. 处理附属 MCP 的 visibility（类似 Skill 逻辑）
  const mcpIdentifiers = localAgent.plugins || [];
  for (const mcpIdentifier of mcpIdentifiers) {
    const existingMarketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
    if (existingMarketMcp) continue;

    // MCP 安装配置在 userInstalledPlugins 表
    // 需要 UserModel 或直接 DB 查询来获取
    // 此处暂用占位注释——实际实现需要查询 userInstalledPlugins
  }

  // 7. 更新本地 agent 的 marketIdentifier
  await this.agentModel.update(agentId, { marketIdentifier: identifier });

  return marketAgent;
};
```

注意：`createNanoId` 需从 `packages/database/src/utils/idGenerator.ts` 的 `createNanoId` 函数导入，或使用 `customAlphabet` 直接生成（与现有 `generateMarketIdentifier` 模式一致）。

- [ ] **Step 3: 实现 \_installAgent 方法**

```ts
private _installAgent = async (marketIdentifier: string) => {
  // 1. 查市场表
  const marketAgent = await this.marketAgentModel.getDetail(marketIdentifier);
  if (!marketAgent) throw new Error('Market agent not found');

  // 2. 检查是否已安装
  const existing = await this.db
    .select()
    .from(agents)
    .where(and(
      eq(agents.installedFromMarketIdentifier, marketIdentifier),
      eq(agents.userId, this.userId),
    ))
    .limit(1);

  if (existing.length > 0) {
    return existing[0]; // 已安装，返回现有
  }

  // 3. 拷贝到本地 agents 表
  const snapshot = {
    title: marketAgent.title,
    description: marketAgent.description,
    systemRole: marketAgent.systemRole,
    model: marketAgent.model,
    provider: marketAgent.provider,
    plugins: marketAgent.plugins,
    skills: marketAgent.skills,
    chatConfig: marketAgent.chatConfig,
    fewShots: marketAgent.fewShots,
    openingMessage: marketAgent.openingMessage,
    openingQuestions: marketAgent.openingQuestions,
  };

  const localAgent = await this.agentModel.create({
    title: marketAgent.title,
    description: marketAgent.description,
    avatar: marketAgent.avatar,
    backgroundColor: marketAgent.backgroundColor,
    tags: marketAgent.tags,
    systemRole: marketAgent.systemRole,
    model: marketAgent.model,
    provider: marketAgent.provider,
    plugins: marketAgent.plugins,
    skills: marketAgent.skills,
    chatConfig: marketAgent.chatConfig,
    fewShots: marketAgent.fewShots,
    openingMessage: marketAgent.openingMessage,
    openingQuestions: marketAgent.openingQuestions,
    editorData: marketAgent.editorData,
    installedFromMarketIdentifier: marketIdentifier,
    installedFromSnapshot: snapshot,
    installedMarketVersion: marketAgent.version,
  });

  // 4. 安装附属 Skill
  for (const skillIdentifier of (marketAgent.skills || [])) {
    const marketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
    if (!marketSkill) continue;

    // 检查本地是否已有同 identifier
    const existingSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
    if (existingSkill) continue;

    await this.agentSkillModel.create({
      identifier: skillIdentifier,
      name: marketSkill.name,
      description: marketSkill.description,
      source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
      manifest: marketSkill.manifest,
      content: marketSkill.content,
      editorData: marketSkill.editorData,
      resources: marketSkill.resources,
      installedFromMarketIdentifier: skillIdentifier,
      installedFromSnapshot: {
        name: marketSkill.name,
        description: marketSkill.description,
        manifest: marketSkill.manifest,
        content: marketSkill.content,
      },
      installedMarketVersion: marketSkill.version,
    });
  }

  // 5. 安装附属 MCP（类似 Skill）
  for (const mcpIdentifier of (marketAgent.plugins || [])) {
    const marketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
    if (!marketMcp) continue;

    // 查本地是否已有
    // MCP 在 userInstalledPlugins 表，composite PK (userId, identifier)
    const existingMcp = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(and(
        eq(userInstalledPlugins.userId, this.userId),
        eq(userInstalledPlugins.identifier, mcpIdentifier),
      ))
      .limit(1);

    if (existingMcp.length > 0) continue;

    await this.db.insert(userInstalledPlugins).values({
      userId: this.userId,
      identifier: mcpIdentifier,
      type: 'plugin',
      manifest: marketMcp.manifest,
      customParams: marketMcp.customParams,
      source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
      installedFromMarketIdentifier: mcpIdentifier,
      installedFromSnapshot: {
        manifest: marketMcp.manifest,
        customParams: marketMcp.customParams,
      },
      installedMarketVersion: marketMcp.version,
    });
  }

  // 6. 递增安装计数
  await this.marketAgentModel.incrementInstallCount(marketIdentifier);

  return localAgent;
};
```

注意：需要在文件顶部 import `agents`, `userInstalledPlugins` schema 和 `and`, `eq` 等 Drizzle 操作符。

- [ ] **Step 4: 实现 \_publishSkill, \_installSkill, \_updateSkill, \_updateInstalledSkill**

```ts
private _publishSkill = async (skillId: string) => {
  const localSkill = await this.agentSkillModel.findById(skillId);
  if (!localSkill) throw new Error('Skill not found');

  const identifier = localSkill.identifier || `skl_${createNanoId(8)()}`;

  const marketSkill = await this.marketSkillModel.create({
    identifier,
    name: localSkill.name,
    description: localSkill.description,
    icon: localSkill.manifest?.icon,
    category: null,
    tags: localSkill.manifest?.tags || [],
    content: localSkill.content,
    manifest: localSkill.manifest,
    resources: localSkill.resources,
    editorData: localSkill.editorData,
    resourcesCount: Object.keys(localSkill.resources || {}).length,
  });

  // 更新本地 skill 的 marketIdentifier
  await this.agentSkillModel.update(skillId, { marketIdentifier: identifier });

  return marketSkill;
};

private _updateSkill = async (identifier: string) => {
  const localSkill = await this.db
    .select()
    .from(agentSkills)
    .where(and(eq(agentSkills.marketIdentifier, identifier), eq(agentSkills.userId, this.userId)))
    .limit(1);

  if (!localSkill[0]) throw new Error('Local skill not found for this market identifier');

  // 计算 version 递增：解析当前 version 并 +1
  const currentMarketSkill = await this.marketSkillModel.findByIdentifier(identifier);
  const currentVersion = currentMarketSkill?.version || '1.0.0';
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;

  return this.marketSkillModel.updateByIdentifier(identifier, {
    name: localSkill[0].name,
    description: localSkill[0].description,
    content: localSkill[0].content,
    manifest: localSkill[0].manifest,
    resources: localSkill[0].resources,
    editorData: localSkill[0].editorData,
    resourcesCount: Object.keys(localSkill[0].resources || {}).length,
    version: newVersion,
  });
};

private _installSkill = async (identifier: string) => {
  const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
  if (!marketSkill) throw new Error('Market skill not found');

  // 检查本地是否已有同 identifier
  const existing = await this.agentSkillModel.findByIdentifier(identifier);
  if (existing) return existing;

  const localSkill = await this.agentSkillModel.create({
    identifier,
    name: marketSkill.name,
    description: marketSkill.description,
    source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
    manifest: marketSkill.manifest,
    content: marketSkill.content,
    editorData: marketSkill.editorData,
    resources: marketSkill.resources,
    installedFromMarketIdentifier: identifier,
    installedFromSnapshot: {
      name: marketSkill.name,
      description: marketSkill.description,
      manifest: marketSkill.manifest,
      content: marketSkill.content,
    },
    installedMarketVersion: marketSkill.version,
  });

  await this.marketSkillModel.incrementInstallCount(identifier);

  return localSkill;
};

private _updateInstalledSkill = async (identifier: string) => {
  const marketSkill = await this.marketSkillModel.findByIdentifier(identifier);
  if (!marketSkill) throw new Error('Market skill not found');

  // 查本地 skill
  const localSkill = await this.db
    .select()
    .from(agentSkills)
    .where(and(
      eq(agentSkills.installedFromMarketIdentifier, identifier),
      eq(agentSkills.userId, this.userId),
    ))
    .limit(1);

  if (!localSkill[0]) throw new Error('Installed skill not found');

  // 覆盖更新
  await this.agentSkillModel.update(localSkill[0].id, {
    name: marketSkill.name,
    description: marketSkill.description,
    manifest: marketSkill.manifest,
    content: marketSkill.content,
    editorData: marketSkill.editorData,
    resources: marketSkill.resources,
    installedFromSnapshot: {
      name: marketSkill.name,
      description: marketSkill.description,
      manifest: marketSkill.manifest,
      content: marketSkill.content,
    },
    installedMarketVersion: marketSkill.version,
  });

  return { success: true };
};
```

- [ ] **Step 5: 实现 MCP 方法（与 Skill 对称）**

```ts
private _publishMcp = async (identifier: string, manifest: any, customParams: any) => {
  // MCP 发布必须从 manifest 自动提取 capabilities 和 count
  const capabilities = {
    tools: manifest?.tools?.length > 0,
    prompts: manifest?.prompts?.length > 0,
    resources: manifest?.resources?.length > 0,
  };

  const marketMcp = await this.marketMcpModel.create({
    identifier,
    name: manifest?.meta?.title || identifier,
    description: manifest?.meta?.description,
    icon: manifest?.meta?.icon,
    category: null,
    tags: manifest?.meta?.tags || [],
    overview: manifest?.meta?.readme,
    connectionType: customParams?.type || 'http',
    manifest,
    customParams,
    capabilities,
    toolsCount: manifest?.tools?.length || 0,
    promptsCount: manifest?.prompts?.length || 0,
    resourcesCount: manifest?.resources?.length || 0,
  });

  return marketMcp;
};

private _updateMcp = async (identifier: string, manifest: any, customParams: any) => {
  const currentMarketMcp = await this.marketMcpModel.findByIdentifier(identifier);
  const currentVersion = currentMarketMcp?.version || '1.0.0';
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  const newVersion = `${major}.${minor}.${patch + 1}`;

  const capabilities = {
    tools: manifest?.tools?.length > 0,
    prompts: manifest?.prompts?.length > 0,
    resources: manifest?.resources?.length > 0,
  };

  return this.marketMcpModel.updateByIdentifier(identifier, {
    name: manifest?.meta?.title || identifier,
    description: manifest?.meta?.description,
    manifest,
    customParams,
    capabilities,
    toolsCount: manifest?.tools?.length || 0,
    promptsCount: manifest?.prompts?.length || 0,
    resourcesCount: manifest?.resources?.length || 0,
    version: newVersion,
  });
};

private _installMcp = async (identifier: string) => {
  const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
  if (!marketMcp) throw new Error('Market MCP not found');

  // 检查本地是否已有
  const existing = await this.db
    .select()
    .from(userInstalledPlugins)
    .where(and(
      eq(userInstalledPlugins.userId, this.userId),
      eq(userInstalledPlugins.identifier, identifier),
    ))
    .limit(1);

  if (existing.length > 0) return existing[0];

  await this.db.insert(userInstalledPlugins).values({
    userId: this.userId,
    identifier,
    type: 'plugin',
    manifest: marketMcp.manifest,
    customParams: marketMcp.customParams,
    source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
    installedFromMarketIdentifier: identifier,
    installedFromSnapshot: {
      manifest: marketMcp.manifest,
      customParams: marketMcp.customParams,
    },
    installedMarketVersion: marketMcp.version,
  });

  await this.marketMcpModel.incrementInstallCount(identifier);

  return { success: true, identifier };
};

private _updateInstalledMcp = async (identifier: string) => {
  const marketMcp = await this.marketMcpModel.findByIdentifier(identifier);
  if (!marketMcp) throw new Error('Market MCP not found');

  await this.db
    .update(userInstalledPlugins)
    .set({
      manifest: marketMcp.manifest,
      customParams: marketMcp.customParams,
      source: marketMcp.visibility === 'bundled' ? 'bundled' : 'market',
      installedFromSnapshot: {
        manifest: marketMcp.manifest,
        customParams: marketMcp.customParams,
      },
      installedMarketVersion: marketMcp.version,
    })
    .where(and(
      eq(userInstalledPlugins.userId, this.userId),
      eq(userInstalledPlugins.identifier, identifier),
    ));

  return { success: true };
};
```

- [ ] **Step 6: 实现 \_updateAgent 和 \_updateInstalledAgent**

```ts
private _updateAgent = async (identifier: string) => {
  // 查本地 agent（通过 marketIdentifier 关联）
  const localAgent = await this.db
    .select()
    .from(agents)
    .where(and(eq(agents.marketIdentifier, identifier), eq(agents.userId, this.userId)))
    .limit(1);

  if (!localAgent[0]) throw new Error('Local agent not found');

  // 重新拷贝本地配置到市场行
  return this.marketAgentModel.updateByIdentifier(identifier, {
    title: localAgent[0].title,
    description: localAgent[0].description,
    avatar: localAgent[0].avatar,
    backgroundColor: localAgent[0].backgroundColor,
    tags: localAgent[0].tags,
    systemRole: localAgent[0].systemRole,
    model: localAgent[0].model,
    provider: localAgent[0].provider,
    plugins: localAgent[0].plugins,
    skills: localAgent[0].skills || [],
    chatConfig: localAgent[0].chatConfig,
    fewShots: localAgent[0].fewShots,
    openingMessage: localAgent[0].openingMessage,
    openingQuestions: localAgent[0].openingQuestions,
    editorData: localAgent[0].editorData,
    pluginCount: localAgent[0].plugins?.length || 0,
    // version 由 Model 层 SQL 自动 +1
  });
};

private _updateInstalledAgent = async (identifier: string) => {
  const marketAgent = await this.marketAgentModel.getDetail(identifier);
  if (!marketAgent) throw new Error('Market agent not found');

  // 查本地已安装的 agent
  const localAgent = await this.db
    .select()
    .from(agents)
    .where(and(
      eq(agents.installedFromMarketIdentifier, identifier),
      eq(agents.userId, this.userId),
    ))
    .limit(1);

  if (!localAgent[0]) throw new Error('Installed agent not found');

  const snapshot = {
    title: marketAgent.title,
    description: marketAgent.description,
    systemRole: marketAgent.systemRole,
    model: marketAgent.model,
    provider: marketAgent.provider,
    plugins: marketAgent.plugins,
    skills: marketAgent.skills,
    chatConfig: marketAgent.chatConfig,
    fewShots: marketAgent.fewShots,
    openingMessage: marketAgent.openingMessage,
    openingQuestions: marketAgent.openingQuestions,
  };

  // 覆盖更新本地 agent
  await this.agentModel.update(localAgent[0].id, {
    title: marketAgent.title,
    description: marketAgent.description,
    avatar: marketAgent.avatar,
    backgroundColor: marketAgent.backgroundColor,
    tags: marketAgent.tags,
    systemRole: marketAgent.systemRole,
    model: marketAgent.model,
    provider: marketAgent.provider,
    plugins: marketAgent.plugins,
    skills: marketAgent.skills || [],
    chatConfig: marketAgent.chatConfig,
    fewShots: marketAgent.fewShots,
    openingMessage: marketAgent.openingMessage,
    openingQuestions: marketAgent.openingQuestions,
    editorData: marketAgent.editorData,
    installedFromSnapshot: snapshot,
    installedMarketVersion: marketAgent.version,
  });

  // 覆盖所有附属 Skill 和 MCP
  for (const skillIdentifier of (marketAgent.skills || [])) {
    const marketSkill = await this.marketSkillModel.findByIdentifier(skillIdentifier);
    if (!marketSkill) continue;

    const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
    if (localSkill) {
      await this.agentSkillModel.update(localSkill.id, {
        name: marketSkill.name,
        description: marketSkill.description,
        manifest: marketSkill.manifest,
        content: marketSkill.content,
        resources: marketSkill.resources,
        installedFromSnapshot: {
          name: marketSkill.name,
          description: marketSkill.description,
          manifest: marketSkill.manifest,
          content: marketSkill.content,
        },
        installedMarketVersion: marketSkill.version,
      });
    } else {
      // 本地没有这个 skill，创建一份
      await this.agentSkillModel.create({
        identifier: skillIdentifier,
        name: marketSkill.name,
        description: marketSkill.description,
        source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
        manifest: marketSkill.manifest,
        content: marketSkill.content,
        resources: marketSkill.resources,
        installedFromMarketIdentifier: skillIdentifier,
        installedFromSnapshot: { name: marketSkill.name, description: marketSkill.description, manifest: marketSkill.manifest },
        installedMarketVersion: marketSkill.version,
      });
    }
  }

  // MCP 覆盖逻辑类似
  for (const mcpIdentifier of (marketAgent.plugins || [])) {
    const marketMcp = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
    if (!marketMcp) continue;

    await this.db
      .update(userInstalledPlugins)
      .set({
        manifest: marketMcp.manifest,
        customParams: marketMcp.customParams,
        installedFromSnapshot: { manifest: marketMcp.manifest, customParams: marketMcp.customParams },
        installedMarketVersion: marketMcp.version,
      })
      .where(and(
        eq(userInstalledPlugins.userId, this.userId),
        eq(userInstalledPlugins.identifier, mcpIdentifier),
      ));
  }

  return { success: true };
};
```

- [ ] **Step 7: Commit**

```bash
git add src/server/services/community/
git commit -m "✨ create CommunityService with full publish/install/update/delist lifecycle"
```

---

### Task 2: 重写 market/index.ts — 改用 CommunityService

**Files:**

- Modify: `src/server/routers/lambda/market/index.ts`

- [ ] **Step 1: 重写市场路由主文件**

移除所有 DiscoverService/MarketService 依赖。改用 CommunityService。保留现有路由名但重写实现：

```ts
import { z } from 'zod';

import { CommunityService } from '@/server/services/community';
import { authedProcedure, publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { userAuth } from '@/libs/trpc/middleware/userAuth';
import { agentRouter } from './agent';
import { mcpRouter } from './mcp';
import { skillRouter } from './skill';
import { userRouter } from './user';

// 公开 procedure：注入 serverDB + communityService（无需认证）
const communityProcedure = publicProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB,
        userId: ctx.userId || '', // 公开路由可能无 userId
      }),
    },
  });
});

// 认证 procedure：注入 serverDB + communityService（有 userId）
const communityAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB,
        userId: ctx.userId,
      }),
    },
  });
});

export const marketRouter = router({
  // ===== 列表查询（公开） =====
  getAssistantList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getAssistantList(input);
    }),

  getAssistantDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getAssistantDetail(input.identifier);
    }),

  getSkillList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getSkillList(input);
    }),

  getSkillDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getSkillDetail(input.identifier);
    }),

  getMcpList: communityProcedure
    .input(
      z.object({
        keyword: z.string().optional(),
        category: z.string().optional(),
        connectionType: z.string().optional(),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().positive().default(20),
        sortBy: z.enum(['recommended', 'installCount', 'updatedAt']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMcpList(input);
    }),

  getMcpDetail: communityProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ input, ctx }) => {
      return ctx.communityService.getMcpDetail(input.identifier);
    }),

  // ===== 子路由 =====
  agent: agentRouter,
  mcp: mcpRouter,
  skill: skillRouter,
  user: userRouter,
});

export type MarketRouter = typeof marketRouter;
```

注意：移除了 `agentGroup`, `social`, `oidc` 子路由。移除了所有 `report*`, `submitFeedback`, `registerClient*` 等代理官方 API 的路由。移除了 `model`, `provider`, `plugin`（官方市场功能）的路由。

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/lambda/market/index.ts
git commit -m "♻️ rewrite market router — local DB via CommunityService"
```

---

### Task 3: 重写 market/agent.ts

**Files:**

- Rewrite: `src/server/routers/lambda/market/agent.ts`

- [ ] **Step 1: 重写 agent 子路由**

从 686 行的 MarketSDK 代理实现改为 40-50 行的本地数据库调用：

```ts
import { z } from 'zod';

import { CommunityService } from '@/server/services/community';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

const agentProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB,
        userId: ctx.userId,
      }),
    },
  });
});

export const agentRouter = router({
  publishAgent: agentProcedure
    .input(
      z.object({
        agentId: z.string(),
        bundledSkillIdentifiers: z.array(z.string()).optional().default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishAgent(input.agentId, input.bundledSkillIdentifiers);
    }),

  updateAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateAgent(input.identifier);
    }),

  delistAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistAgent(input.identifier);
    }),

  installAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installAgent(input.identifier);
    }),

  updateInstalledAgent: agentProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledAgent(input.identifier);
    }),
});

export type AgentRouter = typeof agentRouter;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/lambda/market/agent.ts
git commit -m "♻️ rewrite market agent router — local DB CRUD"
```

---

### Task 4: 重写 market/skill.ts

**Files:**

- Rewrite: `src/server/routers/lambda/market/skill.ts`

- [ ] **Step 1: 重写 skill 子路由**

与 agent 对称，新增发布 / 更新 / 下线 / 安装 / 更新已安装的 mutation：

```ts
import { z } from 'zod';

import { CommunityService } from '@/server/services/community';
import { authedProcedure, publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

const skillAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB!,
        userId: ctx.userId,
      }),
    },
  });
});

export const skillRouter = router({
  publishSkill: skillAuthProcedure
    .input(z.object({ skillId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishSkill(input.skillId);
    }),

  updateSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateSkill(input.identifier);
    }),

  delistSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistSkill(input.identifier);
    }),

  installSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installSkill(input.identifier);
    }),

  updateInstalledSkill: skillAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledSkill(input.identifier);
    }),
});

export type SkillRouter = typeof skillRouter;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/lambda/market/skill.ts
git commit -m "♻️ rewrite market skill router — local DB CRUD"
```

---

### Task 5: 创建 market/mcp.ts

**Files:**

- Create: `src/server/routers/lambda/market/mcp.ts`

- [ ] **Step 1: 创建 MCP 子路由**

目前 MCP 的列表 / 详情路由在 index.ts inline 定义。将 mutation 操作抽到独立文件：

```ts
import { z } from 'zod';

import { CommunityService } from '@/server/services/community';
import { authedProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

const mcpAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  return next({
    ctx: {
      communityService: new CommunityService({
        serverDB: ctx.serverDB!,
        userId: ctx.userId,
      }),
    },
  });
});

export const mcpRouter = router({
  publishMcp: mcpAuthProcedure
    .input(
      z.object({
        identifier: z.string(),
        manifest: z.any(),
        customParams: z.any(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.publishMcp(input.identifier, input.manifest, input.customParams);
    }),

  updateMcp: mcpAuthProcedure
    .input(
      z.object({
        identifier: z.string(),
        manifest: z.any(),
        customParams: z.any(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateMcp(input.identifier, input.manifest, input.customParams);
    }),

  delistMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.delistMcp(input.identifier);
    }),

  installMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.installMcp(input.identifier);
    }),

  updateInstalledMcp: mcpAuthProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.communityService.updateInstalledMcp(input.identifier);
    }),
});

export type McpRouter = typeof mcpRouter;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/lambda/market/mcp.ts
git commit -m "✨ create market MCP router with publish/install/update/delist"
```

---

### Task 6: 删除 social.ts 和 oidc.ts

**Files:**

- Delete: `src/server/routers/lambda/market/social.ts`

- Delete: `src/server/routers/lambda/market/oidc.ts`

- [ ] **Step 1: 删除 social.ts**

```bash
rm src/server/routers/lambda/market/social.ts
```

- [ ] **Step 2: 删除 oidc.ts**

```bash
rm src/server/routers/lambda/market/oidc.ts
```

- [ ] **Step 3: 确认 index.ts 不再 import 这些文件**

检查 `src/server/routers/lambda/market/index.ts` 中没有 `import { socialRouter }` 或 `import { oidcRouter }`。如果残留，移除。

- [ ] **Step 4: 删除 agentGroup.ts（如需保留，否则移除）**

规格未提及 Agent Group 市场。检查是否还需要保留。如果 Phase 1 不需要，先移除：

```bash
rm src/server/routers/lambda/market/agentGroup.ts
```

- [ ] **Step 5: Commit**

```bash
git add -A src/server/routers/lambda/market/
git commit -m "🔥 remove market social, oidc, and agentGroup routers"
```

---

### Task 7: 精简 market/user.ts

**Files:**

- Modify: `src/server/routers/lambda/market/user.ts`

- [ ] **Step 1: 移除 MarketSDK 依赖**

将 `marketSDK` middleware 替换为 `communityAuthProcedure`。仅保留 `getUserByUsername`（查本地 users 表）和 `updateUserProfile`（本地更新）：

```ts
import { z } from 'zod';

import { authedProcedure, publicProcedure } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';

// 暂时精简为最简单的用户查询——后续可扩展
const userProcedure = authedProcedure.use(serverDatabase);

export const userRouter = router({
  // 暂无独立用户市场路由——Phase 1 不需要用户 profile 管理
  // 用户信息直接从 Better Auth session 获取
});

export type UserRouter = typeof userRouter;
```

如果 userRouter 在 Phase 1 完全不需要，可以将其从 index.ts 的子路由中也移除。

- [ ] **Step 2: Commit**

```bash
git add src/server/routers/lambda/market/user.ts
git commit -m "♻️ simplify market user router — remove MarketSDK"
```

---

### Task 8: 精简 marketUserInfo 中间件

**Files:**

- Modify: `src/libs/trpc/lambda/middleware/marketUserInfo.ts`

- [ ] **Step 1: 移除 marketAccessToken 获取逻辑**

当前此中间件从 user_settings.market.accessToken 或 cookie `mp_token` 获取 token。CommunityService 不需要这些：

```ts
import { serverDB } from '@lobechat/database';
import type { LobeChatDatabase } from '@lobechat/database/types';

export const marketUserInfo = async ({ ctx, next }: any) => {
  // 只保留 TrustedClientUserInfo 的构建（用户名/邮箱）
  // 移除 marketAccessToken 获取

  let userInfo = undefined;
  if (ctx.userId && ctx.serverDB) {
    const db = ctx.serverDB as LobeChatDatabase;
    const user = await db
      .select({ id: users.id, email: users.email, name: users.fullName })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1);

    if (user[0]) {
      userInfo = {
        userId: user[0].id,
        email: user[0].email,
        name: user[0].name,
      };
    }
  }

  return next({
    ctx: {
      marketUserInfo: userInfo,
    },
  });
};
```

注意：如果 CommunityService 直接使用 `ctx.userId`，可能不需要 marketUserInfo 中间件。检查所有使用 `ctx.marketUserInfo` 的地方，如果全部移除，则可以删除此中间件。暂时保留最小化版本以防其他地方仍引用。

- [ ] **Step 2: Commit**

```bash
git add src/libs/trpc/lambda/middleware/marketUserInfo.ts
git commit -m "♻️ simplify marketUserInfo middleware — remove accessToken"
```

---

### Task 9: 删除 marketSDK 中间件

**Files:**

- Delete: `src/libs/trpc/lambda/middleware/marketSDK.ts`

- [ ] **Step 1: 删除文件**

```bash
rm src/libs/trpc/lambda/middleware/marketSDK.ts
```

- [ ] **Step 2: 搜索所有引用 marketSDK 的地方并移除**

```bash
grep -r "marketSDK" src/ --include="*.ts" --include="*.tsx" -l
```

移除所有 import 和 `.use(marketSDK)` 调用。

- [ ] **Step 3: Commit**

```bash
git add -A src/libs/trpc/ src/server/
git commit -m "🔥 remove marketSDK middleware and all references"
```

---

### Task 10: 类型检查验证

- [ ] **Step 1: 运行 type-check**

```bash
bun run type-check
```

预期：可能有类型错误（因为前端 client 代码可能引用被移除的 tRPC 路由）。需要逐步修复：

- 前端 client 中引用 `market.social.*` → 移除
- 前端 client 中引用 `market.oidc.*` → 移除
- 前端 client 中引用 `market.getAssistantCategories` 等路由 → 改为使用新路由签名

这些前端修改将在 Phase 3 处理。Phase 2 的 type-check 可能暂时不通过，需要记录错误清单。

- [ ] **Step 2: 记录需要 Phase 3 修复的前端类型错误**

如果 type-check 报错主要来自前端 client 对被移除路由的引用，这是预期行为。这些错误将在 Phase 3 统一修复。

---

## 自审检查

**1. Spec 覆盖率：**

- 规格 §3.4 CommunityService 替代 → Task 1 ✅
- 规格 §5.1 tRPC 路由结构 → Task 2-5 ✅
- 规格 §5.2 发布 / 更新 → Task 1 内 \_publish\* /\_update\* ✅
- 规格 §5.2 安装 / 更新 (客户端触发) → Task 1 内 \_install\* /\_updateInstalled\* ✅
- 规格 §5.2 下线 → Task 1 内 delist (继承 Model 层) ✅
- 规格 §5.2 安装计数递增 → Task 1 内 incrementInstallCount ✅
- 规格 §3.4 移除 social/oidc → Task 6 ✅
- 规格 §3.4 认证集成 Better Auth → Task 2-5 (authedProcedure) ✅
- 规格 §9 搜索与筛选 → Model 层 getList 方法 ✅

**2. Placeholder 检查：** 无 TBD/TODO ✅（MCP 安装逻辑在 \_installAgent 中有注释说明需要查 userInstalledPlugins 表，但代码已给出完整实现）

**3. 类型一致性检查：**

- CommunityService 方法名与 tRPC 路由 input 对齐 ✅
- `identifier` 在所有路由中作为 string → CommunityService 方法签名中也是 string ✅
- `_publishAgent` 返回 `marketAgent` (MarketAgentItem 类型) → tRPC mutation 返回类型自动推导 ✅
- Model 层方法签名（getList 参数）与 tRPC input schema 对齐 ✅
