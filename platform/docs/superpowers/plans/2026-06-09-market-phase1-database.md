# 社区市场 — Phase 1: 数据库层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增三张市场表（market_agents, market_skills, market_mcps）和修改三张用户本地表（agents, agent_skills, user_installed_plugins），生成数据库迁移。

**Architecture:** 统一拷贝模型 —— 发布 / 安装 / 更新均为表间行拷贝，通过 identifier 关联。市场表存储完整配置快照，用户本地表新增 installedFromMarketIdentifier 等追踪字段。

**Tech Stack:** Drizzle ORM + PostgreSQL + nanoid + drizzle-kit 迁移

---

## 文件变更清单

| 操作 | 文件                                                  | 责责                                                |
| ---- | ----------------------------------------------------- | --------------------------------------------------- |
| 创建 | `packages/database/src/schemas/marketAgent.ts`        | market_agents 表 schema                             |
| 创建 | `packages/database/src/schemas/marketSkill.ts`        | market_skills 表 schema                             |
| 创建 | `packages/database/src/schemas/marketMcp.ts`          | market_mcps 表 schema                               |
| 修改 | `packages/database/src/schemas/agent.ts`              | agents 表新增 4 列                                  |
| 修改 | `packages/database/src/schemas/agentSkill.ts`         | agentSkills 表新增 4 列 + source enum 扩展          |
| 修改 | `packages/database/src/schemas/user.ts`               | userInstalledPlugins 表新增 4 列 + source enum 扩展 |
| 修改 | `packages/database/src/schemas/relations.ts`          | 新增市场表 relations                                |
| 修改 | `packages/database/src/schemas/index.ts`              | 新增 3 个 export                                    |
| 修改 | `packages/database/src/utils/idGenerator.ts`          | 新增 3 个 prefix                                    |
| 修改 | `packages/database/src/types.ts`                      | 新增市场表类型导出（如有集中类型文件）              |
| 创建 | `packages/database/src/models/marketAgent.ts`         | MarketAgentModel                                    |
| 创建 | `packages/database/src/models/marketSkill.ts`         | MarketSkillModel                                    |
| 创建 | `packages/database/src/models/marketMcp.ts`           | MarketMcpModel                                      |
| 修改 | `packages/database/src/models/index.ts`               | 新增 3 个 model 导出                                |
| 生成 | `packages/database/migrations/0095_market_tables.sql` | 迁移文件                                            |

---

### Task 1: idGenerator 新增 prefix

**Files:**

- Modify: `packages/database/src/utils/idGenerator.ts`

- [ ] **Step 1: 在 prefixes 对象中新增市场表前缀**

```ts
// 在现有 prefixes 对象中添加：
const prefixes = {
  agentCronJobs: 'cron',
  agentSkills: 'skl',
  agents: 'agt',
  // ... 保留已有项 ...
  marketAgents: 'mkagt', // 新增
  marketSkills: 'mkskl', // 新增
  marketMcps: 'mkmcps', // 新增
  plugins: 'plg',
  // ... 保留已有项 ...
} as const;
```

- [ ] **Step 2: 验证 idGenerator 函数签名兼容**

idGenerator 已接受 `namespace: keyof typeof prefixes`，新增 prefix 后自动兼容。无需修改函数体。

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/utils/idGenerator.ts
git commit -m "🏗️ add market table id prefixes to idGenerator"
```

---

### Task 2: market_agents 表 schema

**Files:**

- Create: `packages/database/src/schemas/marketAgent.ts`

- [ ] **Step 1: 创建 marketAgent.ts schema 文件**

```ts
import type {
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  LobeAgentTTSConfig,
} from '@lobechat/types';
import { index, integer, jsonb, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import { idGenerator } from '../utils/idGenerator';
import { timestamps, varchar255 } from './_helpers';
import { users } from './user';

export const marketAgents = pgTable(
  'market_agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketAgents'))
      .notNull(),
    identifier: text('identifier').notNull(),

    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    systemRole: text('system_role'),
    model: text('model'),
    provider: text('provider'),
    plugins: jsonb('plugins').$type<string[]>(),
    skills: jsonb('skills').$type<string[]>().default([]),

    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),
    fewShots: jsonb('few_shots'),
    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    editorData: jsonb('editor_data'),

    tokenUsage: integer('token_usage').default(0),
    pluginCount: integer('plugin_count').default(0),
    knowledgeCount: integer('knowledge_count').default(0),
    installCount: integer('install_count').default(0),

    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('published'),

    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    deletedAt:
      timestamps.createdAt.__type__ === 'timestamp'
        ? // deletedAt 不需要 defaultNow，使用 nullable timestamptz
          undefined
        : undefined,
    createdAt: timestamps.createdAt,
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    uniqueIndex('market_agents_identifier_unique').on(t.identifier),
    index('market_agents_publisher_id_idx').on(t.publisherId),
    index('market_agents_category_idx').on(t.category),
    index('market_agents_status_idx').on(t.status),
    index('market_agents_install_count_idx').on(t.installCount),
    index('market_agents_updated_at_idx').on(t.updatedAt),
  ],
);

