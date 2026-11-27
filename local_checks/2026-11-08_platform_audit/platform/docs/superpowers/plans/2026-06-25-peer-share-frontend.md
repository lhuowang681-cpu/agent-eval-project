# Peer Share Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户把自己的 skill /mcp/ 助理通过一条 `/share/:token` 链接直接分享给他人安装，前端覆盖 Desktop + Web，安装逻辑与市场完全一致（零改动复用既有 `installSkill/installMcp/installAgent`）。

**Architecture:** 后端（`market.share.*` TRPC + `ShareService` + `shares` 表 + unlisted 市场快照）已在本分支完成。前端只做四件事：(1) 在 `CommunityApiService` 加 5 个 share 方法；(2) 一个可复用的 `useShare` hook + `ShareResultModal`，被三处宿主（skill/mcp/agent 管理）的分享按钮消费；(3) `/share/:token` 统一预览页 ——`getByToken` 拿到 `{itemType, marketIdentifier}` 后按 itemType 调既有 `installSkill/installMcp/installAgent`，再 `recordShareInstall`，安装路径与市场 detail 页逐字相同；(4) 「我的分享」settings 子页（列表 + 撤销 + 复制 + 统计）。

**Tech Stack:** Next.js 16 + React 19 + TypeScript SPA（react-router-dom），@lobehub/ui + antd，react-i18next，zustand，SWR，TRPC（`lambdaClient`）。

## Global Constraints

- **安装逻辑零改动**：分享安装必须调用 `communityApiService.installSkill(identifier)` / `installMcp(identifier)` / `installAgent(identifier)`（`src/services/marketApi.ts` 既有方法，与市场 detail 页同一调用）。**不得**新增任何 install 实现、不得绕过这三个方法。助理内置 skill/mcp 由后端 `installAgent` 级联装好，前端无需处理。
- **错误码分支**：`getByToken` 不存在 → TRPC `NOT_FOUND`；已撤销 / 过期 → TRPC **`CONFLICT`**（后端用 CONFLICT 而非 410 GONE，因 TRPC 固定枚举无 GONE）。前端按这两个 code 分支提示。
- **平台范围**：Desktop + Web。两者都使用 `src/spa/router/desktopRouter.config.tsx`（`entry.web.tsx` 与 `entry.desktop.tsx` 都 import `desktopRoutes`）。**不**改 `mobileRouter.config.tsx`。桌面产物构建另需同步 `desktopRouter.config.desktop.tsx`。
- **路由**：`/share/:token` 注册为 `/share/t` 块的**兄弟路由**（不同路径深度，不与 `/share/t/:id` 冲突）。**不得**复用 `src/routes/share/t/[id]/`（那是分享对话记录的功能）。
- **skill 分享按钮位置**：放在 `src/routes/(main)/settings/skill/features/AgentSkillItem.tsx`（用户自建 skill 项）。**不要**放进 `BuiltinSkillItem.tsx`（内置全局 skill，本就人人可用，分享无意义）。
- **复制链接**：用 `navigator.clipboard.writeText`（既有范式见 `src/routes/(main)/group/profile/features/store/action.ts`）。分享链接用完整 URL：`${window.location.origin}${url}`（后端返回的 `url` 是相对路径 `/share/<token>`）。
- **i18n**：新加 `share` 命名空间到 `src/locales/default/share.ts`，并在 `locales/zh-CN/share.json`、`locales/en-US/share.json` 各加同名 key 供预览。**不要**跑 `pnpm i18n`（CI 处理）。
- **不要每改完一个文件就跑 `bun run type-check`**（全量慢）。用 Edit/Write 工具结果里的 `<new-diagnostics>` 或 LSP 单文件诊断。单文件测试用 `bunx vitest run --silent='passed-only' '<file>'`。**禁止** `bun run test`（约 10 分钟）。
- **commit 用 gitmoji**；分支沿用当前 `feat/desktop-first`。
- 现有 `CommunityApiService` 的 install/publish 方法**均无单元测试**（thin TRPC wrapper），本计划对等处理：service 层不加测试，测试落在有逻辑的 `useShare` hook 与 `ShareInstallPage` 上。

---

## File Structure

