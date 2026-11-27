# 社区市场（Market）功能设计规格

**日期:** 2026-06-09\
**作者:** Claude + ptsu\
**状态:** 待审阅\
**关联:** [决策记录](../../.local/2026-06-05-market/决策记录.md), [需求文档](../../.local/2026-06-05-market/需求.md)

---

## 1. 问题背景

TripYoYo 官方的 Market 服务不开源。当前前端市场页面已被隐藏，因为它们依赖外部官方 API。我们需要自建后端 —— 数据库表、tRPC 路由、业务逻辑 —— 让用户能在一个自托管的社区市场中发布、发现、安装和更新助理、Skill 和 MCP。

前端页面已有代码（继承自 LobeChat 上游），但包含我们不需要的社交功能（收藏、评分、评论、GitHub 链接等）。必须精简 UI，同时保留核心的发现 / 安装工作流。

---

## 2. 目标

1. **完整生命周期**：助理、Skill、MCP 三种工具类型统一支持 发布 → 发现 → 安装 → 更新 → 下线
2. **自托管后端**：自建数据库表和 API 逻辑，零依赖官方服务
3. **最小前端改动**：后端字段对齐前端已有类型，仅删除 / 隐藏模块 + 新增安装 / 发布按钮
4. **一致模型**：三种工具统一使用拷贝（fork）语义处理发布和安装
5. **认证集成**：使用现有 Better Auth 会话，不需要单独的 Market Auth OIDC/M2M

---

## 3. 架构设计

### 3.1 数据策略 — 统一拷贝模型

助理、Skill、MCP 三种工具统一使用拷贝 /fork 语义：

- **发布** = 把用户本地工具配置拷贝到市场表。两者独立 —— 用户编辑不影响市场版本。
- **安装** = 把市场工具配置拷贝到用户本地表。两者独立 —— 市场更新不影响用户本地版本，除非用户主动点 "更新"。
- **更新** = 把市场最新版本拷贝到用户本地，覆盖当前配置。只有用户主动触发才执行。

避免引用链、级联更新、部分归属歧义。一套模型，一套逻辑，覆盖三种类型。

### 3.2 Identifier 体系

| 概念             | 字段                                      | 作用范围                       | 可变性                             |
| ---------------- | ----------------------------------------- | ------------------------------ | ---------------------------------- |
| **市场唯一标识** | `identifier`（市场表）                    | 全局唯一                       | 创建后不可变                       |
| **发布目标**     | `marketIdentifier`（本地表）              | 指向该工具发布到市场的条目     | 重新发布时可能变化                 |
| **安装来源**     | `installedFromMarketIdentifier`（本地表） | 指向该工具从市场安装的来源条目 | 安装后永不变化 —— 用于按钮状态判断 |

**核心规则：identifier 相同 = 同一个工具。** 用户修改工具后再发布，必须使用新 identifier（创建独立的市场条目）。原 identifier 仍属于原工具。

### 3.3 Bundled 工具的 visibility 机制

发布助理时，附属 Skill 和 MCP 分为三种情况：

| 来源                          | 处理方式         | 市场可见性                 |
| ----------------------------- | ---------------- | -------------------------- |
| 已在市场的（source='market'） | 跳过，不重复发布 | 保持 'public'              |
| 用户自建，**选择了跟随发布**  | 发布到市场       | 'public' — 市场列表可见    |
| 用户自建，**未选择跟随发布**  | 仍然存入市场表   | 'bundled' — 市场列表不可见 |

bundled 工具特性：

- 不出现在市场列表 / 搜索页
- 仍存入 `market_skills`/`market_mcps` 表（安装逻辑统一从这些表读取）
- 发布者后续可独立发布，将 visibility 从 'bundled' 改为 'public'

### 3.4 后端代码组织

- **tRPC 路由**：保留现有路由名和签名（如 `market.getAssistantList`），仅重写内部 service 实现 —— 从代理官方 API 改为查询本地数据库
- **新 service**：`CommunityService` 替代 `DiscoverService`/`MarketService`，实现所有 CRUD 和查询逻辑
- **认证**：标准 Better Auth 中间件（`ctx.userId`），移除 `marketSDK` 和 `marketUserInfo` 中间件
- **前端**：读操作的 Service/Store 零改动，仅新增发布 / 安装 / 更新的 action 调用