// deletedAt 需要单独定义（nullable timestamptz，无 defaultNow）
// 重新定义完整的表以包含 deletedAt
```

上面的代码缺少 deletedAt—— 因为 `_helpers.ts` 的 `timestamps` 只提供 `createdAt`/`updatedAt`/`accessedAt`（都是 `notNull().defaultNow()`），而 `deletedAt` 需要 nullable。需要手动添加。修正后的完整文件：

```ts
import type {
  LobeAgentAgencyConfig,
  LobeAgentChatConfig,
  LobeAgentTTSConfig,
} from '@lobechat/types';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';
import { z } from 'zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, updatedAt, varchar255 } from './_helpers';
import { users } from './user';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const marketAgents = pgTable(
  'market_agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketAgents'))
      .notNull(),
    identifier: text('identifier').notNull(),

    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 1000 }),
    avatar: text('avatar'),
    backgroundColor: text('background_color'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    systemRole: text('system_role'),
    model: text('model'),
    provider: text('provider'),
    plugins: jsonb('plugins').$type<string[]>(),
    skills: jsonb('skills').$type<string[]>().default([]),

    chatConfig: jsonb('chat_config').$type<LobeAgentChatConfig>(),
    fewShots: jsonb('few_shots'),
    openingMessage: text('opening_message'),
    openingQuestions: text('opening_questions').array().default([]),

    editorData: jsonb('editor_data'),

    tokenUsage: integer('token_usage').default(0),
    pluginCount: integer('plugin_count').default(0),
    knowledgeCount: integer('knowledge_count').default(0),
    installCount: integer('install_count').default(0),

    version: integer('version').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('published'),

    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('market_agents_identifier_unique').on(t.identifier),
    index('market_agents_publisher_id_idx').on(t.publisherId),
    index('market_agents_category_idx').on(t.category),
    index('market_agents_status_idx').on(t.status),
    index('market_agents_install_count_idx').on(t.installCount),
    index('market_agents_updated_at_idx').on(t.updatedAt),
  ],
);

export const insertMarketAgentSchema = createInsertSchema(marketAgents);

export type NewMarketAgent = typeof marketAgents.$inferInsert;
export type MarketAgentItem = typeof marketAgents.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/schemas/marketAgent.ts
git commit -m "🏗️ add market_agents table schema"
```

---

### Task 3: market_skills 表 schema

**Files:**

- Create: `packages/database/src/schemas/marketSkill.ts`

- [ ] **Step 1: 创建 marketSkill.ts schema 文件**

```ts
import type { SkillManifest, SkillResourceMeta } from '@lobechat/types';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const marketSkills = pgTable(
  'market_skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketSkills'))
      .notNull(),
    identifier: text('identifier').notNull(),

    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    content: text('content'),
    manifest: jsonb('manifest')
      .$type<SkillManifest>()
      .notNull()
      .default({} as SkillManifest),
    resources: jsonb('resources').$type<Record<string, SkillResourceMeta>>().default({}),
    editorData: jsonb('editor_data').$type<Record<string, any>>(),

    installCount: integer('install_count').default(0),
    resourcesCount: integer('resources_count').default(0),

    version: varchar('version', { length: 20 }).notNull().default('1.0.0'),
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
    status: varchar('status', { length: 20 }).notNull().default('published'),

    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('market_skills_identifier_unique').on(t.identifier),
    index('market_skills_publisher_id_idx').on(t.publisherId),
    index('market_skills_category_idx').on(t.category),
    index('market_skills_status_idx').on(t.status),
    index('market_skills_visibility_idx').on(t.visibility),
    index('market_skills_install_count_idx').on(t.installCount),
    index('market_skills_updated_at_idx').on(t.updatedAt),
    index('market_skills_name_idx').on(t.name),
  ],
);