| 文件                                                                           | 责任                                              | 新建 / 修改 |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | ----------- |
| `src/services/marketApi.ts`                                                    | `CommunityApiService` 加 5 个 share 方法          | 修改        |
| `src/locales/default/share.ts`                                                 | share 命名空间默认文案                            | 新建        |
| `locales/zh-CN/share.json` / `locales/en-US/share.json`                        | dev 预览翻译                                      | 新建        |
| `src/features/PeerShare/useShare.ts`                                           | 分享动作 hook：调 createShare + 管理 result modal | 新建        |
| `src/features/PeerShare/useShare.test.ts`                                      | useShare 单测                                     | 新建        |
| `src/features/PeerShare/ShareResultModal.tsx`                                  | 分享成功弹窗：展示链接 + 复制                     | 新建        |
| `src/features/PeerShare/index.ts`                                              | barrel 导出                                       | 新建        |
| `src/routes/(main)/settings/skill/features/AgentSkillItem.tsx`                 | skill 项加分享动作                                | 修改        |
| `src/routes/(main)/settings/skill/features/EditMcpPlugin.tsx`                  | mcp 项加分享动作                                  | 修改        |
| `src/routes/(main)/agent/profile/features/Header/AgentPublishButton/index.tsx` | agent 头部加分享动作                              | 修改        |
| `src/routes/share/[token]/index.tsx`                                           | `/share/:token` 路由 thin 段                      | 新建        |
| `src/features/PeerShare/ShareInstallPage.tsx`                                  | 预览 + 安装 + recordInstall                       | 新建        |
| `src/features/PeerShare/ShareInstallPage.test.ts`                              | 安装页单测                                        | 新建        |
| `src/spa/router/desktopRouter.config.tsx`                                      | 注册 `/share/:token`                              | 修改        |
| `src/spa/router/desktopRouter.config.desktop.tsx`                              | 同步注册 `/share/:token`                          | 修改        |
| `src/store/global/initialState.ts`                                             | `SettingsTabs` 加 `Share` 枚举                    | 修改        |
| `src/routes/(main)/settings/features/SettingsContent.tsx`                      | `share` tab 分发                                  | 修改        |
| `src/routes/(main)/settings/_layout/SidebarContent.tsx`                        | 侧栏加「我的分享」入口                            | 修改        |
| `src/routes/(main)/settings/share/index.tsx`                                   | 我的分享页 thin 段                                | 新建        |
| `src/features/PeerShare/MySharesList.tsx`                                      | 列表 + 撤销 + 复制 + 统计                         | 新建        |

---

## Task 1: `CommunityApiService` share 方法

**Files:**

- Modify: `src/services/marketApi.ts`（在 `recordMcpUsage` 之后、class 闭合 `}` 之前插入）

**Interfaces:**

- Produces: `communityApiService.createShare(itemType, localId)` / `getShareByToken(token)` / `revokeShare(token)` / `getMyShares()` / `recordShareInstall(token)`。返回类型与后端 `ShareService` 对齐：`createShare → { token: string; url: string; marketIdentifier: string }`；`getShareByToken → { itemType: 'skill'|'mcp'|'agent'; marketIdentifier: string; name: string|null }`；`getMyShares → ShareItem[]`（后端 `shareModel.findMyList()` 返回行）。

- Consumes: 后端 `market.share.*` TRPC 路由（已实现，Task 8 of backend plan）。

- [ ] **Step 1: 加方法**

在 `src/services/marketApi.ts` 的 `CommunityApiService` 内，`recordMcpUsage` 方法之后追加：

```ts
// ===== Peer Share (point-to-point, bypasses market listing) =====

createShare = (itemType: 'agent' | 'mcp' | 'skill', localId: string) =>
  lambdaClient.market.share.create.mutate({ itemType, localId });

getShareByToken = (token: string) => lambdaClient.market.share.getByToken.query({ token });

revokeShare = (token: string) => lambdaClient.market.share.revoke.mutate({ token });

getMyShares = () => lambdaClient.market.share.myShares.query();

recordShareInstall = (token: string) => lambdaClient.market.share.recordInstall.mutate({ token });
```

- [ ] **Step 2: 类型自检**

Run: 用 LSP 对 `src/services/marketApi.ts` 做诊断（或看 Edit 后 `<new-diagnostics>`）。
Expected: 无 `market.share` 相关类型错误（`lambdaClient` 类型由 TRPC 路由自动生成，后端已挂 `share: shareRouter`，新方法类型自动可见）。

- [ ] **Step 3: 提交**

```bash
git add src/services/marketApi.ts
git commit -m "✨ feat(share): CommunityApiService 加 market.share.* 客户端方法"
```

---

## Task 2: i18n share 命名空间

**Files:**

- Create: `src/locales/default/share.ts`
- Create: `locales/zh-CN/share.json`
- Create: `locales/en-US/share.json`

**Interfaces:**

- Produces: `share` 命名空间，供后续任务 `useTranslation('share')` 消费。key 清单见下方。

- [ ] **Step 1: 写默认文案**

创建 `src/locales/default/share.ts`：

```ts
export default {
  button: {
    share: 'Share',
    install: 'Install',
    revoke: 'Revoke',
    copy: 'Copy Link',
    done: 'Done',
    goToSettings: 'Go to Settings',
  },
  result: {
    title: 'Share Link Created',
    message:
      'Send this link to anyone you want to share with. They can install it directly — no market listing needed.',
    linkLabel: 'Share Link',
    copied: 'Copied',
  },
  install: {
    titleSkill: 'Install Skill',
    titleMcp: 'Install MCP',
    titleAgent: 'Install Assistant',
    descPrefix: 'You are about to install',
    installSuccess: 'Installed successfully',
    notFound: 'This share link does not exist or has been deleted.',
    expired: 'This share link has expired or been revoked by its owner.',
    alreadyInstalled: 'You have already installed this item.',
  },
  myShares: {
    title: 'My Shares',
    empty: 'You have not shared anything yet.',
    colName: 'Name',
    colType: 'Type',
    colViews: 'Views',
    colInstalls: 'Installs',
    colCreated: 'Created',
    colStatus: 'Status',
    statusActive: 'Active',
    statusRevoked: 'Revoked',
    typeSkill: 'Skill',
    typeMcp: 'MCP',
    typeAgent: 'Assistant',
    confirmRevoke: 'Revoke this share link? Recipients will no longer be able to install from it.',
  },
};
```