---

## 4. 数据库设计

### 4.1 新增市场表

三张独立表，与现有前端类型分离模式一致。

#### `market_agents`

| 字段              | 类型          | 必填 | 默认值      | 说明                                        |
| ----------------- | ------------- | ---- | ----------- | ------------------------------------------- |
| id                | text (PK)     | ✅   | idGenerator | 主键                                        |
| identifier        | text (UNIQUE) | ✅   | —           | 市场全局唯一标识                            |
| title             | varchar(255)  | ❌   | —           | 助理名称                                    |
| description       | varchar(1000) | ❌   | —           | 描述                                        |
| avatar            | text          | ❌   | —           | 头像 URL                                    |
| background_color  | text          | ❌   | —           | 背景颜色                                    |
| category          | varchar(50)   | ❌   | —           | 分类（varchar 方便后续调整）                |
| tags              | jsonb         | ❌   | \[]         | 标签数组                                    |
| system_role       | text          | ❌   | —           | 系统提示词                                  |
| model             | text          | ❌   | —           | 模型标识                                    |
| provider          | text          | ❌   | —           | 模型服务商                                  |
| plugins           | jsonb         | ❌   | —           | MCP identifier 列表 string \[]              |
| skills            | jsonb         | ❌   | \[]         | Skill identifier 列表 string \[] — **新增** |
| chat_config       | jsonb         | ❌   | —           | 聊天配置                                    |
| few_shots         | jsonb         | ❌   | —           | 示例对话                                    |
| opening_message   | text          | ❌   | —           | 开场白                                      |
| opening_questions | text\[]       | ❌   | \[]         | 开场问题                                    |
| editor_data       | jsonb         | ❌   | —           | 编辑器数据                                  |
| token_usage       | integer       | ❌   | 0           | 系统提示词 token 估算量                     |
| plugin_count      | integer       | ❌   | 0           | MCP 数量                                    |
| knowledge_count   | integer       | ❌   | 0           | 知识库数量                                  |
| install_count     | integer       | ❌   | 0           | 安装次数（安装时原子递增）                  |
| version           | integer       | ✅   | 1           | 版本号（整数）                              |
| status            | varchar(20)   | ✅   | 'published' | published / unpublished / archived          |
| publisher_id      | text          | ✅   | —           | FK → users.id                               |
| deleted_at        | timestamptz   | ❌   | null        | 假删除时间                                  |
| created_at        | timestamptz   | ✅   | now()       |                                             |
| updated_at        | timestamptz   | ✅   | now()       |                                             |

**索引**：identifier（唯一）、publisher_id、category、status、install_count DESC、updated_at DESC

> 注意：`market_agents` 无 `visibility` 字段 —— 助理发布后始终可见。visibility 仅适用于 Skill 和 MCP。

#### `market_skills`

| 字段            | 类型          | 必填 | 默认值      | 说明                                       |
| --------------- | ------------- | ---- | ----------- | ------------------------------------------ |
| id              | text (PK)     | ✅   | idGenerator | 主键                                       |
| identifier      | text (UNIQUE) | ✅   | —           | 市场全局唯一标识                           |
| name            | text          | ✅   | —           | Skill 名称                                 |
| description     | text          | ✅   | —           | 描述                                       |
| icon            | text          | ❌   | —           | 图标 URL 或 emoji                          |
| category        | varchar(50)   | ❌   | —           | 分类                                       |
| tags            | jsonb         | ❌   | \[]         | 标签数组                                   |
| content         | text          | ❌   | —           | SKILL.md 内容                              |
| manifest        | jsonb         | ✅   | {}          | 完整 manifest                              |
| resources       | jsonb         | ❌   | {}          | 资源文件映射                               |
| editor_data     | jsonb         | ❌   | —           | 编辑器数据                                 |
| install_count   | integer       | ❌   | 0           | 安装次数                                   |
| resources_count | integer       | ❌   | 0           | 资源文件数量                               |
| version         | varchar(20)   | ✅   | '1.0.0'     | 版本号（字符串，对齐前端类型）             |
| visibility      | varchar(10)   | ✅   | 'public'    | 'public' 列表可见 / 'bundled' 随助理不可见 |
| status          | varchar(20)   | ✅   | 'published' | published / unpublished / archived         |
| publisher_id    | text          | ✅   | —           | FK → users.id                              |
| deleted_at      | timestamptz   | ❌   | null        | 假删除时间                                 |
| created_at      | timestamptz   | ✅   | now()       |                                            |
| updated_at      | timestamptz   | ✅   | now()       |                                            |

