# 点对点分享（Peer Share）设计

日期：2026-06-24
分支：feat/desktop-first
关联分析：`.local/2026-06-24-market/market-vs-lobehub-community-analysis.md`

## 1. 背景与目标

当前仅能通过市场（community/market）安装别人发布的助理、skill、mcp：发布需 publisher 唯一名、category、`visibility=public`、进入公开列表 / 搜索，且需市场授权。本功能让用户能**直接把自己的 skill /mcp/ 助理分享给他人安装，不经过市场**。

### 硬约束

- **安装逻辑必须与市场一致**：分享助理时，其内置 skill/mcp 须一并安装（级联安装）；MCP 凭据处理与市场一致（headers 里 `x-bbzai-mcp-token` 等密钥字段保留 key、值置空）。

### 已选方案：方案 C（薄 `shares` 表 + 市场表 `unlisted` 档）

- 分享物以 `unlisted` 可见性写入既有市场表（复用 `_publish*` 内部快照逻辑，绕过 public 门槛），`shares` 表只做令牌 / 归属 / 撤销 / 过期 / 统计。
- 安装 = `token → marketIdentifier → 既有 installAgent/installSkill/installMcp`，安装逻辑零改动，级联安装与密钥剥离白送。
- 撤销 / 多 token / 过期 / 统计在独立表演进，不污染市场 schema。

### 复用基础（已核实）

- `CommunityService`（`src/server/services/community/index.ts`）服务端闭环：`_publishSkill/_publishMcp/_publishAgent` 已支持 fork、bundled→public、用户自建首发布等路径。
- `marketAgents/marketSkills/marketMcps` 表：agent 记录存 `skills/plugins/knowledgeBases` identifier 数组，`installAgent` 服务端级联安装依赖。
- 密钥剥离：`packages/utils/src/mcpHeaders.ts` 的 `maskSensitiveHeaders` + `src/server/services/community/mcpCustomParams.ts` 的 `sanitizeMcpCustomParamsForMarket`（`MARKET_MASKED_HEADER_KEYS = ['x-bbzai-mcp-token']`）。
- 安装来源追踪：`installedFromMarketIdentifier / installedMarketVersion / installedFromSnapshot`。
- 前端安装确认弹窗：`src/features/ProtocolUrlHandler/InstallPlugin`（`PluginInstallConfirmModal` / `CustomPluginInstallModal`）。
- 数据导出：`packages/database/src/repositories/dataExporter`（参考其表枚举，本设计不直接用）。

## 2. 数据模型

### 2.1 新增 `shares` 表

文件：`packages/database/src/schemas/shares.ts`

```ts
import { index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
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
    token: varchar('token', { length: 32 }).notNull(), // nanoid(21)
    ownerId: text('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    itemType: varchar('item_type', { length: 16 }).notNull(), // 'skill' | 'mcp' | 'agent'
    marketIdentifier: varchar('market_identifier', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    revokedAt: timestamptz('revoked_at'), // 非空 = 已撤销
    expiresAt: timestamptz('expires_at'), // 默认 null = 永久
    viewCount: integer('view_count').default(0),
    installCount: integer('install_count').default(0),
  },
  (t) => [
    uniqueIndex('shares_token_unique').on(t.token),
    index('shares_owner_id_idx').on(t.ownerId),
    index('shares_market_identifier_idx').on(t.marketIdentifier),
  ],
);
```

约定：

- `token` 唯一、nanoid (21) 不可猜；`marketIdentifier` 指向 unlisted 市场记录。
- 一条 item 可有多条 share（分别撤销 / 统计），故不唯一化 `marketIdentifier`。
- 撤销 = 写 `revokedAt`，不删行（保留审计）。
- `expiresAt` 默认 null = 永久有效；v1 不在 UI 暴露设置，仅留字段。

### 2.2 市场表可见性扩展

`marketAgents / marketSkills / marketMcps` 现有 `visibility`（`public` / `bundled`）增加 `unlisted` 档。无需改列定义（string），仅查询过滤：

- 所有公开列表 / 搜索 /category/ 排行榜查询追加 `visibility = 'public'` 过滤。
- `getMyXxxList`（作者视角）放行 `public + unlisted`。
- `installXxx(identifier)` 不变 ——unlisted 记录对它是普通市场记录。

### 2.3 agent 分享的级联快照

agent 市场记录的 `skills/plugins` 存的是**被引用 skill/mcp 的 market identifier**。分享 agent 时递归：

1. 为本体内置每个 skill/mcp 各建一条 unlisted 市场记录（skill 走 `_publishSkill` 内部写表、mcp 走 `_publishMcp` 内部写表 + `sanitizeMcpCustomParamsForMarket`）。
2. 把这批新 identifier 填入 agent 记录的 `skills/plugins`。
3. 写 unlisted agent 市场记录。

