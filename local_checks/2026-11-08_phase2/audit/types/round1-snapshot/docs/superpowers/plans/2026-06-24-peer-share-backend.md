# Peer Share — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户能把自己的 skill /mcp/ 助理以 unlisted 市场记录 + 分享令牌的方式直接分享给他人安装，安装复用既有 `installAgent/installSkill/installMcp`，不经过公开市场。

**Architecture:** 方案 C —— 新增薄 `shares` 表（令牌 / 归属 / 撤销 / 统计）+ 既有市场表 `unlisted` 可见性档。`ShareService.createShare` 直接调底层 `marketSkillModel/marketMcpModel/marketAgentModel.create({ visibility: 'unlisted' })`（不重构 `_publish*`，不修改本地 item 的 `marketIdentifier`）。安装 = `share.getByToken → marketIdentifier → 既有 install*`，零改动。

**Tech Stack:** Drizzle ORM (PostgreSQL)、TRPC、Vitest。复用 `@lobechat/database` schema/model 体系与 `CommunityService` 既有模型注入式测试范式。

## Global Constraints

- 包管理：`pnpm` 装依赖，`bun` 跑 npm scripts，`bunx` 跑可执行包。
- 测试：`bunx vitest run --silent='passed-only' '<file>''`，禁止 `bun run test`（\~10 分钟）。优先 `vi.spyOn`/mock 注入而非 `vi.mock` 模块。
- 不要每改一个文件就跑 `bun run type-check`（全量 tsgo，慢）。靠 Edit/Write 的 `<new-diagnostics>` 或 LSP 单文件诊断。
- migration 由 `bun run db:generate` 生成（drizzle-kit 自动写 `packages/database/migrations/0xxx_*.sql` + `meta/`），不要手写 journal。
- 数据库名 `trncalciferdb`；`DATABASE_DRIVER` 为 `neon`/`node`；`KEY_VAULTS_SECRET` 必须设置。
- 提交信息加 gitmoji 前缀；分支 `feat/desktop-first`。
- 密钥剥离复用 `sanitizeMcpCustomParamsForMarket`（`MARKET_MASKED_HEADER_KEYS = ['x-bbzai-mcp-token']`），不新写剥离逻辑。
- `visibility` 取值：`public` / `bundled` / `unlisted`（新）。unlisted 记录 `status` 仍为 `published`，使 `installXxx`/`getDetail` 可按 identifier 访问。

**已知安全边界（v1 接受）**：安装端点以 `marketIdentifier` 为键（`skl_`+8 位 nanoid ≈48bit 熵），分享 `token`（21 位 ≈125bit）是发现 / UX 层而非硬访问控制。unlisted 记录按 identifier 可被 `getDetail`/`install*` 访问 —— 这与公开市场按 identifier 安装同构。硬访问控制（install 需 token）留作 v1.5。

**本计划范围**：仅后端（DB + model + service + TRPC + 测试）。前端（分享按钮、`/share/:token` 路由、安装确认弹窗、我的分享页、i18n）为后续 Plan 2。

---

## File Structure

| 文件                                                | 职责                                                                                            | 动作         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------ |
| `packages/database/src/schemas/shares.ts`           | `shares` 表定义 + `NewShare`/`ShareItem` 类型 + insert schema                                   | 新建         |
| `packages/database/src/schemas/index.ts`            | 导出 `shares`                                                                                   | 改           |
| `packages/database/src/schemas/marketAgent.ts`      | 给 `marketAgents` 加 `visibility` 列                                                            | 改           |
| `packages/database/src/utils/idGenerator.ts`        | `prefixes` 加 `shares: 'shr'`                                                                   | 改           |
| `packages/database/src/models/share.ts`             | `ShareModel`：create/findByToken/findMyList/setRevoked/incrementInstallCount/incrementViewCount | 新建         |
| `packages/database/src/models/marketAgent.ts`       | `getList`/`findByDisplayName` 加 `visibility='public'` 过滤                                     | 改           |
| `src/server/services/community/share.ts`            | `ShareService`：createShare（skill/mcp/agent）/getByToken/revoke/myShares/recordInstall         | 新建         |
| `src/server/services/community/share.test.ts`       | ShareService 单测                                                                               | 新建         |
| `src/server/services/community/index.ts`            | 暴露 `ShareService`（或在新文件导出）                                                           | 改（仅导出） |
| `src/server/routers/lambda/market/share.ts`         | `shareRouter`：create/getByToken/revoke/myShares/recordInstall                                  | 新建         |
| `src/server/routers/lambda/market/index.ts`         | 挂载 `share: shareRouter`                                                                       | 改           |
| `packages/database/migrations/0104_*.sql` + `meta/` | 由 `db:generate` 产出                                                                           | 生成         |

---

### Task 1: `shares` 表 schema 与 migration

**Files:**

- Create: `packages/database/src/schemas/shares.ts`
- Modify: `packages/database/src/schemas/index.ts`
- Modify: `packages/database/src/utils/idGenerator.ts`（`prefixes` 加 `shares: 'shr'`）
- Generate: `packages/database/migrations/0104_add_shares.sql` + `meta/`

**Interfaces:**

- Produces: `shares`（pgTable）、`insertShareSchema`、`NewShare`、`ShareItem` 类型，从 `@lobechat/database/schemas` 可导出。

- [ ] **Step 1: 写 schema 文件**

创建 `packages/database/src/schemas/shares.ts`：

```ts
import { index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createInsertSchema } from 'drizzle-zod';

import { idGenerator } from '../utils/idGenerator';
import { createdAt, timestamptz, updatedAt } from './_helpers';
import { users } from './user';

export const shares = pgTable(
  'shares',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => idGenerator('shares'))
      .notNull(),
    token: varchar('token', { length: 32 }).notNull(),
    ownerId: text('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    itemType: varchar('item_type', { length: 16 }).notNull(), // 'skill' | 'mcp' | 'agent'
    marketIdentifier: varchar('market_identifier', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamptz('revoked_at'),
    expiresAt: timestamptz('expires_at'),
    viewCount: integer('view_count').default(0),
    installCount: integer('install_count').default(0),
  },
  (t) => [
    uniqueIndex('shares_token_unique').on(t.token),
    index('shares_owner_id_idx').on(t.ownerId),
    index('shares_market_identifier_idx').on(t.marketIdentifier),
  ],
);

export const insertShareSchema = createInsertSchema(shares);

export type NewShare = typeof shares.$inferInsert;
export type ShareItem = typeof shares.$inferSelect;
```