**索引**：identifier（唯一）、publisher_id、category、status、visibility、install_count DESC、updated_at DESC、name

#### `market_mcps`

| 字段            | 类型          | 必填 | 默认值      | 说明                                                |
| --------------- | ------------- | ---- | ----------- | --------------------------------------------------- |
| id              | text (PK)     | ✅   | idGenerator | 主键                                                |
| identifier      | text (UNIQUE) | ✅   | —           | 市场全局唯一标识                                    |
| name            | text          | ❌   | —           | MCP 名称                                            |
| description     | text          | ❌   | —           | 描述                                                |
| icon            | text          | ❌   | —           | 图标 URL 或 emoji                                   |
| category        | varchar(50)   | ❌   | —           | 分类                                                |
| tags            | jsonb         | ❌   | \[]         | 标签数组                                            |
| overview        | text          | ❌   | —           | README / 详细描述                                   |
| connection_type | varchar(10)   | ✅   | 'http'      | 连接类型：http /stdio/cloud                         |
| manifest        | jsonb         | ❌   | —           | 插件 manifest（含 tools/prompts/resources schemas） |
| custom_params   | jsonb         | ❌   | —           | 连接配置（url, command, args, env, auth, headers）  |
| capabilities    | jsonb         | ❌   | —           | 能力标识 {tools, prompts, resources}                |
| tools_count     | integer       | ❌   | 0           | 工具数量                                            |
| prompts_count   | integer       | ❌   | 0           | 提示数量                                            |
| resources_count | integer       | ❌   | 0           | 资源数量                                            |
| install_count   | integer       | ❌   | 0           | 安装次数                                            |
| version         | varchar(20)   | ✅   | '1.0.0'     | 版本号（字符串）                                    |
| visibility      | varchar(10)   | ✅   | 'public'    | 'public' / 'bundled'                                |
| status          | varchar(20)   | ✅   | 'published' | published / unpublished / archived                  |
| publisher_id    | text          | ✅   | —           | FK → users.id                                       |
| deleted_at      | timestamptz   | ❌   | null        | 假删除时间                                          |
| created_at      | timestamptz   | ✅   | now()       |                                                     |
| updated_at      | timestamptz   | ✅   | now()       |                                                     |

**索引**：identifier（唯一）、publisher_id、category、connection_type、status、visibility、install_count DESC、updated_at DESC

### 4.2 用户本地表变更

现有用户本地表新增字段，支持安装追踪和修改检测：

| 表                   | 新增字段                         | 类型              | 用途                                                |
| -------------------- | -------------------------------- | ----------------- | --------------------------------------------------- |
| agents               | skills                           | jsonb (string\[]) | Skill identifier 列表，与现有 plugins 字段对称      |
| agents               | installed_from_market_identifier | text              | 安装来源市场条目 identifier（不可变）— 按钮状态判断 |
| agents               | installed_from_snapshot          | jsonb             | 安装时的原始配置备份 — 修改检测                     |
| agents               | installed_market_version         | integer           | 安装时的市场版本号                                  |
| agentSkills          | market_identifier                | text              | 当前发布的市场条目 identifier（发布后可能变）       |
| agentSkills          | installed_from_market_identifier | text              | 安装来源市场条目 identifier（不可变）               |
| agentSkills          | installed_from_snapshot          | jsonb             | 安装时的原始配置备份                                |
| agentSkills          | installed_market_version         | varchar(20)       | 安装时的市场版本号                                  |
| userInstalledPlugins | market_identifier                | text              | 当前发布的市场条目 identifier                       |
| userInstalledPlugins | installed_from_market_identifier | text              | 安装来源市场条目 identifier（不可变）               |
| userInstalledPlugins | installed_from_snapshot          | jsonb             | 安装时的原始配置备份                                |
| userInstalledPlugins | installed_market_version         | varchar(20)       | 安装时的市场版本号                                  |

