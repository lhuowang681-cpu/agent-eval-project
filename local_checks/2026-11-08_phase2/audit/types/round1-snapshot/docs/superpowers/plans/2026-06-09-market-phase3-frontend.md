# 社区市场 — Phase 3: 前端层实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简市场前端 —— 删除社交 / 外部链接模块，新增发布 / 安装 / 更新按钮和流程 UI，重写 client service 对齐新后端 API。

**Architecture:** 前端保持现有页面结构（列表 + 详情），删除不需要的 Tab / 模块 / 组件，修改按钮文案（Fork→安装），新增发布弹窗和安装状态判断逻辑。Client service 重写为调用新 tRPC 路由。

**Tech Stack:** React 19 + Zustand + SWR + antd + @lobehub/ui + react-i18next

**前置依赖:** Phase 1 + Phase 2 必须完成，后端 API 可用。

---

## 文件变更清单

| 操作 | 文件                                          | 责备                                |
| ---- | --------------------------------------------- | ----------------------------------- |
| 重写 | `src/services/marketApi.ts`                   | 重写为调用新 tRPC 路由              |
| 修改 | `src/services/discover.ts`                    | 精简：移除官方 API 调用             |
| 修改 | `src/store/discover/` 各 slice                | 对齐新 service 签名                 |
| 修改 | `src/routes/(main)/community/(detail)/agent/` | 删除社交模块，修改按钮文案          |
| 修改 | `src/routes/(main)/community/(detail)/skill/` | 删除社交模块，修改按钮文案          |
| 修改 | `src/routes/(main)/community/(detail)/mcp/`   | 删除社交模块，修改按钮文案          |
| 修改 | `src/routes/(main)/community/(list)/agent/`   | 修改卡片文案（Fork→安装数）         |
| 修改 | `src/routes/(main)/community/(list)/skill/`   | 删除 Featured 徽章                  |
| 修改 | `src/routes/(main)/community/(list)/mcp/`     | 删除 Official/Claimed/Featured 徽章 |
| 修改 | `src/locales/default/discover.ts`             | 新增发布 / 安装 / 更新文案          |
| 删除 | 相关社交组件文件（收藏 / 评分 / 评论）        |                                     |
| 新增 | `src/features/MarketPublish/`                 | 发布弹窗组件                        |

---

### Task 1: 重写 marketApi.ts client service

**Files:**

- Rewrite: `src/services/marketApi.ts`

- [ ] **Step 1: 重写为调用新 tRPC 路由**

移除所有官方 Market SDK 调用，改为 tRPC client 调用：

```ts
import { lambdaClient } from '@/libs/trpc/client';

class CommunityApiService {
  // ===== 助理 =====
  publishAgent = (agentId: string, bundledSkillIdentifiers?: string[]) =>
    lambdaClient.market.agent.publishAgent.mutate({ agentId, bundledSkillIdentifiers });

  updateAgent = (identifier: string) =>
    lambdaClient.market.agent.updateAgent.mutate({ identifier });

  delistAgent = (identifier: string) =>
    lambdaClient.market.agent.delistAgent.mutate({ identifier });

  installAgent = (identifier: string) =>
    lambdaClient.market.agent.installAgent.mutate({ identifier });

  updateInstalledAgent = (identifier: string) =>
    lambdaClient.market.agent.updateInstalledAgent.mutate({ identifier });

  // ===== Skill =====
  publishSkill = (skillId: string) => lambdaClient.market.skill.publishSkill.mutate({ skillId });

  updateSkill = (identifier: string) =>
    lambdaClient.market.skill.updateSkill.mutate({ identifier });

  delistSkill = (identifier: string) =>
    lambdaClient.market.skill.delistSkill.mutate({ identifier });

  installSkill = (identifier: string) =>
    lambdaClient.market.skill.installSkill.mutate({ identifier });

  updateInstalledSkill = (identifier: string) =>
    lambdaClient.market.skill.updateInstalledSkill.mutate({ identifier });

  // ===== MCP =====
  publishMcp = (identifier: string, manifest: any, customParams: any) =>
    lambdaClient.market.mcp.publishMcp.mutate({ identifier, manifest, customParams });

  updateMcp = (identifier: string, manifest: any, customParams: any) =>
    lambdaClient.market.mcp.updateMcp.mutate({ identifier, manifest, customParams });

  delistMcp = (identifier: string) => lambdaClient.market.mcp.delistMcp.mutate({ identifier });

  installMcp = (identifier: string) => lambdaClient.market.mcp.installMcp.mutate({ identifier });

  updateInstalledMcp = (identifier: string) =>
    lambdaClient.market.mcp.updateInstalledMcp.mutate({ identifier });
}

export const communityApiService = new CommunityApiService();
```