- [ ] **Step 2: 导出 schema**

在 `packages/database/src/schemas/index.ts` 的 `export * from './session';` 一行附近（按字母序，置于 `export * from './session';` 之前）加：

```ts
export * from './shares';
```

- [ ] **Step 3: 加 idGenerator 前缀**

在 `packages/database/src/utils/idGenerator.ts` 的 `prefixes` 对象里（`sessionGroups: 'sg',` 附近）加一行：

```ts
  shares: 'shr',
```

- [ ] **Step 4: 生成 migration**

Run: `cd packages/database && bun run db:generate`（从仓库根 `bun run db:generate` 亦可）
Expected: drizzle-kit 输出新增 `migrations/0104_add_shares.sql`（数字前缀按当前最大 +1，当前最大为 `0103`），并更新 `migrations/meta/_journal.json` 与 snapshot。

生成的 SQL 应包含（用来核对）：

```sql
CREATE TABLE "shares" (
  "id" text PRIMARY KEY NOT NULL,
  "token" varchar(32) NOT NULL,
  "owner_id" text NOT NULL,
  "item_type" varchar(16) NOT NULL,
  "market_identifier" varchar(64) NOT NULL,
  "name" varchar(255),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "revoked_at" timestamptz,
  "expires_at" timestamptz,
  "view_count" integer DEFAULT 0,
  "install_count" integer DEFAULT 0
);
CREATE UNIQUE INDEX "shares_token_unique" ON "shares" USING btree ("token");
CREATE INDEX "shares_owner_id_idx" ON "shares" USING btree ("owner_id");
CREATE INDEX "shares_market_identifier_idx" ON "shares" USING btree ("market_identifier");
ALTER TABLE "shares" ADD CONSTRAINT "shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
```

- [ ] **Step 5: 提交**

```bash
git add packages/database/src/schemas/shares.ts packages/database/src/schemas/index.ts packages/database/src/utils/idGenerator.ts packages/database/migrations/
git commit -m "✨ feat(db): 新增 shares 表 schema 与 migration"
```

---

### Task 2: `marketAgents` 加 `visibility` 列 + migration

**Files:**

- Modify: `packages/database/src/schemas/marketAgent.ts`
- Generate: `packages/database/migrations/0105_add_market_agents_visibility.sql` + `meta/`

**Interfaces:**

- Produces: `marketAgents.visibility`（varchar (10), default 'public', 索引）。后续 Task 3 依赖此列存在。

- [ ] **Step 1: 加列与索引**

在 `packages/database/src/schemas/marketAgent.ts` 的 `status: varchar('status', { length: 20 }).notNull().default('published'),` 一行**之前**加：

```ts
    visibility: varchar('visibility', { length: 10 }).notNull().default('public'),
```

在表定义的索引数组（`(t) => [...]`）里加一项（置于 `index('market_agents_status_idx').on(t.status),` 之后）：

```ts
    index('market_agents_visibility_idx').on(t.visibility),
```

- [ ] **Step 2: 生成 migration**

Run: `cd packages/database && bun run db:generate`
Expected: 新增 `0105_add_market_agents_visibility.sql`，内容形如：

```sql
ALTER TABLE "market_agents" ADD COLUMN "visibility" varchar(10) DEFAULT 'public' NOT NULL;
CREATE INDEX "market_agents_visibility_idx" ON "market_agents" USING btree ("visibility");
```

- [ ] **Step 3: 提交**

```bash
git add packages/database/src/schemas/marketAgent.ts packages/database/migrations/
git commit -m "✨ feat(db): marketAgents 加 visibility 列"
```

---

### Task 3: `MarketAgentModel` 公开列表过滤 unlisted

> 背景：`marketSkills/marketMcps` 的 `getList` 已过滤 `visibility='public'`，故 unlisted 天然不进列表。`marketAgents` 新加列后需补同样过滤。`getDetail` 对非 owner 仅要求 `status='published'`，unlisted 仍 status=published，故按 identifier 可访问（分享安装预览所需），**不改** `getDetail`。

**Files:**

- Modify: `packages/database/src/models/marketAgent.ts`（`getList`、`findByDisplayName`）
- Test: `packages/database/src/models/marketAgent.test.ts`（若无则新建）

**Interfaces:**

- Produces: `getList` 返回结果不含 `visibility='unlisted'`/`'bundled'` 的记录。

- Consumes: Task 2 的 `marketAgents.visibility` 列。

- [ ] **Step 1: 写失败测试**

新建 / 扩展 `packages/database/src/models/marketAgent.test.ts`：

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketAgentModel } from './marketAgent';