> 注意：`agents` 表已有 `marketIdentifier` 字段，不需要重复添加。

### 4.3 Drizzle Schema 文件

`packages/database/src/schemas/` 中新增：

- `marketAgent.ts` — `market_agents` 表定义
- `marketSkill.ts` — `market_skills` 表定义
- `marketMcp.ts` — `market_mcps` 表定义

现有 schema 文件修改：

- `agent.ts` — 新增 `skills`、`installedFromMarketIdentifier`、`installedFromSnapshot`、`installedMarketVersion` 列
- `agentSkill.ts` — 新增 `marketIdentifier`、`installedFromMarketIdentifier`、`installedFromSnapshot`、`installedMarketVersion` 列
- `user.ts`（userInstalledPlugins 部分）— 新增 `marketIdentifier`、`installedFromMarketIdentifier`、`installedFromSnapshot`、`installedMarketVersion` 列

### 4.4 数据库迁移

使用现有 Drizzle 迁移流程（`packages/database/` 目录下执行 `bunx drizzle-kit generate`）。所有新表和字段变更合并为一个迁移文件。

---

## 5. API 设计

### 5.1 tRPC 路由结构

保留现有路由名，重写内部实现。

```
src/server/routers/lambda/market/
├── agent.ts    # market.getAssistantList, market.getAssistantDetail, market.publishAgent, market.updateAgent, market.delistAgent
├── skill.ts    # market.getSkillList, market.getSkillDetail, market.publishSkill, market.updateSkill, market.delistSkill
├── mcp.ts      # market.getMcpList, market.getMcpDetail, market.publishMcp, market.updateMcp, market.delistMcp
├── social.ts   # 移除（收藏/评分，不需要）
└── oidc.ts     # 移除（Market Auth OIDC，已用 Better Auth 替代）
```

### 5.2 关键 API 端点

#### 列表查询

所有列表端点共享参数：`{ keyword?, category?, page, pageSize, sortBy? }`

Skill 和 MCP 列表额外加 `visibility: 'public'` 过滤。MCP 加 `connectionType?` 过滤。

列表 SQL 基线条件：`WHERE visibility='public' AND status='published' AND deleted_at IS NULL`

#### 发布 / 更新

| 端点                  | 行为                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `market.publishAgent` | 从用户本地助理配置创建 `market_agents` 行。处理附属 Skill/MCP 的 visibility。返回市场 identifier。                         |
| `market.updateAgent`  | 把用户当前配置重新拷贝到已有的 `market_agents` 行（按 identifier 匹配）。version +1。一并重新拷贝所有附属 Skill/MCP 数据。 |
| `market.publishSkill` | 从用户本地 Skill 配置创建 `market_skills` 行。                                                                             |
| `market.updateSkill`  | 重新拷贝到已有的 `market_skills` 行。version 递增。                                                                        |
| `market.publishMcp`   | 创建 `market_mcps` 行。必须包含 manifest/customParams（来自连接测试）。capabilities/count 从 manifest 自动提取。           |
| `market.updateMcp`    | 重新拷贝到已有的 `market_mcps` 行。                                                                                        |

所有发布 / 更新端点：

- 要求已认证用户（`ctx.userId`）
- 设置 `publisher_id = ctx.userId`
- 在市场表存储完整配置快照

#### 安装 / 更新（客户端触发）