这复用 `publishAgent(bundledSkillIdentifiers, bundledMcpIdentifiers)` 的既有契约，区别仅是 bundled identifier 来自刚创建的 unlisted 记录、`visibility=unlisted`。skill/mcp 单独分享无此级联。

### 2.4 与安装来源的关系

安装侧不改：仍写 `installedFromMarketIdentifier = <unlisted identifier>`、`installedFromSnapshot`、`installedMarketVersion`。安装者后续可用现有 `updateInstalledXxx` 拉取分享者推送的更新（未来启用时），路径已留好。

## 3. 流程与 API

### 3.1 创建分享 `share.create`

```
前端: 点「分享」→ share.create({ itemType, localId })
服务端 ShareService.createShare({ itemType, localId }, userId):
  1. 取本地 item（agentSkill / userInstalledPlugin / agent），校验 userId 名下
  2. 按 itemType 快照写 unlisted 市场记录:
     - skill: 复用 _publishSkill 内部写表方法，visibility=unlisted，跳过 publisher 唯一名/category/market-auth
     - mcp:   复用 _publishMcp 内部写表方法 + sanitizeMcpCustomParamsForMarket
     - agent: 递归——先为内置 skill/mcp 各建 unlisted 记录，拿 identifier 填入 agent.skills/plugins
  3. 生成 token(nanoid21)，写 shares 行
  4. 返回 { token, url }   // url = `/share/:token`
前端: 弹结果弹窗（复用 PublishResultModal 样式）+ 复制按钮
```

`createShare` 是新独立路径，**不**调 `publishXxx`（后者带 public 列表 / 唯一名 / 市场授权门槛）。它复用 `_publish*` 的**内部快照写入函数**—— 需把 `_publishSkill/_publishMcp/_publishAgent` 里「写市场表」片段抽成可复用方法，接收 `visibility` 参数。

### 3.2 安装 `/share/:token`

```
前端路由 /share/:token:
  1. share.getByToken(token) → 校验 revokedAt/expiresAt，返回 { itemType, marketIdentifier, name, preview }
     - preview = 市场记录快照（manifest/systemRole/内置 skill-mcp 列表等）
  2. 展示预览弹窗（复用 ProtocolUrlHandler 安装确认弹窗风格）
     - MCP: 显示 manifest + 被剥离的 headers（空值提示「需自行配置」）
     - agent: 显示内置 skill/mcp 列表
  3. 用户确认 → communityApiService.installSkill/installMcp/installAgent(marketIdentifier)
     - 安装逻辑与市场完全一致；agent 级联安装内置 skill/mcp
  4. 完成 → 跳转/刷新；服务端 install 钩子 share.installCount += 1
```

不新写安装代码，直接调既有 `install*` TRPC。安装物带 `installedFromMarketIdentifier = <unlisted identifier>`，与市场安装同构。

### 3.3 撤销与我的分享

- `share.revoke({ token })`：仅 `ownerId === 当前用户` 可撤销，写 `revokedAt`。
- `share.myShares`：返回当前用户所有分享（含 revoked、viewCount/installCount），供管理页。
- `share.delete`（v1.5 可选）：连带给 unlisted 市场记录打 `deletedAt`（类比 delist），彻底失效。

### 3.4 TRPC 路由

挂在现有 `market.*` 旁：`market.share.create` / `market.share.getByToken` / `market.share.revoke` / `market.share.myShares`。

### 3.5 前端落点

- **分享入口**：skill 管理页、MCP 管理页（`EditMcpPlugin` 旁）、agent profile 头部（`AgentPublishButton` 旁）各加「分享」按钮。
- **安装入口**：新路由 `/share/:token`（`src/routes/share/` 已存在目录，page segment 委托 `src/features/Share/`）。
- **我的分享管理页**：settings 下新增一页，列表 + 撤销 + 复制链接 + 统计。
- i18n：`src/locales/default/` 新增 share 命名空间或补 setting/discover 现有 key。

## 4. 链接失效规则

| 触发条件                   | 链接是否失效 | 说明                                                    |
| -------------------------- | ------------ | ------------------------------------------------------- |
| 分享者主动撤销             | 失效         | 写 `revokedAt`，`getByToken` 拒绝                       |
| 设了过期且到期             | 失效         | `expiresAt` 命中（v1 默认不设）                         |
| 对应 unlisted 市场记录被删 | 失效         | 取不到内容；正常流程不触发，撤销走 `revokedAt` 不删记录 |
| 分享者删除本地 item        | 不失效       | 快照独立于本地 item                                     |
| 分享者后续编辑本地 item    | 不失效       | 快照语义，永远是分享那一刻版本                          |
| token 本身                 | 永久不变     | 同一 token 一直有效，除非上述情况                       |