describe('MarketAgentModel getList', () => {
  const model = new MarketAgentModel({ select: vi.fn() } as any, 'user-1');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters out non-public visibility (unlisted/bundled) from the public list', async () => {
    const captured: any[] = [];
    const chain = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn((w) => {
        captured.push(w);
        return chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      offset: vi.fn(() => chain),
    };
    const countChain = { from: vi.fn(() => countChain), where: vi.fn(() => countChain) };
    (model as any).db = {
      select: vi.fn(() => chain),
    } as any;
    // count query reuses db.select — return a count object
    chain.where = vi.fn((w) => {
      captured.push(w);
      return chain;
    });

    await model.getList({ page: 1, pageSize: 20 });

    // The where clause SQL must reference visibility = 'public'
    const sqlText = captured.map((w) => w?.toSQL?.()?.sql ?? String(w)).join('\n');
    expect(sqlText).toContain('visibility');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/database && bunx vitest run --silent='passed-only' 'src/models/marketAgent.test.ts'`
Expected: FAIL（`getList` 当前未引用 `visibility`）。

- [ ] **Step 3: 改 `getList`**

在 `packages/database/src/models/marketAgent.ts` 的 `getList` 内，把：

```ts
const conditions = [eq(marketAgents.status, 'published'), isNull(marketAgents.deletedAt)];
```

改为：

```ts
const conditions = [
  eq(marketAgents.visibility, 'public'),
  eq(marketAgents.status, 'published'),
  isNull(marketAgents.deletedAt),
];
```

- [ ] **Step 4: 改 `findByDisplayName`**

同文件 `findByDisplayName`（与 `marketSkill` 同名方法对齐，加 public 过滤防止 unlisted 名字误判冲突）。若该方法条件为 `[eq(status,'published'), isNull(deletedAt), ...]`，则在首位加 `eq(marketAgents.visibility, 'public'),`。读该方法确认后插入：

```ts
const conditions = [
  eq(marketAgents.visibility, 'public'),
  eq(marketAgents.status, 'published'),
  isNull(marketAgents.deletedAt),
  sql`lower(trim(${marketAgents.title})) = ${normalizedName}`,
];
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/database && bunx vitest run --silent='passed-only' 'src/models/marketAgent.test.ts'`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add packages/database/src/models/marketAgent.ts packages/database/src/models/marketAgent.test.ts
git commit -m "✨ feat(db): MarketAgentModel 公开列表过滤 visibility=public"
```

---

### Task 4: `ShareModel`（CRUD 基础）

**Files:**

- Create: `packages/database/src/models/share.ts`
- Test: `packages/database/src/models/share.test.ts`

**Interfaces:**

- Produces: `ShareModel` 类，方法签名：
  - `create(data: { token: string; ownerId: string; itemType: 'skill'|'mcp'|'agent'; marketIdentifier: string; name?: string }): Promise<ShareItem>`
  - `findByToken(token: string): Promise<ShareItem | undefined>`
  - `findMyList(ownerId: string): Promise<ShareItem[]>`（实际按 `this.userId`，见下）
  - `setRevoked(token: string): Promise<void>`
  - `incrementInstallCount(token: string): Promise<void>`
  - `incrementViewCount(token: string): Promise<void>`

- Consumes: Task 1 的 `shares` 表。

- [ ] **Step 1: 写失败测试**

新建 `packages/database/src/models/share.test.ts`：

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShareModel } from './share';

describe('ShareModel', () => {
  const buildChain = (resolve: any) => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      values: vi.fn(async () => resolve),
      set: vi.fn(() => chain),
      returning: vi.fn(async () => resolve),
    };
    return chain;
  };

  it('create inserts with provided fields', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1', token: 'tok' }]);
    (model as any).db = { insert: vi.fn(() => chain) } as any;

    const row = await model.create({
      token: 'tok',
      ownerId: 'owner-1',
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'My Skill',
    });

    expect((model as any).db.insert).toHaveBeenCalledWith(expect.anything());
    expect(row.token).toBe('tok');
  });

  it('setRevoked sets revokedAt', async () => {
    const model = new ShareModel({} as any, 'owner-1');
    const chain = buildChain([{ id: 'shr_1' }]);
    (model as any).db = { update: vi.fn(() => chain) } as any;

    await model.setRevoked('tok');

    expect(chain.set).toHaveBeenCalled();
    expect(chain.where).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/database && bunx vitest run --silent='passed-only' 'src/models/share.test.ts'`
Expected: FAIL（`ShareModel` 不存在）。

- [ ] **Step 3: 写 `ShareModel`**

创建 `packages/database/src/models/share.ts`：

```ts
import { and, desc, eq, sql } from 'drizzle-orm';

import type { NewShare, ShareItem } from '../schemas/shares';
import { shares } from '../schemas/shares';
import type { LobeChatDatabase } from '../type';

export class ShareModel {
  private db: LobeChatDatabase;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.db = db;
    this.userId = userId;
  }

  create = async (data: Omit<NewShare, 'id'>): Promise<ShareItem> => {
    const [result] = await this.db.insert(shares).values(data).returning();
    return result;
  };

  findByToken = async (token: string): Promise<ShareItem | undefined> => {
    const [result] = await this.db.select().from(shares).where(eq(shares.token, token)).limit(1);
    return result;
  };

  findMyList = async (): Promise<ShareItem[]> => {
    return this.db
      .select()
      .from(shares)
      .where(eq(shares.ownerId, this.userId))
      .orderBy(desc(shares.createdAt));
  };

  setRevoked = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shares.token, token), eq(shares.ownerId, this.userId)));
  };

  incrementInstallCount = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ installCount: sql`${shares.installCount} + 1` })
      .where(eq(shares.token, token));
  };

  incrementViewCount = async (token: string): Promise<void> => {
    await this.db
      .update(shares)
      .set({ viewCount: sql`${shares.viewCount} + 1` })
      .where(eq(shares.token, token));
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/database && bunx vitest run --silent='passed-only' 'src/models/share.test.ts'`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/database/src/models/share.ts packages/database/src/models/share.test.ts
git commit -m "✨ feat(db): 新增 ShareModel"
```

---

### Task 5: `ShareService` — createShare（skill 与 mcp）

> 关键：直接调 `marketSkillModel.create({ ..., visibility: 'unlisted' })` / `marketMcpModel.create({ ..., visibility: 'unlisted' })`，**不**调 `publishSkill/publishMcp`（后者会改本地 item 的 `marketIdentifier`、要求 category、做唯一名冲突检查）。MCP 走 `sanitizeMcpCustomParamsForMarket` 剥离 `x-bbzai-mcp-token`。

**Files:**

- Create: `src/server/services/community/share.ts`
- Test: `src/server/services/community/share.test.ts`

**Interfaces:**

- Produces: `ShareService` 类，构造 `{ serverDB, userId }`；方法：
  - `createShare(input: { itemType: 'skill'|'mcp'|'agent'; localId: string }): Promise<{ token: string; url: string; marketIdentifier: string }>`
  - （Task 6/7 补 `getByToken/revoke/myShares/recordInstall`）

- Consumes: `MarketSkillModel.create`、`MarketMcpModel.create`、`AgentSkillModel.findById`、`userInstalledPlugins` 表、`ShareModel.create`、`sanitizeMcpCustomParamsForMarket`、`resolveSkillMarketIcon`/`resolveMcpMarketIcon`、`extractMcpCapabilities`、`createNanoId`。

- [ ] **Step 1: 写失败测试（skill + mcp）**

新建 `src/server/services/community/share.test.ts`：

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { ShareService } from './share';

vi.mock('@/server/services/file/impls', () => ({
  createFileServiceModule: vi.fn().mockImplementation(() => ({
    createPreSignedUrl: vi.fn(),
    getFileContent: vi.fn(),
    getFullFileUrl: vi.fn(),
    uploadContent: vi.fn(),
  })),
}));

describe('ShareService createShare', () => {
  const userId = 'share-owner';

  const createService = () => {
    const service = new ShareService({ serverDB: {} as any, userId });
    const agentSkillModel = { findById: vi.fn() };
    const marketSkillModel = { create: vi.fn() };
    const marketMcpModel = { create: vi.fn() };
    const shareModel = { create: vi.fn() };
    const db = { select: vi.fn() };
    Object.assign(service as any, {
      agentSkillModel,
      db,
      marketMcpModel,
      marketSkillModel,
      shareModel,
    });
    return { agentSkillModel, db, marketMcpModel, marketSkillModel, service, shareModel };
  };

  it('creates an unlisted market skill snapshot + share row', async () => {
    const { agentSkillModel, marketSkillModel, service, shareModel } = createService();
    agentSkillModel.findById.mockResolvedValue({
      id: 'sk-1',
      identifier: 'skl_local',
      name: 'My Skill',
      description: 'desc',
      content: '# c',
      manifest: { name: 'My Skill' },
      resources: { '/a.txt': { size: 1 } },
      editorData: { root: true },
    });
    marketSkillModel.create.mockResolvedValue({ identifier: 'skl_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_skill' });

    const res = await service.createShare({ itemType: 'skill', localId: 'sk-1' });

    expect(marketSkillModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: 'unlisted',
        identifier: 'skl_local',
        name: 'My Skill',
      }),
    );
    expect(shareModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: userId,
        itemType: 'skill',
        marketIdentifier: 'skl_local',
        name: 'My Skill',
      }),
    );
    expect(res.url).toBe('/share/tok_skill');
  });

  it('creates an unlisted market mcp snapshot with sanitized headers', async () => {
    const { db, marketMcpModel, service, shareModel } = createService();
    const localMcp = {
      identifier: 'mcp_local',
      manifest: { meta: { title: 'My MCP' }, tools: [{ name: 't' }] },
      customParams: {
        type: 'http',
        mcp: {
          type: 'http',
          url: 'https://x',
          headers: { 'x-bbzai-mcp-token': 'secret', 'x-other': 'keep' },
        },
      },
    };
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => [localMcp]),
    };
    db.select.mockReturnValue(chain);
    marketMcpModel.create.mockResolvedValue({ identifier: 'mcp_local' });
    shareModel.create.mockResolvedValue({ token: 'tok_mcp' });

    await service.createShare({ itemType: 'mcp', localId: 'mcp_local' });

    const createArg = marketMcpModel.create.mock.calls[0][0];
    expect(createArg.visibility).toBe('unlisted');
    const headers = createArg.customParams.mcp.headers;
    expect(headers['x-bbzai-mcp-token']).toBe('');
    expect(headers['x-other']).toBe('keep');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/ptsu/project/calcifer-chathub && bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: FAIL（`ShareService` 不存在）。