| 操作       | 逻辑                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装助理   | 拷贝 `market_agents` 行 → 用户本地 `agents` 新行。拷贝 skills/plugins 引用的所有 Skill/MCP 从 `market_skills`/`market_mcps` → 用户本地表。所有拷贝行设置 `installedFromMarketIdentifier` 和 `installedFromSnapshot`。 |
| 安装 Skill | 拷贝 `market_skills` 行 → `agentSkills` 新行，设置追踪字段。                                                                                                                                                          |
| 安装 MCP   | 拷贝 `market_mcps` 行 → `userInstalledPlugins` 新行，设置追踪字段。                                                                                                                                                   |
| 更新助理   | 用市场最新配置覆盖用户本地 `agents` 行。一并覆盖所有引用的 Skill/MCP 为市场最新版本。                                                                                                                                 |
| 更新 Skill | 用市场最新覆盖 `agentSkills` 行，更新 `installedFromSnapshot` 和 `installedMarketVersion`。                                                                                                                           |
| 更新 MCP   | 用市场最新覆盖 `userInstalledPlugins` 行，更新追踪字段。                                                                                                                                                              |

#### 下线

`market.delistAgent/Skill/Mcp` → 设置 `deleted_at = now()`、`status = 'unpublished'`。假删除，列表查询自动过滤。可重新上线（清空 `deleted_at`）。

#### 安装计数递增

只给**顶层安装的工具** `install_count + 1`。安装助理只递增 `market_agents.install_count`，附属 Skill/MCP 不递增（属于助理打包安装）。独立安装 Skill/MCP 时才递增各自表的 `install_count`。

实现方式：原子递增 `UPDATE market_* SET install_count = install_count + 1 WHERE identifier = ?`

---

## 6. 前端变更

### 6.1 需要删除 / 隐藏的模块

**需求文档已确定删除的（社交 / 外部链接类）：**

| 类型  | 删除项                                                                                    |
| ----- | ----------------------------------------------------------------------------------------- |
| Skill | 收藏、评论、评分、github 相关信息、安装方式、相关技能、需要帮助、查看源码、报告问题       |
| MCP   | 是否验证、收藏、评分、github 相关信息、技术栈类型、相关推荐、需要帮助、查看源码、报告问题 |
| 助理  | 收藏、相似助理、需要帮助等                                                                |

**讨论后新增删除的：**

| 类型  | 删除项                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| 助理  | Fork 标记 → 改为安装数量标记。"派生并聊天" 按钮 → 改为 "安装并聊天"。相关助理 Tab。侧边栏相关助理。群组助理标签。 |
| Skill | Featured 徽章。许证 (License)。VSCode 安装按钮。                                                                  |
| MCP   | Official 徽章。Claimed 徽章。Featured 徽章。许证 (License)。Score Tab。相关 MCP。Market Auth 认证入口。           |

**术语调整：**

| 原术语           | 新术语       |
| ---------------- | ------------ |
| Fork 数量徽章    | 安装数量徽章 |
| "派生并聊天"     | "安装并聊天" |
| "添加到我的助理" | "安装助理"   |

### 6.2 保留的功能

完整保留列表见决策记录 §10。概要：

- 列表页：搜索、排序、分类筛选、分页、创建按钮
- 详情页：头部信息、概览 / 配置 Tab、侧边栏导航 + 安装按钮
- 卡片组件：头像、标题、作者、描述、统计、分类、更新时间

### 6.3 新增前端功能

| 功能            | 适用类型         | 说明                                                                                                 |           |        |                  |
| --------------- | ---------------- | ---------------------------------------------------------------------------------------------------- | --------- | ------ | ---------------- |
| 发布 / 更新按钮 | 助理、Skill、MCP | 本地工具管理页面的操作菜单。文案区分 "发布到市场" vs "更新到市场"。                                  |           |        |                  |
| 安装按钮状态    | 助理、Skill、MCP | 市场详情页。基于 `installedFromMarketIdentifier` + 修改状态显示 "安装" / "更新" / "更新（带警告）"。 |           |        |                  |
| 跟随发布选择    | 助理发布流程     | 确认弹窗内嵌入 Skill/MCP 选择区域："已在市场的"（灰色锁定）+ "你的私有"（可勾选）。                  |           |        |                  |
| MCP 发布表单    | MCP              | 复用 MCPManifestForm 填写连接配置 + 测试。名称 / 描述从 manifest 自动填入。                          |           |        |                  |
| 下线状态        | 所有类型         | "更新" 按钮禁用 + 提示 "原工具已下线"。                                                              |           |        |                  |
| 来源标记        | Skill、MCP       | 显示 source='market'                                                                                 | 'bundled' | 'user' | 'builtin' 标签。 |