默认永久有效，只能由分享者主动撤销（或未来设过期）。

## 5. 安全

- **鉴权**：`share.create/revoke/myShares` 需登录态（复用 session 中间件）；`share.getByToken` **无需登录**，仅靠 token 不可猜 + 撤销 / 过期校验；`installXxx` 沿用既有鉴权（市场安装要求登录）。
- **越权**：`revoke` 校验 `ownerId`；`createShare` 只能快照 `userId` 名下本地 item（community service 全程带 userId 过滤）。
- **密钥**：MCP 走 `sanitizeMcpCustomParamsForMarket`；agent 级联快照内置 mcp 时同样剥离。
- **token 不可枚举**：nanoid (21) \~96bit 熵，唯一索引；`getByToken` 命中撤销 / 过期 → 410 Gone，不存在 → 404，不区分以防探测。
- **内容审计**：unlisted 与 public 同表，未来违规举报 / 管理员下架链路可对 unlisted 打 `deletedAt`，链接随之失效。

## 6. 边界场景

| 场景                                 | 处理                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 同一 item 重复分享                   | 允许，多个 token / 多条 share（分别撤销 / 统计）；v1 每次新建 unlisted 记录，后续可优化为复用同条记录多挂 token |
| 分享者删除本地 item                  | 快照独立，链接不受影响                                                                                          |
| 安装者已装过同 identifier            | 走现有 `install*` fork / 更新分支（`installedFromMarketIdentifier` 命中→更新；本地已改→copy）                   |
| agent 内置 skill/mcp 已在市场 public | 级联快照仍建 unlisted 副本，不污染原 public 记录                                                                |
| token 失效 / 离线                    | 预览页显示「链接已失效或被撤销」                                                                                |
| 撤销后已安装本地 item                | 不受影响，撤销只断未来安装                                                                                      |
| 体积                                 | skill resources/agent editorData 较大时，unlisted 记录与 public 同等体积上限，不额外限制                        |

## 7. 可扩展性留口（v1 不实现）

- `expiresAt` 已建 → 未来过期链接。
- `shares.ownerId + itemType` → 未来「分享给指定用户 / 工作区」加 `recipientFilter`。
- `viewCount/installCount` → 分享者数据面板。
- agent 级联快照 → 演进为「安装向导」（一次性配置依赖凭据，见分析文档第 9 节）。
- 安装物 `installedFromMarketIdentifier` → 未来「分享者推送新版本」，安装者用 `updateInstalledXxx` 拉取。

## 8. 测试

- **单测**（vitest，`community/index.test.ts` 风格）：
  - `createShare` 三类各一：断言写 unlisted 市场记录 + shares 行；MCP 断言 headers 已剥离。
  - agent 级联：断言内置 skill/mcp 各建 unlisted 记录且 identifier 填入 agent。
  - `getByToken`：正常 / 撤销 / 过期 / 不存在 四例。
  - `revoke` 越权：非 owner 失败。
  - `sanitizeMcpCustomParamsForMarket` 已有测试，不重复。
- **集成**：`share.create → getByToken → installXxx` 端到端，断言 `installedFromMarketIdentifier` 正确、agent 级联安装成功。
- **回归**：列表 / 搜索查询加 `visibility='public'` 后，unlisted 不出现在 `getAssistantList/getSkillList/getMcpList`（加断言）。

## 9. 改动面盘点

- **DB**：1 张新表 `shares` + 3 张市场表 `visibility` 加 `unlisted` 值（仅查询过滤，不改列）+ migration。
- **服务端**：新 `ShareService`（`src/server/services/community/share.ts`）+ `market.share.*` TRPC 路由 + 把 `_publish*` 写表片段抽为可传 `visibility` 的复用方法 + 公开列表查询加 `visibility='public'` 过滤 + install 钩子累加 `installCount`。
- **前端**：3 处分享按钮 + `/share/:token` 路由 + 安装确认弹窗复用 + 「我的分享」管理页 + i18n。

## 10. 决策记录

- 交付方式：服务端分享链接（token → 记录 → 复用 `install*`）。
- 分享语义：快照（本地后续编辑不影响已发链接）。
- 范围：skill /mcp/agent 三类多态，v1 一起。
- MCP 凭据：复用 `sanitizeMcpCustomParamsForMarket`，`x-bbzai-mcp-token` 等 key 保留、值空，与市场一致。
- 过期策略：默认永久，仅分享者主动撤销可失效。
- 实现方案：方案 C（薄 `shares` 表 + 市场表 `unlisted` 档）。