export const insertMarketSkillSchema = createInsertSchema(marketSkills);

export type NewMarketSkill = typeof marketSkills.$inferInsert;
export type MarketSkillItem = typeof marketSkills.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/schemas/marketSkill.ts
git commit -m "🏗️ add market_skills table schema"
```

---

### Task 4: market_mcps 表 schema

**Files:**

- Create: `packages/database/src/schemas/marketMcp.ts`

- [ ] **Step 1: 创建 marketMcp.ts schema 文件**

```ts
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, updatedAt } from './_helpers';
import { users } from './user';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const marketMcps = pgTable(
  'market_mcps',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('marketMcps'))
      .notNull(),
    identifier: text('identifier').notNull(),

    name: text('name'),
    description: text('description'),
    icon: text('icon'),
    category: varchar('category', { length: 50 }),
    tags: jsonb('tags').$type<string[]>().default([]),

    overview: text('overview'),
    connectionType: varchar('connection_type', { length: 10 }).notNull().default('http'),
    manifest: jsonb('manifest'),
    customParams: jsonb('custom_params'),
    capabilities: jsonb('capabilities').$type<{
      tools?: boolean;
      prompts?: boolean;
      resources?: boolean;
    }>(),

    toolsCount: integer('tools_count').default(0),
    promptsCount: integer('prompts_count').default(0),
    resourcesCount: integer('resources_count').default(0),
    installCount: integer('install_count').default(0),

    version: varchar('version', { length: 20 }).notNull().default('1.0.0'),
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
    status: varchar('status', { length: 20 }).notNull().default('published'),

    publisherId: text('publisher_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    deletedAt: timestamptz('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('market_mcps_identifier_unique').on(t.identifier),
    index('market_mcps_publisher_id_idx').on(t.publisherId),
    index('market_mcps_category_idx').on(t.category),
    index('market_mcps_connection_type_idx').on(t.connectionType),
    index('market_mcps_status_idx').on(t.status),
    index('market_mcps_visibility_idx').on(t.visibility),
    index('market_mcps_install_count_idx').on(t.installCount),
    index('market_mcps_updated_at_idx').on(t.updatedAt),
  ],
);

export const insertMarketMcpSchema = createInsertSchema(marketMcps);

export type NewMarketMcp = typeof marketMcps.$inferInsert;
export type MarketMcpItem = typeof marketMcps.$inferSelect;
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/schemas/marketMcp.ts
git commit -m "🏗️ add market_mcps table schema"
```

---

### Task 5: 修改 agents 表 — 新增 4 列

**Files:**

- Modify: `packages/database/src/schemas/agent.ts`

- [ ] **Step 1: 在 agents 表中新增 skills, installedFromMarketIdentifier, installedFromSnapshot, installedMarketVersion 列**

在 `marketIdentifier: text('market_identifier'),` 之后添加：

```ts
    // 原有字段
    marketIdentifier: text('market_identifier'),
    skills: jsonb('skills').$type<string[]>().default([]),
    installedFromMarketIdentifier: text('installed_from_market_identifier'),
    installedFromSnapshot: jsonb('installed_from_snapshot'),
    installedMarketVersion: integer('installed_market_version'),
```

注意：`agents` 表已有 `marketIdentifier` 字段（规格 4.2 明确说 "不需要重复添加"）。新增 4 个字段插在 `marketIdentifier` 之后。

- [ ] **Step 2: 新增索引**

在 index 数组中添加：

```ts
    index('agents_installed_from_market_identifier_idx').on(t.installedFromMarketIdentifier),
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/schemas/agent.ts
git commit -m "🏗️ add skills + install tracking columns to agents table"
```

---

### Task 6: 修改 agentSkills 表 — 新增 4 列 + 扩展 source enum

**Files:**

- Modify: `packages/database/src/schemas/agentSkill.ts`

- [ ] **Step 1: 扩展 source enum 并新增追踪列**

将 `source` 字段从 3 值 enum 改为 5 值 enum：

```ts
    // 修改前
    source: text('source', { enum: ['builtin', 'market', 'user'] }).notNull(),
    // 修改后
    source: text('source', { enum: ['builtin', 'market', 'bundled', 'user', 'installed'] }).notNull(),