### 6.4 按钮状态判断逻辑

市场详情页的安装 / 更新按钮状态：

```
1. 查本地表是否有 installedFromMarketIdentifier = 市场 identifier 的记录
2. 无记录 → 显示"安装"
3. 有记录：
   a. 对比当前配置 vs installedFromSnapshot
   b. 未修改 → 显示"更新"（直接覆盖）
   c. 已修改 + marketIdentifier 无值 → 显示"更新" + 警告"检测到修改，是否更新？"
   d. 已修改 + marketIdentifier 有值 → 显示"安装"（与原工具失去联系，安装一份独立的副本）
4. 市场 deleted_at 有值 → "更新"按钮禁用 + 提示"原工具已下线"
```

---

## 7. 生命周期流程

### 7.1 助理发布流程

```
用户在助理 profile 页点击"发布到市场"
→ Better Auth 会话认证
→ 验证：标题 + systemRole 必填
→ 显示确认弹窗：
   ├── "已在市场的 Skill/MCP"（灰色锁定）
   └── "你的私有 Skill/MCP"（可勾选）
→ 用户确认
→ 后端：
   ├── 创建 market_agents 行（从本地 agents 拷贝）
   ├── 遍历 skills/plugins 中的每个 Skill/MCP identifier：
   │   ├── 市场表已有 → 跳过
   │   ├── 选择了跟随发布 → 创建 visibility='public'
   │   └── 未选择跟随 → 创建 visibility='bundled'
   └ 设置本地 agent.marketIdentifier = 市场 identifier
→ Toast 成功 + 市场详情页链接
```

### 7.2 助理安装流程

> **知识库不在助理安装范围内。** `market_agents` 表的 `knowledge_count` 仅作为元数据字段。用户安装助理时获得的是助理配置（系统提示词、plugins、skills、chat config 等），不包括原发布者的知识库文件。用户可以自行给安装的助理添加知识库。

```
用户在市场详情页点击"安装"
→ 后端：
   ├── 拷贝 market_agents 行 → 新建本地 agents 行
   │   设置 installedFromMarketIdentifier, installedFromSnapshot, installedMarketVersion
   ├── 遍历 skills 数组中每个 Skill identifier：
   │   ├── 用户本地已有同 identifier → 跳过，更新 source 标记
   │   ├── 拷贝 market_skills 行 → 新建本地 agentSkills 行
   │   │   设置追踪字段，source = 'market' 或 'bundled'
   ├── 遍历 plugins 数组中每个 MCP identifier：
   │   ├── 同 Skill 逻辑
   ├── 递增 market_agents.install_count
→ 导航到与新助理聊天
```

### 7.3 助理更新流程

```
用户在市场详情页点击"更新"
→ 若已修改（当前配置 ≠ installedFromSnapshot）：
   ├── marketIdentifier 无值 → 警告"检测到修改，是否更新？" → 确认后继续
   ├── marketIdentifier 有值 → 改为"安装"（独立副本，不走更新逻辑）
→ 后端：
   ├── 用市场最新配置覆盖本地 agents 行
   │   更新 installedFromSnapshot, installedMarketVersion
   ├── 用市场最新版本覆盖所有引用的 Skill/MCP
   │   （覆盖用户对附属工具的本地修改）
→ Toast 成功
```

### 7.4 Skill/MCP 的发布 / 安装 / 更新流程

与助理对称但更简单（无附属子工具）：

- **发布**：拷贝本地配置 → 市场表。入口在本地 Skill/MCP 设置页 → 操作菜单 → "发布到市场"
- **MCP 发布特殊要求**：必须先测试连接成功；capabilities/count 从 manifest 自动提取
- **安装**：拷贝市场行 → 本地表，设置追踪字段，递增 install_count
- **更新**：用市场最新覆盖本地行，更新追踪字段