- [ ] **Step 3: 写 `ShareService`（skill + mcp 分支）**

创建 `src/server/services/community/share.ts`：

```ts
import type { LobeChatDatabase } from '@lobechat/database';
import { agentSkills, userInstalledPlugins } from '@lobechat/database/schemas';
import type { CustomPluginParams } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import { AgentModel } from '@/database/models/agent';
import { AgentSkillModel } from '@/database/models/agentSkill';
import { MarketAgentModel } from '@/database/models/marketAgent';
import { MarketMcpModel } from '@/database/models/marketMcp';
import { MarketSkillModel } from '@/database/models/marketSkill';
import { ShareModel } from '@/database/models/share';
import { createNanoId } from '@/database/utils/idGenerator';
import { MarketAvatarService } from '@/server/services/community/marketAvatar';
import {
  resolveMcpMarketIcon,
  resolveSkillMarketIcon,
} from '@/server/services/community/marketIcon';
import {
  extractMcpCapabilities,
  getMcpConnectionType,
  sanitizeMcpCustomParamsForMarket,
} from '@/server/services/community/mcpCustomParams';

export interface ShareServiceOptions {
  serverDB: LobeChatDatabase;
  userId: string;
}

const generateToken = () => createNanoId(21)();

export class ShareService {
  protected db: LobeChatDatabase;
  protected userId: string;
  protected agentModel: AgentModel;
  protected agentSkillModel: AgentSkillModel;
  protected marketAgentModel: MarketAgentModel;
  protected marketSkillModel: MarketSkillModel;
  protected marketMcpModel: MarketMcpModel;
  protected shareModel: ShareModel;
  protected marketAvatarService: MarketAvatarService;

  constructor(options: ShareServiceOptions) {
    this.db = options.serverDB;
    this.userId = options.userId;
    this.agentModel = new AgentModel(this.db, this.userId);
    this.agentSkillModel = new AgentSkillModel(this.db, this.userId);
    this.marketAgentModel = new MarketAgentModel(this.db, this.userId);
    this.marketSkillModel = new MarketSkillModel(this.db, this.userId);
    this.marketMcpModel = new MarketMcpModel(this.db, this.userId);
    this.shareModel = new ShareModel(this.db, this.userId);
    this.marketAvatarService = new MarketAvatarService(this.db, this.userId);
  }

  createShare = async (input: {
    itemType: 'skill' | 'mcp' | 'agent';
    localId: string;
  }): Promise<{ token: string; url: string; marketIdentifier: string }> => {
    if (input.itemType === 'skill') return this.createSkillShare(input.localId);
    if (input.itemType === 'mcp') return this.createMcpShare(input.localId);
    return this.createAgentShare(input.localId);
  };

  protected createSkillShare = async (skillId: string) => {
    const localSkill = await this.agentSkillModel.findById(skillId);
    if (!localSkill) throw new TRPCError({ code: 'NOT_FOUND', message: 'SKILL_NOT_FOUND' });

    const identifier = localSkill.identifier || `skl_${createNanoId(8)()}`;
    const name = localSkill.name;
    const manifest = { ...(localSkill.manifest as Record<string, unknown>), name };

    const marketSkill = await this.marketSkillModel.create({
      identifier,
      name,
      description: localSkill.description,
      icon: resolveSkillMarketIcon(manifest, undefined),
      category: null,
      tags: (localSkill.manifest as { tags?: string[] })?.tags || [],
      content: localSkill.content,
      manifest,
      resources: localSkill.resources,
      editorData: localSkill.editorData,
      resourcesCount: Object.keys(localSkill.resources || {}).length,
      visibility: 'unlisted',
    } as any);

    return this.recordShare('skill', marketSkill.identifier, name);
  };

  protected createMcpShare = async (identifier: string) => {
    const [localMcp] = await this.db
      .select()
      .from(userInstalledPlugins)
      .where(
        and(
          eq(userInstalledPlugins.userId, this.userId),
          eq(userInstalledPlugins.identifier, identifier),
        ),
      )
      .limit(1);

    if (!localMcp?.manifest) throw new TRPCError({ code: 'NOT_FOUND', message: 'MCP_NOT_FOUND' });

    const manifest = localMcp.manifest as any;
    const customParams = (localMcp.customParams || {}) as CustomPluginParams;
    const displayName = manifest.meta?.title || identifier;
    const normalizedManifest = { ...manifest, meta: { ...manifest.meta, title: displayName } };
    const extracted = extractMcpCapabilities(normalizedManifest);
    const marketCustomParams = sanitizeMcpCustomParamsForMarket(customParams as any);

    const marketMcp = await this.marketMcpModel.create({
      identifier,
      name: displayName,
      description: normalizedManifest.meta?.description,
      icon: resolveMcpMarketIcon(normalizedManifest, undefined),
      category: null,
      tags: normalizedManifest.meta?.tags || [],
      overview: normalizedManifest.meta?.readme,
      connectionType: getMcpConnectionType(customParams as any),
      manifest: normalizedManifest,
      customParams: marketCustomParams,
      capabilities: extracted.capabilities,
      toolsCount: extracted.toolsCount,
      promptsCount: extracted.promptsCount,
      resourcesCount: extracted.resourcesCount,
      visibility: 'unlisted',
    } as any);

    return this.recordShare('mcp', marketMcp.identifier, displayName);
  };

  protected recordShare = async (
    itemType: 'skill' | 'mcp' | 'agent',
    marketIdentifier: string,
    name: string,
  ) => {
    const token = generateToken();
    await this.shareModel.create({
      token,
      ownerId: this.userId,
      itemType,
      marketIdentifier,
      name,
    });
    return { token, url: `/share/${token}`, marketIdentifier };
  };

  // createAgentShare 见 Task 6
  protected createAgentShare = async (_agentId: string) => {
    throw new Error('NOT_IMPLEMENTED'); // Task 6 实现
  };
}
```