- [ ] **Step 2: 写 zh-CN 预览翻译**

创建 `locales/zh-CN/share.json`，内容为同结构中文：

```json
{
  "button": {
    "share": "分享",
    "install": "安装",
    "revoke": "撤销",
    "copy": "复制链接",
    "done": "完成",
    "goToSettings": "前往设置"
  },
  "install": {
    "titleSkill": "安装 Skill",
    "titleMcp": "安装 MCP",
    "titleAgent": "安装助理",
    "descPrefix": "你将要安装",
    "installSuccess": "安装成功",
    "notFound": "该分享链接不存在或已被删除。",
    "expired": "该分享链接已失效或已被分享者撤销。",
    "alreadyInstalled": "你已经安装过该内容。"
  },
  "myShares": {
    "title": "我的分享",
    "empty": "你还没有分享过任何内容。",
    "colName": "名称",
    "colType": "类型",
    "colViews": "浏览",
    "colInstalls": "安装",
    "colCreated": "创建时间",
    "colStatus": "状态",
    "statusActive": "有效",
    "statusRevoked": "已撤销",
    "typeSkill": "Skill",
    "typeMcp": "MCP",
    "typeAgent": "助理",
    "confirmRevoke": "撤销这条分享链接？撤销后接收方将无法再通过它安装。"
  },
  "result": {
    "title": "分享链接已生成",
    "message": "把这条链接发给想分享的人，对方可直接安装，无需上架市场。",
    "linkLabel": "分享链接",
    "copied": "已复制"
  }
}
```

- [ ] **Step 3: 写 en-US 预览翻译**

创建 `locales/en-US/share.json`，内容与 Step 1 默认文案同结构（直接复制 `share.ts` 的英文值即可）。

- [ ] **Step 4: 提交**

```bash
git add src/locales/default/share.ts locales/zh-CN/share.json locales/en-US/share.json
git commit -m "✨ feat(share): 新增 share i18n 命名空间"
```

---

## Task 3: `useShare` hook + `ShareResultModal`

**Files:**

- Create: `src/features/PeerShare/useShare.ts`
- Create: `src/features/PeerShare/useShare.test.ts`
- Create: `src/features/PeerShare/ShareResultModal.tsx`
- Create: `src/features/PeerShare/index.ts`

**Interfaces:**

- Produces: `useShare()` → `{ share(itemType, localId), result, resultUrl, closeModal, copyLink }`。`share` 调 `communityApiService.createShare`，成功后把返回的 `url` 拼成完整 URL 并打开 `ShareResultModal`。

- Consumes: `communityApiService.createShare`（Task 1）。

- [ ] **Step 1: 写失败测试**

创建 `src/features/PeerShare/useShare.test.ts`：

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as marketApi from '@/services/marketApi';

import { useShare } from './useShare';