```

在 `userId` 之后、`...timestamps` 之前添加 4 个追踪字段：

```ts
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // 市场追踪字段
    marketIdentifier: text('market_identifier'),
    installedFromMarketIdentifier: text('installed_from_market_identifier'),
    installedFromSnapshot: jsonb('installed_from_snapshot'),
    installedMarketVersion: varchar('installed_market_version', { length: 20 }),

    ...timestamps,
```

- [ ] **Step 2: 新增索引**

```ts
    index('agent_skills_market_identifier_idx').on(t.marketIdentifier),
    index('agent_skills_installed_from_market_identifier_idx').on(t.installedFromMarketIdentifier),
```

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/schemas/agentSkill.ts
git commit -m "🏗️ add market tracking columns and expand source enum in agentSkills"
```

---

### Task 7: 修改 userInstalledPlugins 表 — 新增 4 列 + 扩展 source enum

**Files:**

- Modify: `packages/database/src/schemas/user.ts`

- [ ] **Step 1: 新增追踪列**

在 `source: varchar255('source'),` 之后、`...timestamps` 之前添加：

```ts
    source: varchar255('source'),

    // 市场追踪字段
    marketIdentifier: text('market_identifier'),
    installedFromMarketIdentifier: text('installed_from_market_identifier'),
    installedFromSnapshot: jsonb('installed_from_snapshot'),
    installedMarketVersion: varchar('installed_market_version', { length: 20 }),

    ...timestamps,
```

注意：`userInstalledPlugins` 的 `source` 当前是 `varchar255`（不是 enum），规格中需要区分 `market`/`bundled`/`user`/`builtin`/`installed`。由于它用 varchar 而非 text enum，不需要改类型 —— 只需在业务逻辑中限定值。但为了类型安全，建议改为 text enum：

```ts
    // 修改前
    source: varchar255('source'),
    // 修改后
    source: text('source', { enum: ['market', 'bundled', 'user', 'builtin', 'installed'] }),
```

- [ ] **Step 2: 新增索引（需要检查现有索引定义）**

`userInstalledPlugins` 使用 composite PK `(userId, identifier)`，没有单独的 index 块。需要在表定义的第三个参数（当前是 `(self) => ({ id: primaryKey(...) })`）中添加索引：

```ts
  (self) => ({
    id: primaryKey({ columns: [self.userId, self.identifier] }),
    // 新增索引 — 需要引入 index 函数
  }),
```

但 Drizzle 的 pgTable 第三个参数不能混用 primaryKey object 和 index 函数数组。需要重构为返回数组的形式：

```ts
  (t) => [
    primaryKey({ columns: [t.userId, t.identifier] }),
    index('user_installed_plugins_market_identifier_idx').on(t.marketIdentifier),
    index('user_installed_plugins_installed_from_market_identifier_idx').on(t.installedFromMarketIdentifier),
  ],
```

需要在文件顶部导入中确保 `index` 已导入。

- [ ] **Step 3: Commit**

```bash
git add packages/database/src/schemas/user.ts
git commit -m "🏗️ add market tracking columns to userInstalledPlugins"
```

---

### Task 8: 新增市场表 relations

**Files:**

- Modify: `packages/database/src/schemas/relations.ts`

- [ ] **Step 1: 在 relations.ts 中新增市场表关系定义**

在文件顶部导入中添加：

```ts
import { marketAgents } from './marketAgent';
import { marketSkills } from './marketSkill';
import { marketMcps } from './marketMcp';
```

在文件末尾（最后一个 relations 定义之后）添加：

```ts
// Market Agent relations
export const marketAgentsRelations = relations(marketAgents, ({ one }) => ({
  publisher: one(users, {
    fields: [marketAgents.publisherId],
    references: [users.id],
  }),
}));

// Market Skill relations
export const marketSkillsRelations = relations(marketSkills, ({ one }) => ({
  publisher: one(users, {
    fields: [marketSkills.publisherId],
    references: [users.id],
  }),
}));

// Market MCP relations
export const marketMcpsRelations = relations(marketMcps, ({ one }) => ({
  publisher: one(users, {
    fields: [marketMcps.publisherId],
    references: [users.id],
  }),
}));
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/schemas/relations.ts
git commit -m "🏗️ add market table relations"
```

---

### Task 9: 更新 schema index 导出

**Files:**

- Modify: `packages/database/src/schemas/index.ts`

- [ ] **Step 1: 新增三个 export 行**

```ts
// 在现有 export 行中按字母顺序插入（在 marketAgent 之前没有 M 开头的，插在 message 之后）
export * from './marketAgent';
export * from './marketMcp';
export * from './marketSkill';
```