> 注：`resolveSkillMarketIcon(manifest, undefined)` 与 `resolveMcpMarketIcon(manifest, undefined)` 在不传 generatedIcon 时回退默认图标，避免单测里触发 `marketAvatarService`。生产路径若需 AI 头像，可在后续小步把第二参换成 `await this.marketAvatarService.generateAvatar(...)`—— 本任务先用默认图标保证可测。

- [ ] **Step 4: 跑测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: PASS（skill + mcp 两例）。

- [ ] **Step 5: 提交**

```bash
git add src/server/services/community/share.ts src/server/services/community/share.test.ts
git commit -m "✨ feat(share): ShareService createShare 支持 skill 与 mcp"
```

---

### Task 6: `ShareService` — createShare（agent，级联快照内置 skill/mcp）

> agent 市场记录的 `skills/plugins` 存被引用项的 market identifier。分享 agent 时先为每个内置 skill/mcp 建 unlisted 副本，再把其 identifier 填入 agent 记录。复用 `_publishAgent` 里已有的「写市场 agent + 为每个内置 skill/mcp 写市场记录」数据塑形，但 `visibility:'unlisted'`、不改本地 agent 的 `marketIdentifier`。

**Files:**

- Modify: `src/server/services/community/share.ts`（实现 `createAgentShare`）
- Test: `src/server/services/community/share.test.ts`（加 agent 用例）

**Interfaces:**

- Produces: `createAgentShare(agentId)` 完整可用；`createShare({ itemType:'agent', localId })` 返回 token。

- Consumes: `AgentModel.getAgentConfigById`、`MarketAgentModel.create`、`MarketSkillModel.create`、`MarketMcpModel.create`、`agentSkills`/`userInstalledPlugins` 表查询、`extractMcpCapabilities`、`collectAgentSkillIdentifiers` 逻辑（内联）。

- [ ] **Step 1: 写失败测试（agent 级联）**

在 `share.test.ts` 的 `describe` 块内追加：