- [ ] **Step 2: 搜索所有引用旧 MarketApiService 的地方**

```bash
grep -r "marketApiService\|MarketApiService" src/ --include="*.ts" --include="*.tsx" -l
```

将所有引用改为 `communityApiService`。

- [ ] **Step 3: Commit**

```bash
git add src/services/marketApi.ts
git commit -m "♻️ rewrite marketApi service — call new tRPC routes"
```

---

### Task 2: 重写 discover.ts client service

**Files:**

- Rewrite: `src/services/discover.ts`

- [ ] **Step 1: 重写列表 / 详情查询为调用新 tRPC 路由**

```ts
import { lambdaClient } from '@/libs/trpc/client';

class DiscoverService {
  // 助理
  getAssistantList = (params: {
    keyword?: string;
    category?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
  }) => lambdaClient.market.getAssistantList.query(params);

  getAssistantDetail = (identifier: string) =>
    lambdaClient.market.getAssistantDetail.query({ identifier });

  // Skill
  getSkillList = (params: {
    keyword?: string;
    category?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
  }) => lambdaClient.market.getSkillList.query(params);

  getSkillDetail = (identifier: string) => lambdaClient.market.getSkillDetail.query({ identifier });

  // MCP
  getMcpList = (params: {
    keyword?: string;
    category?: string;
    connectionType?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
  }) => lambdaClient.market.getMcpList.query(params);

  getMcpDetail = (identifier: string) => lambdaClient.market.getMcpDetail.query({ identifier });
}

export const discoverService = new DiscoverService();
```

移除所有 `report*`, `getPlugin*`, `getModel*`, `getProvider*`, `getUserInfo`, `safeInjectMPToken` 方法 —— 这些依赖官方 API。

- [ ] **Step 2: 搜索引用旧 discoverService 的地方**

```bash
grep -r "discoverService" src/ --include="*.ts" --include="*.tsx" -l
```

修复所有引用。特别是 `src/store/discover/` 各 slice。

- [ ] **Step 3: Commit**

```bash
git add src/services/discover.ts
git commit -m "♻️ rewrite discover service — call new tRPC routes"
```

---

### Task 3: 更新 discover store slices

**Files:**

- Modify: `src/store/discover/slices/assistant/` 等

- [ ] **Step 1: 修改 assistant slice**

对齐新的 `discoverService.getAssistantList` 和 `discoverService.getAssistantDetail` 签名。移除 `reportAgentInstall` 等不需要的 action。新增 `publishAgent`, `installAgent`, `updateInstalledAgent` action（调用 `communityApiService`）。

关键新增 action：

```ts
// 在 assistant slice 中新增：
publishAgent: async (agentId: string, bundledSkillIdentifiers?: string[]) => {
  const result = await communityApiService.publishAgent(agentId, bundledSkillIdentifiers);
  // 成功后刷新列表
  await useAssistantStore.getState().useFetchAssistantList();
  return result;
},

installAgent: async (identifier: string) => {
  const result = await communityApiService.installAgent(identifier);
  // 成功后刷新本地助理列表（新的助理已安装到本地）
  await useAgentStore.getState().fetchAgents();
  return result;
},

updateInstalledAgent: async (identifier: string) => {
  const result = await communityApiService.updateInstalledAgent(identifier);
  await useAgentStore.getState().fetchAgents();
  return result;
},
```

- [ ] **Step 2: 同样修改 skill 和 mcp slice**

新增 `publishSkill`, `installSkill`, `updateInstalledSkill` 等 action。模式与 assistant slice 一致。

- [ ] **Step 3: 移除 social slice**

删除 `src/store/discover/slices/social/` 目录。所有引用 social action 的组件需在后续 Task 中一并移除。

- [ ] **Step 4: Commit**

```bash
git add src/store/discover/
git commit -m "♻️ update discover store — add publish/install/update actions"
```

---

### Task 4: 助理详情页 — 删除社交模块 + 修改按钮

**Files:**

- Modify: `src/routes/(main)/community/(detail)/agent/` 下各组件文件