describe('useShare', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom 默认无 clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createShare 成功后展开 result modal 并暴露完整 URL', async () => {
    const spy = vi
      .spyOn(marketApi.communityApiService, 'createShare')
      .mockResolvedValue({ token: 'tok', url: '/share/tok', marketIdentifier: 'skl_1' });

    const { result } = renderHook(() => useShare());

    await act(async () => {
      await result.current.share('skill', 'local-1');
    });

    expect(spy).toHaveBeenCalledWith('skill', 'local-1');
    await waitFor(() => expect(result.current.result).not.toBeNull());
    expect(result.current.result?.open).toBe(true);
    // 完整 URL = origin + 相对 url
    expect(result.current.resultUrl).toContain('/share/tok');
    expect(result.current.resultUrl).toContain(window.location.origin);
  });

  it('createShare 抛错时不打开 modal', async () => {
    vi.spyOn(marketApi.communityApiService, 'createShare').mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useShare());

    await act(async () => {
      await expect(result.current.share('mcp', 'x')).rejects.toThrow('boom');
    });

    expect(result.current.result).toBeNull();
  });

  it('copyLink 调用 clipboard.writeText', async () => {
    vi.spyOn(marketApi.communityApiService, 'createShare').mockResolvedValue({
      token: 'tok',
      url: '/share/tok',
      marketIdentifier: 'mcp_1',
    });
    const { result } = renderHook(() => useShare());

    await act(async () => {
      await result.current.share('mcp', 'x');
    });

    await act(async () => {
      await result.current.copyLink();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(result.current.resultUrl);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bunx vitest run --silent='passed-only' 'src/features/PeerShare/useShare.test.ts'`
Expected: FAIL（`useShare` 不存在）。

- [ ] **Step 3: 写 hook**

创建 `src/features/PeerShare/useShare.ts`：

```ts
'use client';

import { useCallback, useState } from 'react';

import { communityApiService } from '@/services/marketApi';

export type ShareItemType = 'agent' | 'mcp' | 'skill';

export interface ShareResult {
  marketIdentifier: string;
  open: boolean;
  token: string;
}

const buildFullUrl = (relative: string) => `${window.location.origin}${relative}`;

export const useShare = () => {
  const [result, setResult] = useState<ShareResult | null>(null);
  const [loading, setLoading] = useState(false);

  const resultUrl = result ? buildFullUrl(`/share/${result.token}`) : '';

  const share = useCallback(async (itemType: ShareItemType, localId: string) => {
    setLoading(true);
    try {
      const res = await communityApiService.createShare(itemType, localId);
      setResult({ marketIdentifier: res.marketIdentifier, open: true, token: res.token });
    } finally {
      setLoading(false);
    }
  }, []);

  const copyLink = useCallback(async () => {
    if (!resultUrl) return;
    await navigator.clipboard.writeText(resultUrl);
  }, [resultUrl]);

  const closeModal = useCallback(() => {
    setResult((prev) => (prev ? { ...prev, open: false } : null));
  }, []);

  return { closeModal, copyLink, loading, result, resultUrl, share };
};
```

> 注：`buildFullUrl` 用 `/share/${token}` 重组而非直接用后端 `res.url`，二者等价（后端 `recordShare` 返回 `url: /share/${token}`），显式重组让 URL 来源单一可测。

- [ ] **Step 4: 写 ShareResultModal**

创建 `src/features/PeerShare/ShareResultModal.tsx`：

```tsx
'use client';

import { Button, Input, Modal, Text } from '@lobehub/ui';
import { Copy } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface ShareResultModalProps {
  onClose: () => void;
  onCopy: () => Promise<void>;
  open: boolean;
  url: string;
}

const ShareResultModal = memo<ShareResultModalProps>(({ onClose, onCopy, open, url }) => {
  const { t } = useTranslation('share');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal
      centered
      cancelText={t('button.done')}
      open={open}
      title={t('result.title')}
      width={520}
      onCancel={onClose}
      footer={null}
    >
      <Text fontSize={14} type={'secondary'}>
        {t('result.message')}
      </Text>
      <div style={{ marginTop: 16 }}>
        <Text fontSize={13} type={'secondary'}>
          {t('result.linkLabel')}
        </Text>
        <Input
          readOnly
          style={{ marginTop: 8 }}
          value={url}
          suffix={
            <Button icon={Copy} size={'small'} type={'text'} onClick={handleCopy}>
              {copied ? t('result.copied') : t('button.copy')}
            </Button>
          }
        />
      </div>
    </Modal>
  );
});

export default ShareResultModal;
```

- [ ] **Step 5: 写 barrel**

创建 `src/features/PeerShare/index.ts`：

```ts
export { default as ShareResultModal } from './ShareResultModal';
export { useShare, type ShareItemType } from './useShare';
```

- [ ] **Step 6: 跑测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/features/PeerShare/useShare.test.ts'`
Expected: PASS（3/3）。

- [ ] **Step 7: 提交**

```bash
git add src/features/PeerShare/
git commit -m "✨ feat(share): useShare hook + ShareResultModal"
```

---

## Task 4: 三处分享按钮（skill /mcp/agent）

> 三处宿主共用 Task 3 的 `useShare` + `ShareResultModal`，注入方式一致：在已有动作区加一个「分享」入口（DropdownMenu item 或 Button），onClick 调 `share(itemType, localId)`，渲染 `<ShareResultModal>`。每个宿主文件先 Read 再改，按周围风格放置。

**Files:**

- Modify: `src/routes/(main)/settings/skill/features/AgentSkillItem.tsx`
- Modify: `src/routes/(main)/settings/skill/features/EditMcpPlugin.tsx`
- Modify: `src/routes/(main)/agent/profile/features/Header/AgentPublishButton/index.tsx`

**Interfaces:**

- Consumes: `useShare`（Task 3）。

- [ ] **Step 1: skill 项加分享动作**

Read `src/routes/(main)/settings/skill/features/AgentSkillItem.tsx`，确认其 props 暴露了 skill 的 `identifier`（与 `BuiltinSkillItem` 同形：`identifier: string`）。

在文件顶部加 import：

```ts
import { Share2 } from 'lucide-react';

import { ShareResultModal, useShare } from '@/features/PeerShare';
```

在组件内调 hook：

```ts
const { share, result, resultUrl, closeModal, copyLink } = useShare();
```

在该项的动作区（参照 `BuiltinSkillItem` 的 `renderActions` 里 `DropdownMenu` 的 `items` 数组）追加一项：

```ts
{
  icon: <Icon icon={Share2} />,
  key: 'share',
  label: t('button.share', { ns: 'share' }),
  onClick: () => share('skill', identifier),
},
```

在组件 return 的根容器内（与现有 modal 同级）追加：

```tsx
<ShareResultModal onClose={closeModal} onCopy={copyLink} open={!!result?.open} url={resultUrl} />
```

- [ ] **Step 2: mcp 项加分享动作**

Read `src/routes/(main)/settings/skill/features/EditMcpPlugin.tsx`，确认其持有 MCP 的 `identifier`（用户已装 MCP 的 identifier，即 `userInstalledPlugins.identifier`—— 与后端 `createMcpShare(identifier)` 入参一致）。

同 Step 1 方式：import `Share2` + `ShareResultModal, useShare`；调 `useShare()`；在动作区加「分享」项 `onClick: () => share('mcp', identifier)`；渲染 `<ShareResultModal>`。

> 若 `EditMcpPlugin` 是编辑弹窗而非列表项，则在弹窗 footer 或标题栏加一个「分享」Button，onClick 同上。按 Read 到的实际结构放置。

- [ ] **Step 3: agent 头部加分享动作**

Read `src/routes/(main)/agent/profile/features/Header/AgentPublishButton/index.tsx`。该按钮区域已存在「发布到市场」逻辑与 `PublishResultModal`。

在「发布」按钮**旁边**加一个「分享」按钮（不替代发布）：

```tsx
<Button
  icon={<Icon icon={Share2} />}
  loading={shareLoading}
  onClick={() => share('agent', agentId)}
>
  {t('button.share', { ns: 'share' })}
</Button>
```

其中 `agentId` 取该组件已有的 agent id prop/context（Read 确认变量名），`shareLoading`、`share`、`result`、`resultUrl`、`closeModal`、`copyLink` 来自 `useShare()`。在组件根追加 `<ShareResultModal>`（与既有 `PublishResultModal` 同级，独立 open 状态）。

import：

```ts
import { Share2 } from 'lucide-react';

import { ShareResultModal, useShare } from '@/features/PeerShare';
```

- [ ] **Step 4: 类型自检**

用 LSP 对三个被改文件分别诊断，确认无新增类型错误。

- [ ] **Step 5: 提交**

```bash
git add "src/routes/(main)/settings/skill/features/AgentSkillItem.tsx" "src/routes/(main)/settings/skill/features/EditMcpPlugin.tsx" "src/routes/(main)/agent/profile/features/Header/AgentPublishButton/index.tsx"
git commit -m "✨ feat(share): skill/mcp/agent 管理处加分享按钮"
```

---

## Task 5: `/share/:token` 预览安装页 + 路由注册

**Files:**

- Create: `src/features/PeerShare/ShareInstallPage.tsx`
- Create: `src/features/PeerShare/ShareInstallPage.test.ts`
- Create: `src/routes/share/[token]/index.tsx`
- Modify: `src/spa/router/desktopRouter.config.tsx`（`/share/t` 块之后）
- Modify: `src/spa/router/desktopRouter.config.desktop.tsx`（同步）

**Interfaces:**

- Consumes: `communityApiService.getShareByToken` / `installSkill` / `installMcp` / `installAgent` / `recordShareInstall`（Task 1 + 既有）。

- Produces: `/share/:token` 路由 → `ShareInstallPage`。

- [ ] **Step 1: 写失败测试**

创建 `src/features/PeerShare/ShareInstallPage.test.ts`。测核心派发逻辑（抽一个纯函数 `resolveInstaller` 出来单测，避免渲染 SWR 全家桶）：

```ts
import { describe, expect, it, vi } from 'vitest';

import { communityApiService } from '@/services/marketApi';

import { resolveInstaller } from './ShareInstallPage';

describe('resolveInstaller', () => {
  it('skill → installSkill', () => {
    const spy = vi.spyOn(communityApiService, 'installSkill').mockResolvedValue(undefined as never);
    resolveInstaller('skill', 'skl_1')();
    expect(spy).toHaveBeenCalledWith('skl_1');
  });

  it('mcp → installMcp', () => {
    const spy = vi.spyOn(communityApiService, 'installMcp').mockResolvedValue(undefined as never);
    resolveInstaller('mcp', 'mcp_1')();
    expect(spy).toHaveBeenCalledWith('mcp_1');
  });

  it('agent → installAgent', () => {
    const spy = vi.spyOn(communityApiService, 'installAgent').mockResolvedValue(undefined as never);
    resolveInstaller('agent', 'agt_1')();
    expect(spy).toHaveBeenCalledWith('agt_1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bunx vitest run --silent='passed-only' 'src/features/PeerShare/ShareInstallPage.test.ts'`
Expected: FAIL（`resolveInstaller` 不存在）。

- [ ] **Step 3: 写 ShareInstallPage**

创建 `src/features/PeerShare/ShareInstallPage.tsx`：

```tsx
'use client';

import { Alert, Button, Flexbox, Spin, Text } from '@lobehub/ui';
import { Result } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { communityApiService } from '@/services/marketApi';

type ItemType = 'skill' | 'mcp' | 'agent';

/**
 * 按 itemType 选既有 install 方法——与市场 detail 页同一调用，
 * 安装逻辑零改动。导出供单测。
 */
export const resolveInstaller = (itemType: ItemType, marketIdentifier: string) => {
  switch (itemType) {
    case 'skill':
      return () => communityApiService.installSkill(marketIdentifier);
    case 'mcp':
      return () => communityApiService.installMcp(marketIdentifier);
    case 'agent':
      return () => communityApiService.installAgent(marketIdentifier);
  }
};

const isTRPCCode = (err: unknown, code: string) => {
  const e = err as { data?: { code?: string }; code?: string };
  return e?.data?.code === code || e?.code === code;
};

const ShareInstallPage = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('share');

  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [data, setData] = useState<{
    itemType: ItemType;
    marketIdentifier: string;
    name: string | null;
  } | null>(null);
  const [error, setError] = useState<'notFound' | 'expired' | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    communityApiService
      .getShareByToken(token)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(isTRPCCode(err, 'CONFLICT') ? 'expired' : 'notFound');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleInstall = async () => {
    if (!data) return;
    setInstalling(true);
    try {
      await resolveInstaller(data.itemType, data.marketIdentifier)();
      await communityApiService.recordShareInstall(token).catch(() => undefined);
      setInstalled(true);
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ height: '60vh' }}>
        <Spin />
      </Flexbox>
    );
  }

  if (error) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ height: '60vh', padding: 24 }}>
        <Result
          status={error === 'expired' ? 'warning' : '404'}
          subTitle={
            <Text type={'secondary'}>
              {error === 'expired' ? t('install.expired') : t('install.notFound')}
            </Text>
          }
          title={error === 'expired' ? t('install.expired') : t('install.notFound')}
        />
      </Flexbox>
    );
  }

  if (installed) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ height: '60vh', padding: 24 }} gap={16}>
        <Result
          status="success"
          subTitle={<Text type={'secondary'}>{t('install.installSuccess')}</Text>}
        />
        <Button onClick={() => navigate('/')}>{t('button.done')}</Button>
      </Flexbox>
    );
  }

  const itemType = data!.itemType;
  const titleKey =
    itemType === 'skill'
      ? 'install.titleSkill'
      : itemType === 'mcp'
        ? 'install.titleMcp'
        : 'install.titleAgent';

  return (
    <Flexbox align={'center'} justify={'center'} style={{ height: '60vh', padding: 24 }} gap={16}>
      <Text fontSize={24} weight={'bold'}>
        {t(titleKey)}
      </Text>
      <Alert
        type={'info'}
        message={`${t('install.descPrefix')} ${data!.name ?? data!.marketIdentifier}`}
      />
      <Button loading={installing} type={'primary'} onClick={handleInstall}>
        {t('button.install')}
      </Button>
    </Flexbox>
  );
};

export default ShareInstallPage;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bunx vitest run --silent='passed-only' 'src/features/PeerShare/ShareInstallPage.test.ts'`
Expected: PASS（3/3）。

- [ ] **Step 5: 写路由 thin 段**

创建 `src/routes/share/[token]/index.tsx`：

```tsx
'use client';

import ShareInstallPage from '@/features/PeerShare/ShareInstallPage';

export default ShareInstallPage;
```

并把 `ShareInstallPage` 加入 `src/features/PeerShare/index.ts` barrel：

```ts
export { default as ShareInstallPage } from './ShareInstallPage';
```

- [ ] **Step 6: 注册路由（desktopRouter.config.tsx）**

Read `src/spa/router/desktopRouter.config.tsx` 的 `/share/t` 块（约 625-636 行）。在该块**之后**、数组闭合 `];` 之前，加 `/share/:token` 兄弟路由：

```tsx
  // Peer share install route (outside main layout)
  {
    element: dynamicElement(
      () => import('@/routes/share/[token]'),
      'Desktop > Share > Install',
    ),
    path: '/share/:token',
  },
```

> `/share/:token` 是 1 段，`/share/t/:id` 是 2 段，路径深度不同，react-router 不会冲突。

- [ ] **Step 7: 同步 desktopRouter.config.desktop.tsx**

Read `src/spa/router/desktopRouter.config.desktop.tsx` 的 `/share/t` 块（约 509 行附近）。在其后加同形路由。该文件是静态 import 风格，先在顶部 import 区加：

```ts
import ShareInstallPage from '@/routes/share/[token]';
```

再在 `/share/t` 块之后加：

```tsx
  {
    element: <ShareInstallPage />,
    path: '/share/:token',
  },
```

> 严格按该文件既有静态风格写（若其他路由用 element 对象则对齐）。

- [ ] **Step 8: 类型自检**

用 LSP 对 `ShareInstallPage.tsx` 与两个 router config 诊断。

- [ ] **Step 9: 提交**

```bash
git add src/features/PeerShare/ShareInstallPage.tsx src/features/PeerShare/ShareInstallPage.test.ts src/features/PeerShare/index.ts "src/routes/share/[token]/index.tsx" src/spa/router/desktopRouter.config.tsx src/spa/router/desktopRouter.config.desktop.tsx
git commit -m "✨ feat(share): /share/:token 预览安装页 + 路由注册"
```

---

## Task 6: 「我的分享」settings 子页

**Files:**

- Modify: `src/store/global/initialState.ts`（`SettingsTabs` 加 `Share`）
- Modify: `src/routes/(main)/settings/features/SettingsContent.tsx`（`share` case）
- Modify: `src/routes/(main)/settings/_layout/SidebarContent.tsx`（侧栏入口）
- Create: `src/routes/(main)/settings/share/index.tsx`（thin）
- Create: `src/features/PeerShare/MySharesList.tsx`

**Interfaces:**

- Consumes: `communityApiService.getMyShares` / `revokeShare`（Task 1）；`SettingsTabs` 枚举。

- [ ] **Step 1: 加 SettingsTabs 枚举值**

Read `src/store/global/initialState.ts`，找到 `SettingsTabs` enum（如 `Profile, Common, ...`）。在合适位置（与 `About` 等尾部项相邻）加：

```ts
  Share = 'share',
```

- [ ] **Step 2: SettingsContent 分发**

Read `src/routes/(main)/settings/features/SettingsContent.tsx`，找到按 `activeTab` switch 渲染的块。加一个 case（参照既有 tab 的渲染方式，通常 `renderContent` switch 或组件映射）：

```tsx
case SettingsTabs.Share:
  return <MySharesList />;
```

顶部加 import：

```ts
import { MySharesList } from '@/features/PeerShare';
```

> 若该文件用「组件映射对象」而非 switch，则在该对象加 `[SettingsTabs.Share]: MySharesList`，对齐既有风格。

- [ ] **Step 3: 侧栏入口**

Read `src/routes/(main)/settings/_layout/SidebarContent.tsx`，找到侧栏项列表（通常一个数组，每项 `{ key, label, icon, path }`）。参照 `About`/`Agent` 项加：

```ts
{
  key: SettingsTabs.Share,
  label: t('myShares.title', { ns: 'share' }),
  // icon 按既有图标体系选一个，如 Share2
  path: '/settings/share',
}
```

> 按该文件既有项的真实字段名 / 图标组件对齐（Read 后确认）。

- [ ] **Step 4: 写 MySharesList**

创建 `src/features/PeerShare/MySharesList.tsx`：

```tsx
'use client';

import { Avatar, Button, Flexbox, Table, Tag, Text } from '@lobehub/ui';
import { App } from 'antd';
import { Share2, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import { communityApiService } from '@/services/marketApi';

interface ShareRow {
  createdAt: string | number | Date | null;
  installCount: number | null;
  itemType: 'agent' | 'mcp' | 'skill';
  marketIdentifier: string;
  name: string | null;
  revokedAt: string | number | Date | null;
  token: string;
  viewCount: number | null;
}

const MySharesList = memo(() => {
  const { t } = useTranslation('share');
  const { modal, message } = App.useApp();
  const { data, mutate, isLoading } = useSWR('my-shares', () => communityApiService.getMyShares());

  const handleRevoke = (token: string) => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        await communityApiService.revokeShare(token);
        await mutate();
        message.success(t('statusRevoked'));
      },
      title: t('myShares.confirmRevoke'),
      type: 'error',
    });
  };

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/share/${token}`);
    message.success(t('result.copied'));
  };

  if (!isLoading && (!data || data.length === 0)) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ padding: 64 }}>
        <Text type={'secondary'}>{t('myShares.empty')}</Text>
      </Flexbox>
    );
  }

  const typeLabel = (itemType: ShareRow['itemType']) =>
    itemType === 'skill'
      ? t('myShares.typeSkill')
      : itemType === 'mcp'
        ? t('myShares.typeMcp')
        : t('myShares.typeAgent');

  const columns = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null, r: ShareRow) => (
        <Flexbox horizontal align={'center'} gap={8}>
          <Avatar size={24} />
          <span>{v ?? r.marketIdentifier}</span>
        </Flexbox>
      ),
      title: t('myShares.colName'),
    },
    {
      dataIndex: 'itemType',
      key: 'itemType',
      render: (v: ShareRow['itemType']) => <Tag>{typeLabel(v)}</Tag>,
      title: t('myShares.colType'),
    },
    { dataIndex: 'viewCount', key: 'viewCount', title: t('myShares.colViews') },
    { dataIndex: 'installCount', key: 'installCount', title: t('myShares.colInstalls') },
    {
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: ShareRow['createdAt']) => (
        <span>{v ? new Date(v as any).toLocaleDateString() : '-'}</span>
      ),
      title: t('myShares.colCreated'),
    },
    {
      dataIndex: 'status',
      key: 'status',
      render: (_: unknown, r: ShareRow) => (
        <Tag color={r.revokedAt ? 'red' : 'green'}>
          {r.revokedAt ? t('myShares.statusRevoked') : t('myShares.statusActive')}
        </Tag>
      ),
      title: t('myShares.colStatus'),
    },
    {
      dataIndex: 'actions',
      key: 'actions',
      render: (_: unknown, r: ShareRow) => (
        <Flexbox horizontal gap={8}>
          <Button icon={Share2} size={'small'} type={'text'} onClick={() => handleCopy(r.token)}>
            {t('button.copy')}
          </Button>
          {!r.revokedAt && (
            <Button
              danger
              icon={Trash2}
              size={'small'}
              type={'text'}
              onClick={() => handleRevoke(r.token)}
            >
              {t('button.revoke')}
            </Button>
          )}
        </Flexbox>
      ),
      title: '',
    },
  ];

  return (
    <Table columns={columns} dataSource={data as ShareRow[]} loading={isLoading} rowKey={'token'} />
  );
});