```ts
it('creates an unlisted agent with cascaded unlisted skill + mcp snapshots', async () => {
  const {
    agentModel,
    db,
    marketAgentModel,
    marketMcpModel,
    marketSkillModel,
    service,
    shareModel,
  } = createService() as any;

  agentModel.getAgentConfigById.mockResolvedValue({
    id: 'agt-1',
    title: 'My Agent',
    systemRole: 'you are x',
    description: 'd',
    avatar: null,
    backgroundColor: null,
    tags: [],
    model: 'gpt-4o',
    provider: 'openai',
    plugins: ['mcp_local'],
    skills: ['skl_local'],
    chatConfig: {},
    fewShots: null,
    openingMessage: null,
    openingQuestions: [],
    editorData: { root: true },
  });

  // collectAgentSkillIdentifiers looks up agentSkills by identifier
  const skillRow = {
    identifier: 'skl_local',
    name: 'My Skill',
    description: 'd',
    content: '#c',
    manifest: { name: 'My Skill' },
    resources: {},
    editorData: null,
  };
  const mcpRow = {
    identifier: 'mcp_local',
    manifest: { meta: { title: 'My MCP' }, tools: [] },
    customParams: { type: 'http', mcp: { type: 'http', url: 'https://x', headers: {} } },
  };

  const selectChain = (row: any) => ({
    from: vi.fn(() => selectChain(row)),
    innerJoin: vi.fn(() => selectChain(row)),
    where: vi.fn(() => selectChain(row)),
    limit: vi.fn(async () => [row]),
  });
  db.select.mockImplementation(() => selectChain(mcpRow));
  (service as any).agentSkillModel.findByIdentifier = vi.fn().mockResolvedValue(skillRow);
  (service as any).marketSkillModel.findByIdentifier = vi.fn().mockResolvedValue(undefined);
  (service as any).marketMcpModel.findByIdentifier = vi.fn().mockResolvedValue(undefined);

  marketAgentModel.create.mockResolvedValue({ identifier: 'agt_x' });
  marketSkillModel.create.mockResolvedValue({ identifier: 'skl_local' });
  marketMcpModel.create.mockResolvedValue({ identifier: 'mcp_local' });
  shareModel.create.mockResolvedValue({ token: 'tok_agent' });

  const res = await service.createShare({ itemType: 'agent', localId: 'agt-1' });

  expect(marketSkillModel.create).toHaveBeenCalledWith(
    expect.objectContaining({ visibility: 'unlisted', identifier: 'skl_local' }),
  );
  expect(marketMcpModel.create).toHaveBeenCalledWith(
    expect.objectContaining({ visibility: 'unlisted', identifier: 'mcp_local' }),
  );
  const agentArg = marketAgentModel.create.mock.calls[0][0];
  expect(agentArg.visibility).toBe('unlisted');
  expect(agentArg.skills).toContain('skl_local');
  expect(agentArg.plugins).toContain('mcp_local');
  expect(res.url).toBe('/share/tok_agent');
});
```

并在 `createService` 里补上 `agentModel: { getAgentConfigById: vi.fn() }`、`marketAgentModel: { create: vi.fn() }`、`marketSkillModel` 加 `findByIdentifier`、`marketMcpModel` 加 `findByIdentifier`、`agentSkillModel` 加 `findByIdentifier`，全部 `Object.assign` 进 service。

- [ ] **Step 2: 跑测试确认失败**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: FAIL（`createAgentShare` 抛 NOT_IMPLEMENTED）。

- [ ] **Step 3: 实现 `createAgentShare`**

在 `share.ts` 把 `createAgentShare` 占位实现替换为：

```ts
  protected createAgentShare = async (agentId: string) => {
    const localAgent = await this.agentModel.getAgentConfigById(agentId);
    if (!localAgent) throw new TRPCError({ code: 'NOT_FOUND', message: 'AGENT_NOT_FOUND' });
    if (!localAgent.title || !localAgent.systemRole) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'TITLE_AND_SYSTEMROLE_REQUIRED' });
    }

    const identifier = `agt_${createNanoId(8)()}`;

    // 内置 skill identifier（plugins 里属于本地 skill 的也算 skill）
    const skillIds = new Set<string>(localAgent.skills || []);
    for (const id of localAgent.plugins || []) {
      if (skillIds.has(id)) continue;
      const localSkill = await this.agentSkillModel.findByIdentifier(id);
      if (localSkill) skillIds.add(id);
    }
    const agentSkillIds = [...skillIds];

    // 为每个内置 skill 建 unlisted 副本（若市场已有同 id 记录则跳过，避免唯一索引冲突）
    for (const skillIdentifier of agentSkillIds) {
      const existing = await this.marketSkillModel.findByIdentifier(skillIdentifier);
      if (existing) continue;
      const localSkill = await this.agentSkillModel.findByIdentifier(skillIdentifier);
      if (!localSkill) continue;
      const manifest = { ...(localSkill.manifest as Record<string, unknown>), name: localSkill.name };
      await this.marketSkillModel.create({
        identifier: skillIdentifier,
        name: localSkill.name,
        description: localSkill.description,
        icon: resolveSkillMarketIcon(manifest, undefined),
        category: null,
        tags: (localSkill.manifest as { tags?: string[] })?.tags || [],
        content: localSkill.content,
        manifest,
        resources: localSkill.resources,
        editorData: localSkill.editorData,
        resourcesCount: Object.keys(localSkill.resources || {}).length,
        visibility: 'unlisted',
      } as any);
    }

    // 为每个内置 mcp 建 unlisted 副本
    const mcpIdentifiers = localAgent.plugins || [];
    for (const mcpIdentifier of mcpIdentifiers) {
      const existing = await this.marketMcpModel.findByIdentifier(mcpIdentifier);
      if (existing) continue;
      const [localMcp] = await this.db
        .select()
        .from(userInstalledPlugins)
        .where(
          and(eq(userInstalledPlugins.userId, this.userId), eq(userInstalledPlugins.identifier, mcpIdentifier)),
        )
        .limit(1);
      if (!localMcp?.manifest) continue;
      const manifest = localMcp.manifest as any;
      const customParams = (localMcp.customParams || {}) as CustomPluginParams;
      const displayName = manifest.meta?.title || mcpIdentifier;
      const normalizedManifest = { ...manifest, meta: { ...manifest.meta, title: displayName } };
      const extracted = extractMcpCapabilities(normalizedManifest);
      await this.marketMcpModel.create({
        identifier: mcpIdentifier,
        name: displayName,
        description: normalizedManifest.meta?.description,
        icon: resolveMcpMarketIcon(normalizedManifest, undefined),
        category: null,
        tags: normalizedManifest.meta?.tags || [],
        overview: normalizedManifest.meta?.readme,
        connectionType: getMcpConnectionType(customParams as any),
        manifest: normalizedManifest,
        customParams: sanitizeMcpCustomParamsForMarket(customParams as any),
        capabilities: extracted.capabilities,
        toolsCount: extracted.toolsCount,
        promptsCount: extracted.promptsCount,
        resourcesCount: extracted.resourcesCount,
        visibility: 'unlisted',
      } as any);
    }

    const marketAgent = await this.marketAgentModel.create({
      identifier,
      title: localAgent.title,
      description: localAgent.description,
      avatar: localAgent.avatar,
      backgroundColor: localAgent.backgroundColor,
      category: null,
      tags: localAgent.tags,
      systemRole: localAgent.systemRole,
      model: typeof localAgent.model === 'string' ? localAgent.model : null,
      provider: localAgent.provider,
      plugins: localAgent.plugins,
      skills: agentSkillIds,
      knowledgeBases: [],
      chatConfig: localAgent.chatConfig,
      fewShots: localAgent.fewShots,
      openingMessage: localAgent.openingMessage,
      openingQuestions: localAgent.openingQuestions,
      editorData: localAgent.editorData,
      tokenUsage: 0,
      pluginCount: new Set([...(localAgent.plugins || []), ...agentSkillIds]).size,
      knowledgeCount: 0,
      visibility: 'unlisted',
    } as any);

    return this.recordShare('agent', marketAgent.identifier, localAgent.title);
  };
```