### 7.5 下线 / 重新上线流程

```
发布者在市场详情页点击"下线"
→ 设置 deleted_at = now(), status = 'unpublished'
→ 市场列表查询自动过滤掉
→ 已安装用户看到"更新"按钮禁用 + "原工具已下线"提示
→ 发布者可重新上线：清空 deleted_at, status = 'published'
```

---

## 8. 边缘场景处理

| 场景                                           | 处理方式                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 重复安装同 identifier 的 Skill/MCP             | 跳过拷贝，更新 source 标记为更准确的值。identifier 相同即视为同一工具。                                                     |
| 已修改并发布 → 尝试更新原工具                  | 按钮变为 "安装" 而非 "更新"，创建一份独立副本，两份并存。                                                                   |
| 卸载被助理引用的 Skill/MCP                     | 允许卸载但提示 "该工具正被助理使用"。助理的 skills/plugins 数组不移除 identifier。助理编辑界面缺失工具的 tag 显示红色背景。 |
| 更新助理 → 覆盖用户对附属 Skill/MCP 的本地修改 | 正确行为 ——"更新" 就是采用市场版本。想保留修改则不应点 "更新"。                                                             |
| bundled → public 过渡                          | identifier 不变，仅 visibility 从 'bundled' 改为 'public'。已有 installedFromMarketIdentifier 关联不受影响。                |
| 市场工具下线，用户本地有副本                   | 本地数据不受影响。"更新" 按钮禁用 + "原工具已下线" 提示。                                                                   |
| 安装前用户本地已有同 identifier                | 跳过安装不重复拷贝，更新 source 标记。                                                                                      |

---

## 9. 搜索与筛选

| 功能             | 实现方式                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全文搜索         | PostgreSQL ILIKE 匹配 title + description：`WHERE title ILIKE '%keyword%' OR description ILIKE '%keyword%'`                                                |
| 分类筛选         | 精确匹配：`WHERE category = 'xxx'`                                                                                                                         |
| MCP 连接类型筛选 | 精确匹配：`WHERE connection_type = 'http'`                                                                                                                 |
| 列表基线过滤     | `WHERE visibility='public' AND status='published' AND deleted_at IS NULL`                                                                                  |
| 推荐排序         | 加权：`install_count + (extract(epoch from now()) - extract(epoch from updated_at)) / 86400 * 0.5 DESC` — 安装量权重 1，新鲜度（距上次更新的天数）权重 0.5 |
| 安装量排序       | `ORDER BY install_count DESC`                                                                                                                              |
| 更新时间排序     | `ORDER BY updated_at DESC`                                                                                                                                 |

移除的排序项：HaveSkills（助理）、Stars/Relevance（Skill）、IsFeatured/IsValidated（MCP）—— 依赖已删除的功能。

---

## 10. 实现范围（Phase 1）

Phase 1 交付核心的发布 / 安装 / 更新 / 下线生命周期。延后到后续阶段的功能：

| 延后项                    | 原因                                                                       |
| ------------------------- | -------------------------------------------------------------------------- |
| "我的发布" 集中管理页     | UI 复杂度高；Phase 1 用本地工具页的发布 / 更新按钮即可                     |
| 市场页直接新建 MCP 并发布 | 需要在市场上下文中完整集成 MCPManifestForm；Phase 1 只支持从本地设置页发布 |
| 分类 / 标签管理后台 UI    | 分类暂用官方枚举值；自定义分类管理 UI 后续做                               |
| 版本历史 /changelog       | 不存储版本内容；只有当前版本号                                             |
| 高级搜索（ts_vector）     | 当前数据量下 ILIKE 性能足够                                                |

---

## 11. 排除范围

- 模型 / 模型服务商市场（需求文档明确不需要）
- 收藏、评分、评论，社交功能
- GitHub 集成（stars, repo 链接，issues）
- VSCode 扩展安装
- 许证 (License) 展示
- Fork 追踪（改用安装数量替代）
- OIDC/M2M Market Auth（改用 Better Auth）