export default MySharesList;
```

> `ShareRow` 字段名以后端 `shareModel.findMyList()` 返回行为准（`token/ownerId/itemType/marketIdentifier/name/revokedAt/expiresAt/viewCount/installCount/createdAt`）。若实际字段名不同，按 Read 后端 `packages/database/src/models/share.ts` 的 `findMyList` 返回对齐。

把 `MySharesList` 加入 `src/features/PeerShare/index.ts` barrel：

```ts
export { default as MySharesList } from './MySharesList';
```

- [ ] **Step 5: 写 settings share thin 段**

创建 `src/routes/(main)/settings/share/index.tsx`：

```tsx
'use client';

import { MySharesList } from '@/features/PeerShare';
import { useTranslation } from 'react-i18next';

import { SettingContainer, SettingTitle } from '@/components/SettingContainer';

const Page = () => {
  const { t } = useTranslation('share');
  return (
    <SettingContainer>
      <SettingTitle title={t('myShares.title')} />
      <MySharesList />
    </SettingContainer>
  );
};

export default Page;
```

> `SettingContainer` / `SettingTitle` 的真实导入路径与用法：Read `src/routes/(main)/settings/apikey/index.tsx` 后对齐（该文件是既有 settings 子页范例）。

- [ ] **Step 6: 类型自检**

用 LSP 对改动的 5 个文件分别诊断。

- [ ] **Step 7: 提交**

```bash
git add src/store/global/initialState.ts "src/routes/(main)/settings/features/SettingsContent.tsx" "src/routes/(main)/settings/_layout/SidebarContent.tsx" "src/routes/(main)/settings/share/index.tsx" src/features/PeerShare/MySharesList.tsx src/features/PeerShare/index.ts
git commit -m "✨ feat(share): 我的分享 settings 子页"
```

---

## Self-Review

- **Spec 覆盖**：
  - §3.1 createShare（skill/mcp/agent 三类）→ Task 1 service + Task 3 hook + Task 4 三按钮。
  - §3.2 安装 = 既有 install\* + getByToken/recordInstall → Task 1 service + Task 5 `ShareInstallPage`（`resolveInstaller` 逐字调 `installSkill/installMcp/installAgent`，CONFLICT/NOT_FOUND 分支）。
  - §3.3 revoke/myShares → Task 1 service + Task 6 `MySharesList`。
  - §3.4 TRPC → 后端已完成，前端 Task 1 消费。
  - 安装逻辑零改动（硬约束）→ Task 5 `resolveInstaller` 仅转调既有方法，不新增 install 实现；agent 级联靠后端 `installAgent`。
  - MCP 凭据剥离 → 后端已处理（`sanitizeMcpCustomParamsForMarket`），前端无感。
  - 平台范围 Desktop+Web → Task 5/6 只改 `desktopRouter.config.tsx` + `.desktop.tsx`，不改 mobile。
- **占位符**：无 TBD/TODO。对既有大文件的修改（Task 4 三宿主、Task 6 SettingsContent/SidebarContent/SettingContainer）均给出要注入的**确切代码**与「Read 后按周围风格放置」的明确指令，非空泛描述。
- **类型一致**：`useShare` 返回 `{share,result,resultUrl,copyLink,closeModal,loading}` 在 Task 3 定义、Task 4 消费，名称一致；`resolveInstaller(itemType, marketIdentifier)` 在 Task 5 Step 3 定义、Step 1 测试、Task 5 内消费，签名一致；`ShareItemType = 'agent'|'mcp'|'skill'` 与后端 `createShare` 入参一致；`communityApiService.createShare/getShareByToken/revokeShare/getMyShares/recordShareInstall` 方法名在 Task 1 定义、Task 3/5/6 消费，逐字一致。
- **测试**：Task 3 `useShare` 3 例（成功展开 / 失败不展开 / 复制）；Task 5 `resolveInstaller` 3 例（三类派发到正确 install）。service/i18n / 路由注册按既有无测惯例不测（与 `installSkill` 等既有方法对等）。