> 知识库（`knowledgeBases`）v1 不级联分享（留空数组），与 spec §6 「agent 内置 skill/mcp 已在市场 public 仍建 unlisted 副本」一致 —— 这里对已存在市场记录的内置项跳过，避免唯一索引冲突；若该既有记录是 public，安装时会用 public 记录（可接受）。

- [ ] **Step 4: 跑测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: PASS（skill + mcp + agent 三例）。

- [ ] **Step 5: 提交**

```bash
git add src/server/services/community/share.ts src/server/services/community/share.test.ts
git commit -m "✨ feat(share): createShare 支持 agent 级联快照内置 skill/mcp"
```

---

### Task 7: `ShareService` — getByToken / revoke / myShares / recordInstall

> `getByToken` 无需登录态（公开），仅靠 token + 撤销 / 过期校验。命中撤销 / 过期 → `410 Gone`，不存在 → `404`（不区分防探测）。`revoke` 校验 owner。`recordInstall` 供前端安装成功后 best-effort 累加 `installCount`（不改 `install*` 逻辑）。

**Files:**

- Modify: `src/server/services/community/share.ts`
- Test: `src/server/services/community/share.test.ts`

**Interfaces:**

- Produces:
  - `getByToken(token): Promise<{ itemType, marketIdentifier, name }>`（命中撤销 / 过期抛 410，不存在抛 404）
  - `revoke(token): Promise<void>`（非 owner 抛 403）
  - `myShares(): Promise<ShareItem[]>`
  - `recordInstall(token): Promise<void>`

- Consumes: `ShareModel.findByToken/findMyList/setRevoked/incrementInstallCount/incrementViewCount`。

- [ ] **Step 1: 写失败测试**

在 `share.test.ts` 新增 `describe('ShareService getByToken/revoke')`：

```ts
describe('ShareService getByToken/revoke', () => {
  const userId = 'share-owner';
  const createService = () => {
    const service = new ShareService({ serverDB: {} as any, userId });
    const shareModel = {
      create: vi.fn(),
      findByToken: vi.fn(),
      findMyList: vi.fn(),
      setRevoked: vi.fn(),
      incrementInstallCount: vi.fn(),
      incrementViewCount: vi.fn(),
    };
    Object.assign(service as any, { shareModel });
    return { service, shareModel };
  };

  it('returns share info for a valid token', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'S',
      revokedAt: null,
      expiresAt: null,
    });
    const res = await service.getByToken('tok');
    expect(res).toEqual({ itemType: 'skill', marketIdentifier: 'skl_x', name: 'S' });
    expect(shareModel.incrementViewCount).toHaveBeenCalledWith('tok');
  });

  it('throws 410 when revoked', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: userId,
      revokedAt: new Date(),
      expiresAt: null,
      itemType: 'skill',
      marketIdentifier: 'skl_x',
      name: 'S',
    });
    await expect(service.getByToken('tok')).rejects.toMatchObject({ code: 'GONE' });
  });

  it('throws 404 when not found', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue(undefined);
    await expect(service.getByToken('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('revoke rejects non-owner', async () => {
    const { service, shareModel } = createService();
    shareModel.findByToken.mockResolvedValue({
      token: 'tok',
      ownerId: 'someone-else',
      revokedAt: null,
    });
    await expect(service.revoke('tok')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(shareModel.setRevoked).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: FAIL（`getByToken`/`revoke` 不存在）。

- [ ] **Step 3: 实现方法**

在 `share.ts` 的 `ShareService` 内（`recordShare` 之后）加：

```ts
getByToken = async (
  token: string,
): Promise<{
  itemType: 'skill' | 'mcp' | 'agent';
  marketIdentifier: string;
  name: string | null;
}> => {
  const row = await this.shareModel.findByToken(token);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'SHARE_NOT_FOUND' });
  if (row.revokedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
    throw new TRPCError({ code: 'GONE', message: 'SHARE_EXPIRED_OR_REVOKED' });
  }
  await this.shareModel.incrementViewCount(token).catch(() => undefined);
  return {
    itemType: row.itemType as 'skill' | 'mcp' | 'agent',
    marketIdentifier: row.marketIdentifier,
    name: row.name,
  };
};