- Modify: `src/features/MCPPluginDetail/` (如有共用)

- [ ] **Step 1: 移除 Related (相似助理) Tab**

在助理详情页的 Tab 配置中移除 `AssistantNavKey.Related`。修改 `Nav.tsx` 或 tab 配置文件：

找到 Tab 定义的地方（可能是 `Details/Nav.tsx` 或直接在详情页组件），移除 "相关助理" tab 项。

- [ ] **Step 2: 移除 Fork 标记 → 改为安装数量标记**

在 `Header.tsx` 中，找到 fork count 显示逻辑。将 fork 数量改为 install count：

```diff
- <ForkCountBadge count={data.forkCount} />
+ <InstallCountBadge count={data.installCount} />
```

如果有 `ForkCountBadge` 组件，改为 `InstallCountBadge` 或复用现有的 `InstallCountBadge`（可能已存在）。

- [ ] **Step 3: "派生并聊天" → "安装并聊天"**

在 `Sidebar/ActionButton/ForkAndChat.tsx` 中，修改按钮文案。将 `ForkAndChat` 组件改为 `InstallAndChat`：

```diff
- buttonText: t('assistants.forkAndChat')
+ buttonText: t('assistants.installAndChat')
```

- [ ] **Step 4: "添加到我的助理" → "安装助理"**

在 `Sidebar/ActionButton/AddAgent.tsx` 中修改文案：

```diff
- buttonText: t('assistants.addAgent')
+ buttonText: t('assistants.installAgent')
```

- [ ] **Step 5: 移除收藏按钮**

在 `Header.tsx` 或 Sidebar 中移除收藏（Favorite）按钮。删除所有 `<FavoriteButton>` 或 `<LikeButton>` 组件引用。

- [ ] **Step 6: 移除侧边栏 "相关助理"**

在 Sidebar 组件中移除 related agents 部分。

- [ ] **Step 7: Commit**

```bash
git add src/routes/ src/features/
git commit -m "♻️ agent detail — remove social modules, change Fork→Install"
```

---

### Task 5: Skill 详情页 — 删除社交模块

**Files:**

- Modify: `src/routes/(main)/community/(detail)/skill/` 下各组件

- [ ] **Step 1: 移除收藏、评论、评分模块**

在 Skill 详情页移除 favorites/comments/rating 相关组件。

- [ ] **Step 2: 移除 GitHub 相关信息**

移除 GitHub stars, repo 链接，issues 链接等组件。

- [ ] **Step 3: 移除 Installation Tab（VS Code 安装按钮等）**

移除 Installation tab 或将其改为简单的 "安装到本地" 指引。

- [ ] **Step 4: 移除 Related (相关技能) Tab**

- [ ] **Step 5: 移除 Featured 徽章**

在 Skill 列表页和详情页的 Header 中移除 Featured badge。

- [ ] **Step 6: 移除 License (许证) 展示**

- [ ] **Step 7: Commit**

```bash
git add src/routes/ src/features/
git commit -m "♻️ skill detail — remove social/github/installation modules"
```

---

### Task 6: MCP 详情页 — 删除社交模块

**Files:**

- Modify: `src/routes/(main)/community/(detail)/mcp/` 下各组件

- Modify: `src/features/MCPPluginDetail/` 共用组件

- [ ] **Step 1: 移除 Score Tab**

移除 `McpNavKey.Score` 和对应的 Score 组件。

- [ ] **Step 2: 移除 Official/Claimed/Featured 徽章**

在 MCP Header 中移除这些徽章。

- [ ] **Step 3: 移除收藏、评分**

- [ ] **Step 4: 移除 GitHub 相关信息**

- [ ] **Step 5: 移除 Related (相关 MCP) Tab**

- [ ] **Step 6: 移除 License 展示**

- [ ] **Step 7: 移除 Market Auth 认证入口**

移除 `MCPActionButton` 中的 Market Auth 相关逻辑（如 OAuth flow）。

- [ ] **Step 8: 移除 "是否验证" 标识**

- [ ] **Step 9: Commit**

```bash
git add src/routes/ src/features/MCPPluginDetail/
git commit -m "♻️ MCP detail — remove social/score/auth modules"
```

---

### Task 7: 助理列表页 — 修改卡片文案

**Files:**

- Modify: `src/routes/(main)/community/(list)/agent/` 卡片组件