注意：保持与其他文件命名一致的排序 —— 按字母顺序排列。

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/schemas/index.ts
git commit -m "🏗️ add market schema exports to index"
```

---

### Task 10: MarketAgentModel

**Files:**

- Create: `packages/database/src/models/marketAgent.ts`

- [ ] **Step 1: 创建 MarketAgentModel 类**

遵循现有 Model 模式（构造函数 `db + userId`）。关键方法：

```ts
import { and, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { marketAgents } from '../schemas/marketAgent';
import type { LobeChatDatabase } from '../types';

export class MarketAgentModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  // ===== 读取方法 =====

  /** 列表查询 — 帺线过滤 + 搜索/分类/排序/分页 */
  getList = async (params: {
    keyword?: string;
    category?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, category, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [eq(marketAgents.status, 'published'), isNull(marketAgents.deletedAt)];

    if (category) conditions.push(eq(marketAgents.category, category));
    if (keyword) {
      conditions.push(
        sql`(${marketAgents.title} ILIKE ${`%${keyword}%`} OR ${marketAgents.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);

    const orderBy =
      sortBy === 'installCount'
        ? desc(marketAgents.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketAgents.updatedAt)
          : // recommended: install_count + freshness
            desc(
              sql`${marketAgents.installCount} + (extract(epoch from now()) - extract(epoch from ${marketAgents.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select()
        .from(marketAgents)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketAgents).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  /** 按 identifier 查详情 */
  getDetail = async (identifier: string) => {
    const result = await this.db
      .select()
      .from(marketAgents)
      .where(and(eq(marketAgents.identifier, identifier), eq(marketAgents.status, 'published')))
      .limit(1);
    return result[0];
  };

  // ===== 写入方法 =====

  /** 发布 — 创建新行 */
  create = async (data: Omit<NewMarketAgent, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketAgents)
      .values({
        ...data,
        publisherId: this.userId,
      })
      .returning();
    return result;
  };

  /** 更新 — 重新拷贝配置到已有行 */
  updateByIdentifier = async (identifier: string, data: Partial<NewMarketAgent>) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        ...data,
        version: sql`${marketAgents.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  /** 下线 — 设置 deleted_at + status */
  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        status: 'unpublished',
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  /** 重新上线 — 清空 deleted_at */
  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketAgents)
      .set({
        status: 'published',
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(marketAgents.identifier, identifier), eq(marketAgents.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  /** 递增安装计数 */
  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketAgents)
      .set({
        installCount: sql`${marketAgents.installCount} + 1`,
      })
      .where(eq(marketAgents.identifier, identifier));
  };
}
```

注意：`NewMarketAgent` 类型需要从 schema 文件中导入。

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/models/marketAgent.ts
git commit -m "🏗️ add MarketAgentModel with CRUD + list + delist"
```

---

### Task 11: MarketSkillModel

**Files:**

- Create: `packages/database/src/models/marketSkill.ts`

- [ ] **Step 1: 创建 MarketSkillModel 类**

结构与 MarketAgentModel 对称，额外加 `visibility = 'public'` 过滤和 `name` 搜索：

```ts
import { and, count, desc, eq, ilike, isNull, sql } from 'drizzle-orm';

import { marketSkills } from '../schemas/marketSkill';
import type { LobeChatDatabase } from '../types';

export class MarketSkillModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getList = async (params: {
    keyword?: string;
    category?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, category, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(marketSkills.visibility, 'public'),
      eq(marketSkills.status, 'published'),
      isNull(marketSkills.deletedAt),
    ];

    if (category) conditions.push(eq(marketSkills.category, category));
    if (keyword) {
      conditions.push(
        sql`(${marketSkills.name} ILIKE ${`%${keyword}%`} OR ${marketSkills.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketSkills.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketSkills.updatedAt)
          : desc(
              sql`${marketSkills.installCount} + (extract(epoch from now()) - extract(epoch from ${marketSkills.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select()
        .from(marketSkills)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketSkills).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    const result = await this.db
      .select()
      .from(marketSkills)
      .where(and(eq(marketSkills.identifier, identifier), eq(marketSkills.status, 'published')))
      .limit(1);
    return result[0];
  };

  /** 按 identifier 查（含 bundled，用于安装逻辑） */
  findByIdentifier = async (identifier: string) => {
    const result = await this.db
      .select()
      .from(marketSkills)
      .where(eq(marketSkills.identifier, identifier))
      .limit(1);
    return result[0];
  };

  create = async (data: Omit<NewMarketSkill, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketSkills)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketSkill>) => {
    // Skill version 是 varchar，递增逻辑：split + 再拼接
    // 简化：直接在 data 中传入新 version
    const [result] = await this.db
      .update(marketSkills)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  /** bundled → public */
  makePublic = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ status: 'unpublished', deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketSkills)
      .set({ status: 'published', deletedAt: null, updatedAt: new Date() })
      .where(
        and(eq(marketSkills.identifier, identifier), eq(marketSkills.publisherId, this.userId)),
      )
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketSkills)
      .set({ installCount: sql`${marketSkills.installCount} + 1` })
      .where(eq(marketSkills.identifier, identifier));
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/models/marketSkill.ts
git commit -m "🏗️ add MarketSkillModel with CRUD + visibility + list"
```

---

### Task 12: MarketMcpModel

**Files:**

- Create: `packages/database/src/models/marketMcp.ts`

- [ ] **Step 1: 创建 MarketMcpModel 类**

与 MarketSkillModel 对称，额外加 `connectionType` 过滤：

```ts
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';

import { marketMcps } from '../schemas/marketMcp';
import type { LobeChatDatabase } from '../types';

export class MarketMcpModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  getList = async (params: {
    keyword?: string;
    category?: string;
    connectionType?: string;
    page: number;
    pageSize: number;
    sortBy?: 'recommended' | 'installCount' | 'updatedAt';
  }) => {
    const { keyword, category, connectionType, page, pageSize, sortBy } = params;
    const offset = (page - 1) * pageSize;

    const conditions = [
      eq(marketMcps.visibility, 'public'),
      eq(marketMcps.status, 'published'),
      isNull(marketMcps.deletedAt),
    ];

    if (category) conditions.push(eq(marketMcps.category, category));
    if (connectionType) conditions.push(eq(marketMcps.connectionType, connectionType));
    if (keyword) {
      conditions.push(
        sql`(${marketMcps.name} ILIKE ${`%${keyword}%`} OR ${marketMcps.description} ILIKE ${`%${keyword}%`})`,
      );
    }

    const where = and(...conditions);
    const orderBy =
      sortBy === 'installCount'
        ? desc(marketMcps.installCount)
        : sortBy === 'updatedAt'
          ? desc(marketMcps.updatedAt)
          : desc(
              sql`${marketMcps.installCount} + (extract(epoch from now()) - extract(epoch from ${marketMcps.updatedAt})) / 86400 * 0.5`,
            );

    const [data, totalResult] = await Promise.all([
      this.db
        .select()
        .from(marketMcps)
        .where(where)
        .orderBy(orderBy)
        .limit(pageSize)
        .offset(offset),
      this.db.select({ count: count() }).from(marketMcps).where(where),
    ]);

    return { data, total: totalResult[0].count };
  };

  getDetail = async (identifier: string) => {
    const result = await this.db
      .select()
      .from(marketMcps)
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.status, 'published')))
      .limit(1);
    return result[0];
  };

  findByIdentifier = async (identifier: string) => {
    const result = await this.db
      .select()
      .from(marketMcps)
      .where(eq(marketMcps.identifier, identifier))
      .limit(1);
    return result[0];
  };

  create = async (data: Omit<NewMarketMcp, 'publisherId'>) => {
    const [result] = await this.db
      .insert(marketMcps)
      .values({ ...data, publisherId: this.userId })
      .returning();
    return result;
  };

  updateByIdentifier = async (identifier: string, data: Partial<NewMarketMcp>) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  makePublic = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ visibility: 'public', updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  delist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ status: 'unpublished', deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  relist = async (identifier: string) => {
    const [result] = await this.db
      .update(marketMcps)
      .set({ status: 'published', deletedAt: null, updatedAt: new Date() })
      .where(and(eq(marketMcps.identifier, identifier), eq(marketMcps.publisherId, this.userId)))
      .returning();
    return result;
  };

  incrementInstallCount = async (identifier: string) => {
    await this.db
      .update(marketMcps)
      .set({ installCount: sql`${marketMcps.installCount} + 1` })
      .where(eq(marketMcps.identifier, identifier));
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/models/marketMcp.ts
git commit -m "🏗️ add MarketMcpModel with CRUD + visibility + connectionType filter"
```

---

### Task 13: 更新 models 导出

**Files:**

- Modify: `packages/database/src/models/index.ts` (如存在)

- [ ] **Step 1: 新增三个 model 导出**

查找 models 目录的 index 文件，添加：

```ts
export { MarketAgentModel } from './marketAgent';
export { MarketSkillModel } from './marketSkill';
export { MarketMcpModel } from './marketMcp';
```

如果没有集中导出文件，跳过此步骤（各 model 文件独立 import 即可）。

- [ ] **Step 2: Commit**

```bash
git add packages/database/src/models/index.ts
git commit -m "🏗️ add market model exports"
```

---

### Task 14: 生成数据库迁移

**Files:**

- Generate: `packages/database/migrations/0095_market_tables.sql`

- [ ] **Step 1: 运行 drizzle-kit generate**

```bash
cd packages/database && bunx drizzle-kit generate
```

预期：生成一个新迁移文件（编号延续当前最新 0094），包含：

- CREATE TABLE market_agents (所有列 + 紦引)

- CREATE TABLE market_skills (所有列 + 紦引)

- CREATE TABLE market_mcps (所有列 + 紦引)

- ALTER TABLE agents ADD COLUMN skills, installed_from_market_identifier, installed_from_snapshot, installed_market_version

- ALTER TABLE agent_skills ADD COLUMN market_identifier, installed_from_market_identifier, installed_from_snapshot, installed_market_version

- ALTER TABLE user_installed_plugins ADD COLUMN market_identifier, installed_from_market_identifier, installed_from_snapshot, installed_market_version

- [ ] **Step 2: 检查生成的迁移 SQL**

打开迁移文件，验证：

- 所有新表 CREATE TABLE 语句完整

- 所有 ALTER TABLE ADD COLUMN 语句正确

- 所有 CREATE INDEX 语句正确

- 无语法错误

- [ ] **Step 3: Commit**

```bash
git add packages/database/migrations/
git commit -m "🏗️ generate database migration for market tables"
```

---

### Task 15: 类型检查验证

- [ ] **Step 1: 运行 type-check**

```bash
bun run type-check
```

预期：通过。如果有类型错误（如 `NewMarketAgent`/`NewMarketSkill`/`NewMarketMcp` import 问题），修复后重跑。

- [ ] **Step 2: 确认所有 schema 文件在 index.ts 中正确导出**

手动验证 `packages/database/src/schemas/index.ts` 包含 `marketAgent`, `marketMcp`, `marketSkill` 的 export。

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve type-check errors for market schemas"
```

---

## 自审检查

**1. Spec 覆盖率：**

- 规格 §4.1 三张市场表 → Task 2, 3, 4 ✅
- 规格 §4.2 agents 表新增 4 列 → Task 5 ✅
- 规格 §4.2 agentSkills 表新增 4 列 + source 扩展 → Task 6 ✅
- 规格 §4.2 userInstalledPlugins 表新增 4 列 → Task 7 ✅
- 规格 §4.3 Drizzle Schema 文件 → Task 2-4 ✅
- 规格 §4.4 数据库迁移 → Task 14 ✅

**2. Placeholder 检查：** 无 TBD/TODO/ 类似占位符 ✅

**3. 类型一致性检查：**

- `idGenerator('marketAgents')` → prefix `mkagt` (Task 1 定义) ✅
- `idGenerator('marketSkills')` → prefix `mkskl` (Task 1 定义) ✅
- `idGenerator('marketMcps')` → prefix `mkmcps` (Task 1 定义) ✅
- 所有 Model 方法引用的 schema 列名与 schema 文件一致 ✅
- `deletedAt` 在三张市场表中均为 nullable timestamptz ✅
- `installedFromSnapshot` 在 agents 表用 jsonb, agentSkills 用 jsonb, userInstalledPlugins 用 jsonb ✅
- `installedMarketVersion` 在 agents 表用 integer (对齐市场表 version integer), agentSkills 用 varchar (20), userInstalledPlugins 用 varchar (20) ✅

**发现的 gap：** 规格 §4.2 说 agents 表 `installedMarketVersion` 类型为 `integer`，但 agentSkills 和 userInstalledPlugins 为 `varchar(20)`—— 这是因为 agents 的 version 是 integer 而 Skill/MCP 的 version 是 varchar。Task 5-7 已正确反映此差异。