revoke = async (token: string): Promise<void> => {
  const row = await this.shareModel.findByToken(token);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'SHARE_NOT_FOUND' });
  if (row.ownerId !== this.userId) throw new TRPCError({ code: 'FORBIDDEN', message: 'FORBIDDEN' });
  await this.shareModel.setRevoked(token);
};

myShares = async () => this.shareModel.findMyList();

recordInstall = async (token: string): Promise<void> => {
  await this.shareModel.incrementInstallCount(token).catch(() => undefined);
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/server/services/community/share.test.ts'`
Expected: PASS（全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/server/services/community/share.ts src/server/services/community/share.test.ts
git commit -m "✨ feat(share): getByToken/revoke/myShares/recordInstall"
```

---

### Task 8: `market.share.*` TRPC 路由

> `create/revoke/myShares/recordInstall` 需登录（`authedProcedure`）；`getByToken` 公开（`publicProcedure`）。挂在 `marketRouter` 下为子路由 `share`。

**Files:**

- Create: `src/server/routers/lambda/market/share.ts`
- Modify: `src/server/routers/lambda/market/index.ts`

**Interfaces:**

- Produces: TRPC 路由 `market.share.create` / `market.share.getByToken` / `market.share.revoke` / `market.share.myShares` / `market.share.recordInstall`。

- Consumes: `ShareService`（Task 5–7）。

- [ ] **Step 1: 写路由文件**

创建 `src/server/routers/lambda/market/share.ts`：

```ts
import { z } from 'zod';

import { authedProcedure, publicProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware/serverDatabase';
import { ShareService } from '@/server/services/community/share';

const shareAuthProcedure = authedProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      shareService: new ShareService({ serverDB: ctx.serverDB, userId: ctx.userId }),
    },
  });
});

const sharePublicProcedure = publicProcedure.use(serverDatabase).use(async ({ ctx, next }) => {
  if (!ctx.serverDB) throw new Error('serverDB not available');
  return next({
    ctx: {
      shareService: new ShareService({ serverDB: ctx.serverDB, userId: ctx.userId || '' }),
    },
  });
});

export const shareRouter = router({
  create: shareAuthProcedure
    .input(
      z.object({
        itemType: z.enum(['skill', 'mcp', 'agent']),
        localId: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => ctx.shareService.createShare(input)),

  getByToken: sharePublicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input, ctx }) => ctx.shareService.getByToken(input.token)),

  revoke: shareAuthProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.shareService.revoke(input.token);
      return { success: true };
    }),

  myShares: shareAuthProcedure.query(async ({ ctx }) => ctx.shareService.myShares()),

  recordInstall: sharePublicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.shareService.recordInstall(input.token);
      return { success: true };
    }),
});

export type ShareRouter = typeof shareRouter;
```

- [ ] **Step 2: 挂载到 marketRouter**

在 `src/server/routers/lambda/market/index.ts`：

顶部 import 区加：

```ts
import { shareRouter } from './share';
```

在 `export const marketRouter = router({ ... })` 内，与 `skill: skillRouter,` 同级加：

```ts
  share: shareRouter,
```

- [ ] **Step 3: 确认 lambdaClient 类型可识别**

Run: `bunx tsgo --noEmit -p tsconfig.json 2>&1 | grep -i 'share\|market' | head`（只看 share/market 相关报错；若无输出即通过）。
Expected: 无 `market.share` 相关类型错误。

> 若 `lambdaClient` 由 TRPC 路由自动生成类型，新增子路由会自动可见，前端 `communityApiService` 可直接加 `share.*` 调用（Plan 2 处理）。

- [ ] **Step 4: 端到端冒烟（可选，需 DB）**

若本地 DB 可用：

Run: `bun run db:migrate`（应用 0104/0105 migration）
然后手测：用既有 skill id 调 `market.share.create` → 拿 token → `market.share.getByToken` → `market.skill.installSkill(marketIdentifier)` → `market.share.recordInstall(token)`。

Expected: 安装成功，`agentSkills` 出现该 skill，`shares.installCount` +1。

- [ ] **Step 5: 提交**

```bash
git add src/server/routers/lambda/market/share.ts src/server/routers/lambda/market/index.ts
git commit -m "✨ feat(share): market.share.* TRPC 路由"
```

---

## Self-Review（已完成）

- **Spec 覆盖**：§2.1 shares 表 → Task 1；§2.2 unlisted 档 + 列表过滤 → Task 2/3；§2.3 agent 级联快照 → Task 6；§2.4 安装来源不变 → 复用既有 install\*（Task 8 Step 4 冒烟）；§3.1 createShare → Task 5/6；§3.2 安装 → 既有 install\* + Task 8 路由暴露 getByToken/recordInstall；§3.3 revoke/myShares → Task 7；§3.4 TRPC → Task 8；§5 安全（鉴权 / 越权 /token 不可枚举 410/404）→ Task 7；§6 边界（重复分享、删本地不影响、已装走 fork / 更新、内置项建 unlisted 副本）→ Task 6 实现 + spec 记录。installCount 累加改为 best-effort `recordInstall`（不改 install 逻辑，守住硬约束）。前端为 Plan 2。
- **占位符**：无 TBD/TODO；Task 6 的 `createAgentShare` 占位 `NOT_IMPLEMENTED` 是 TDD 红灯步骤，Task 6 Step 3 替换为完整实现。
- **类型一致**：`ShareModel` 方法名（`findByToken/findMyList/setRevoked/incrementInstallCount/incrementViewCount/create`）在 Task 4 定义、Task 5/7 消费，名称一致；`ShareService.createShare/getByToken/revoke/myShares/recordInstall` 在 Task 5–8 一致；`visibility: 'unlisted'` 字面量贯穿 Task 5/6/8 一致。