- [ ] **Step 1: Fork 数量 → 安装数量**

在 agent 列表卡片 `Item.tsx` 中：

```diff
- <Badge count={item.forkCount} /> // Fork 数
+ <Badge count={item.installCount} /> // 安装数
```

- [ ] **Step 2: "派生并聊天" → "安装并聊天"**

卡片上的快捷操作按钮文案修改。

- [ ] **Step 3: Commit**

```bash
git add src/routes/
git commit -m "♻️ agent list — change Fork→Install count badge"
```

---

### Task 8: i18n 文案更新

**Files:**

- Modify: `src/locales/default/discover.ts`

- [ ] **Step 1: 新增发布 / 安装 / 更新相关 i18n key**

```ts
// 在 discover.ts 的 assistants 部分新增：
'assistants.installAgent': '安装助理',
'assistants.installAndChat': '安装并聊天',
'assistants.publishToMarket': '发布到市场',
'assistants.updateToMarket': '更新到市场',
'assistants.installCount': '安装数',
'assistants.installSuccess': '助理安装成功',
'assistants.publishSuccess': '助理发布成功',
'assistants.updateSuccess': '助理更新成功',
'assistants.delistSuccess': '助理下线成功',
'assistants.updateWarning': '检测到本地修改，是否更新？',
'assistants.delistWarning': '该助理已下线',

// skill 部分新增：
'skills.installSkill': '安装 Skill',
'skills.publishToMarket': '发布到市场',
'skills.updateToMarket': '更新到市场',
'skills.installSuccess': 'Skill 安装成功',

// mcp 部分新增：
'mcp.installMcp': '安装 MCP',
'mcp.publishToMarket': '发布到市场',
'mcp.updateToMarket': '更新到市场',
'mcp.installSuccess': 'MCP 安装成功',
```

- [ ] **Step 2: 修改已有 key 的中文翻译**

将 "派生" 相关文案改为 "安装"：

- `assistants.forkAndChat` → `assistants.installAndChat`（已新增，旧 key 可保留或标记 deprecated）

- `assistants.addAgent` → `assistants.installAgent`（同上）

- [ ] **Step 3: 同步到 zh-CN 和 en-US**

```bash
# 在 src/locales/zh-CN/discover.ts 中添加对应中文翻译
# 在 src/locales/en-US/discover.ts 中添加对应英文翻译
```

- [ ] **Step 4: Commit**

```bash
git add src/locales/
git commit -m "✨ add i18n keys for market publish/install/update"
```

---

### Task 9: 发布弹窗组件

**Files:**

- Create: `src/features/MarketPublish/index.tsx`

- Create: `src/features/MarketPublish/AgentPublishModal.tsx`

- Create: `src/features/MarketPublish/SkillPublishModal.tsx`

- [ ] **Step 1: 创建 AgentPublishModal**

助理发布弹窗 —— 核心是跟随发布 Skill/MCP 选择：

```tsx
import { Button, Modal, Checkbox, Space, Typography } from 'antd';
import { useDiscoverStore } from '@/store/discover';
import { communityApiService } from '@/services/marketApi';

interface AgentPublishModalProps {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentTitle: string;
  skills: { identifier: string; name: string; source: string }[];
  mcps: { identifier: string; name: string; source: string }[];
}

const AgentPublishModal: React.FC<AgentPublishModalProps> = ({
  open,
  onClose,
  agentId,
  agentTitle,
  skills,
  mcps,
}) => {
  const [selectedIdentifiers, setSelectedIdentifiers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  // 分类 Skill/MCP
  const marketSkills = skills.filter((s) => s.source === 'market');
  const privateSkills = skills.filter((s) => s.source !== 'market' && s.source !== 'builtin');

  const handlePublish = async () => {
    setLoading(true);
    try {
      await communityApiService.publishAgent(agentId, selectedIdentifiers);
      message.success(t('assistants.publishSuccess'));
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`发布助理「${agentTitle}」到社区市场`}
      open={open}
      onCancel={onClose}
      onOk={handlePublish}
      confirmLoading={loading}
    >
      <Typography.Text type="secondary">
        发布后助理配置将拷贝到市场，本地修改不会自动同步。
      </Typography.Text>

      {/* 已在市场的 Skill — 灰色锁定 */}
      {marketSkills.length > 0 && (
        <div>
          <Typography.Text strong>已在市场的 Skill</Typography.Text>
          {marketSkills.map((s) => (
            <div key={s.identifier}>
              <Checkbox checked disabled>
                {s.name}
              </Checkbox>
            </div>
          ))}
        </div>
      )}

      {/* 私有 Skill — 可勾选 */}
      {privateSkills.length > 0 && (
        <div>
          <Typography.Text strong>你的私有 Skill</Typography.Text>
          {privateSkills.map((s) => (
            <div key={s.identifier}>
              <Checkbox
                checked={selectedIdentifiers.includes(s.identifier)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedIdentifiers([...selectedIdentifiers, s.identifier]);
                  } else {
                    setSelectedIdentifiers(selectedIdentifiers.filter((id) => id !== s.identifier));
                  }
                }}
              >
                {s.name}
              </Checkbox>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
```

- [ ] **Step 2: 创建 SkillPublishModal**

更简单的发布弹窗 —— 只有确认按钮：

```tsx
const SkillPublishModal: React.FC<{ open; onClose; skillId; skillName }> = ({
  open,
  onClose,
  skillId,
  skillName,
}) => {
  const [loading, setLoading] = useState(false);

  const handlePublish = async () => {
    setLoading(true);
    try {
      await communityApiService.publishSkill(skillId);
      message.success(t('skills.publishSuccess'));
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={`发布 Skill「${skillName}」到社区市场`}
      open={open}
      onCancel={onClose}
      onOk={handlePublish}
      confirmLoading={loading}
    >
      <Typography.Text type="secondary">
        发布后 Skill 配置将拷贝到市场，本地修改不会自动同步。
      </Typography.Text>
    </Modal>
  );
};
```

- [ ] **Step 3: 创建 index.tsx 导出**

```ts
export { AgentPublishModal } from './AgentPublishModal';
export { SkillPublishModal } from './SkillPublishModal';
```

- [ ] **Step 4: 在本地助理管理页面集成发布按钮**

在用户助理 profile 页（通常是 `src/routes/(main)/settings/agent/` 或类似位置）的操作菜单中添加 "发布到市场"/"更新到市场" 按钮。

需要找到当前助理编辑页面的菜单组件，添加菜单项：

```tsx
// 在助理设置页面的操作菜单中添加：
<Menu.Item
  key="publish"
  icon={<SendOutlined />}
  onClick={() => {
    // 如果已有 marketIdentifier → 调用 updateAgent
    // 否则 → 打开 AgentPublishModal
    if (agent.marketIdentifier) {
      communityApiService.updateAgent(agent.marketIdentifier);
    } else {
      setPublishModalOpen(true);
    }
  }}
>
  {agent.marketIdentifier ? t('assistants.updateToMarket') : t('assistants.publishToMarket')}
</Menu.Item>
```

- [ ] **Step 5: Commit**

```bash
git add src/features/MarketPublish/
git commit -m "✨ add AgentPublishModal and SkillPublishModal"
```

---

### Task 10: 安装按钮状态逻辑

**Files:**

- Modify: 助理详情页 Sidebar ActionButton

- Modify: Skill 详情页 Sidebar ActionButton

- Modify: MCP 详情页 Sidebar ActionButton

- [ ] **Step 1: 在助理详情页实现安装 / 更新按钮状态判断**

修改 `AddAgent.tsx` 或 `ForkAndChat.tsx`（已改为 `InstallAndChat.tsx`），添加按钮状态逻辑：

```tsx
const getButtonState = () => {
  // 1. 查本地是否有 installedFromMarketIdentifier = 市场 identifier 的记录
  const installedAgent = localAgents.find(
    (a) => a.installedFromMarketIdentifier === marketIdentifier,
  );

  if (!installedAgent) return { type: 'install', label: t('assistants.installAgent') };

  // 2. 对比当前配置 vs installedFromSnapshot
  const isModified =
    JSON.stringify(getAgentConfig(installedAgent)) !==
    JSON.stringify(installedAgent.installedFromSnapshot);

  if (!isModified) return { type: 'update', label: t('assistants.updateAgent') };

  // 3. 已修改 + marketIdentifier 有值 → 安装独立副本
  if (installedAgent.marketIdentifier) {
    return { type: 'install', label: t('assistants.installAgent'), isCopy: true };
  }

  // 4. 已修改 + marketIdentifier 无值 → 更新带警告
  return { type: 'update', label: t('assistants.updateAgent'), withWarning: true };
};

// 检查市场工具是否下线
if (marketData.deletedAt) {
  return {
    type: 'disabled',
    label: t('assistants.updateAgent'),
    reason: t('assistants.delistWarning'),
  };
}
```

注意：`localAgents` 需要从 agent store 中获取。`installedFromMarketIdentifier` 和 `installedFromSnapshot` 是 Phase 1 新增的字段，需要在 agent store 的类型定义中包含。

- [ ] **Step 2: 同样实现 Skill 和 MCP 的按钮状态逻辑**

逻辑对称但更简单（无附属子工具）。

- [ ] **Step 3: Commit**

```bash
git add src/routes/ src/features/
git commit -m "✨ add install/update button state logic with modification detection"
```

---

### Task 11: 移除不需要的类型定义

**Files:**

- Modify: `packages/types/src/discover/` 各类型文件

- [ ] **Step 1: 从类型定义中移除社交相关字段**

修改 `DiscoverAssistantDetail`, `DiscoverSkillDetail`, `DiscoverMcpDetail` 等类型，移除：

- `likeCount`, `favoriteCount`, `commentCount` 等社交计数
- `githubInfo`, `license`, `score` 等外部链接字段
- `forkCount` → 改为 `installCount`

新增字段：

- `installedFromMarketIdentifier`

- `installedFromSnapshot`

- `installedMarketVersion`

- [ ] **Step 2: 移除不需要的 NavKey**

- `AssistantNavKey.Related` → 移除

- `SkillNavKey.Related` → 移除

- `McpNavKey.Score` → 移除

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/discover/
git commit -m "♻️ update discover types — remove social, add install tracking"
```

---

### Task 12: 最终类型检查和清理

- [ ] **Step 1: 运行 type-check**

```bash
bun run type-check
```

修复所有类型错误。主要来源：

- 被移除的类型字段在前端组件中的引用

- 新增字段未在 store 类型中声明

- 被移除的 tRPC 路由在前端 client 中的引用

- [ ] **Step 2: 搜索残留的旧引用**

```bash
grep -r "forkCount\|forkAndChat\|addAgent\|social\|favorite\|like\|rating\|comment" src/ --include="*.ts" --include="*.tsx" -l
```

逐一检查并修复。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "fix: resolve type-check errors and remove stale references"
```

---

## 自审检查

**1. Spec 覆盖率：**

- 规格 §6.1 删除模块（收藏 / 评分 / 评论 / GitHub） → Task 4-6 ✅
- 规格 §6.1 术语调整（Fork→安装） → Task 4, 7 ✅
- 规格 §6.2 保留功能 → Task 1-3 (service/store 对齐) ✅
- 规格 §6.3 新增前端功能（发布 / 安装按钮） → Task 9, 10 ✅
- 规格 §6.3 跟随发布选择 → Task 9 AgentPublishModal ✅
- 规格 §6.3 MCP 发布表单 → Task 1 (publishMcp API), Task 9 (MCP 发布按钮需复用 MCPManifestForm)
- 规格 §6.3 下线状态 → Task 10 (按钮 disabled + 提示) ✅
- 规格 §6.4 按钮状态判断逻辑 → Task 10 ✅

**2. Placeholder 检查：** 无 TBD/TODO ✅

**3. 类型一致性检查：**

- `communityApiService.publishAgent(agentId, bundledSkillIdentifiers)` → 与 Phase 2 tRPC input `{ agentId: z.string(), bundledSkillIdentifiers: z.array(z.string()).optional().default([]) }` 对齐 ✅
- `discoverService.getAssistantList(params)` → 与 Phase 2 tRPC input 对齐 ✅
- `installedFromMarketIdentifier` 在前端类型定义和按钮逻辑中一致使用 ✅

**发现的 gap：**

- 规格 §6.3 "MCP 发布表单复用 MCPManifestForm" → Task 9 只提到了 MCP publishMcp API 调用，未详细说明前端 MCPManifestForm 集成。这是因为 MCPManifestForm 已有现成组件（在 MCP 设置页面），只需要在发布流程中调用它。实际实现时需要找到 MCPManifestForm 的位置并复用。
- 规格 §6.3 "来源标记 (source)" → 需要在 Skill/MCP 列表和详情页显示 source 标签。当前 Task 未专门覆盖此 UI。应在 Task 5-6 中补充。
