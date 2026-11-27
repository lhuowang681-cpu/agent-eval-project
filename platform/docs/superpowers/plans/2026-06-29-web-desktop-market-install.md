# Web / 桌面市场安装支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自建市场里的 Skill 和 MCP 在应用内 Web / 桌面端都能正确安装、激活和执行。

**Architecture:** Skill 安装继续落用户数据库，但必须从本地 `market_skills` 生成 ZIP、存储 ZIP 文件并写入 `agent_skills.zipFileHash`，供桌面端解压为本地执行目录。MCP 安装保留 HTTP/cloud 的轻量落库路径，stdio MCP 改走完整 `installMCPPlugin`，只检查 runner 级别依赖，并为非程序员提供下载 / 引导入口。

**Tech Stack:** Next.js/tRPC + Drizzle/PostgreSQL + Electron IPC + Zustand + Vitest

## Global Constraints

- 只支持应用内 Web / 桌面使用，不实现官方 `curl /skill.md` 外部 agent 安装生态。
- 不实现自研 `market-cli`，不安装到 `./.cursor/skills`、`./.claude/skills` 等外部 agent 目录。
- 市场是自建的，读写以本地 `market_skills` / `market_mcps` 为准。
- Skill 新安装和更新必须写入 `zipFileHash`；历史缺失 `zipFileHash` 的已安装 Skill 暂不迁移。
- MCP 不要求发布者填写结构化安装信息；只使用现有 `customParams.mcp` 连接配置。
- Web 端不运行本地 stdio MCP，也不做本地依赖安装。
- 桌面端 runner 引导只处理 `node/npm/npx`、`uv/uvx`、`python/python3/pip`、`docker` 和未知 command 的检测 / 下载引导，不自动执行任意 marketplace shell 命令。

---

## 文件结构

| 操作 | 文件                                                                                    | 职责                                                                 |
| ---- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 修改 | `src/server/services/community/index.ts`                                                | 升级 Skill 安装 / 更新为 ZIP-backed；MCP 轻量安装只保留给 HTTP/cloud |
| 修改 | `src/server/routers/lambda/market/skill.ts`                                             | 保持现有 API，内部使用升级后的 CommunityService                      |
| 修改 | `src/routes/(main)/community/(detail)/mcp/features/Sidebar/ActionButton/InstallMcp.tsx` | stdio MCP 改调用 `installMCPPlugin`，HTTP/cloud 保留轻量安装         |
| 修改 | `src/store/tool/slices/mcpStore/action.ts`                                              | 依赖缺失时展示 runner 引导状态，支持重新检查继续安装                 |
| 创建 | `src/helpers/mcpRunner.ts`                                                              | 从 `customParams.mcp.command` 识别 runner 类型和下载引导             |
| 创建 | `src/features/MCP/MCPInstallProgress/MCPRunnerGuide.tsx`                                | 面向非程序员的 runner 缺失安装引导                                   |
| 修改 | `src/features/MCP/MCPInstallProgress/index.tsx`                                         | 接入 runner 引导组件                                                 |
| 修改 | `src/services/electron/desktopSkillRuntime.ts`                                          | 不改主逻辑，只补充必要错误提示或测试覆盖                             |
| 测试 | `src/server/services/community/index.test.ts` 或现有 community 测试                     | 覆盖 Skill ZIP-backed 安装 / 更新                                    |
| 测试 | `src/helpers/mcpRunner.test.ts`                                                         | 覆盖 runner 识别                                                     |
| 测试 | `src/store/tool/slices/mcpStore/action.test.ts`                                         | 覆盖 stdio 走完整安装、HTTP/cloud 轻量安装                           |

---

### Task 1: Skill 市场安装写入 ZIP

**Files:**

- Modify: `src/server/services/community/index.ts`
- Test: `src/server/services/community/index.test.ts` 或项目现有 CommunityService 测试文件

**Interfaces:**

- Consumes: `MarketSkillModel.findByIdentifier(identifier)`

- Consumes: `SkillParser.buildSkillZipPackage({ content, manifest, resources })`

- Produces: `CommunityService.installSkill(identifier)` 创建的 `agent_skills` 记录包含 `zipFileHash`

- Produces: `CommunityService.updateInstalledSkill(identifier)` 更新内容和 `zipFileHash`

- [ ] **Step 1: 写失败测试，新安装 market skill 时生成 zipFileHash**

测试要构造一个本地 market skill，调用 `CommunityService.installSkill(identifier)`，断言用户 skill 记录包含 `zipFileHash` 和安装来源字段。

```ts
it('installs market skill with zipFileHash for desktop runtime', async () => {
  await marketSkillModel.create({
    identifier: 'playwright-skill',
    name: 'Playwright Skill',
    description: 'Browser automation',
    manifest: { name: 'Playwright Skill', description: 'Browser automation' },
    content: '# Playwright Skill\n\nUse playwright-cli.',
    resources: {
      'references/setup.md': {
        content: 'Install playwright-cli before use.',
        encoding: 'utf8',
      },
    },
    version: '1.0.0',
    visibility: 'public',
  });

  const installed = await communityService.installSkill('playwright-skill');

  expect(installed.zipFileHash).toBeTruthy();
  expect(installed.installedFromMarketIdentifier).toBe('playwright-skill');
  expect(installed.installedMarketVersion).toBe('1.0.0');
  expect(installed.resources).toMatchObject({
    'references/setup.md': expect.anything(),
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/server/services/community/index.test.ts'
```

Expected: FAIL，因为当前 `_installSkill` 只做 DB copy，不写 `zipFileHash`。

- [ ] **Step 3: 在 CommunityService 增加 ZIP 构建辅助方法**

在 `src/server/services/community/index.ts` 中引入 `SkillParser`、`SkillResourceService`、`FileService` 或项目内已用于 `SkillImporter` 的资源 / 文件服务。辅助方法负责把 market skill 字段转换为 ZIP 并保存。

```ts
private async buildAndStoreMarketSkillZip(marketSkill: {
  content?: string | null;
  manifest: SkillManifest;
  resources?: Record<string, any> | null;
}) {
  const resources = new Map<string, Buffer>();

  for (const [path, resource] of Object.entries(marketSkill.resources ?? {})) {
    if (typeof resource === 'string') {
      resources.set(path, Buffer.from(resource, 'utf8'));
      continue;
    }

    if (resource && typeof resource === 'object' && 'content' in resource) {
      const encoding = resource.encoding === 'base64' ? 'base64' : 'utf8';
      resources.set(path, Buffer.from(String(resource.content), encoding));
    }
  }

  const { buffer, hash } = await this.skillParser.buildSkillZipPackage({
    content: marketSkill.content ?? '',
    manifest: marketSkill.manifest,
    resources,
  });

  const zipKey = `skills/zip/${hash}.zip`;
  await this.fileService.uploadBuffer(zipKey, buffer, 'application/zip');
  await this.fileService.createGlobalFile({
    fileHash: hash,
    fileType: 'application/zip',
    metadata: {
      dirname: 'skills/zip',
      filename: `${hash}.zip`,
      path: zipKey,
    },
    size: buffer.length,
    url: zipKey,
  });

  return hash;
}
```

如果 `resources` 当前存的是 resource id 映射而不是 inline content，先使用现有 `SkillResourceService` 读取实际内容后再放入 ZIP。不要在这里改变市场表结构。

- [ ] **Step 4: 修改 `_installSkill` 写入 `zipFileHash`**

在创建 `agentSkillModel.create` 前生成 hash，并把 `zipFileHash` 写入创建参数。

```ts
const zipFileHash = await this.buildAndStoreMarketSkillZip({
  content: marketSkill.content,
  manifest: marketSkill.manifest,
  resources: marketSkill.resources,
});

const localSkill = await this.agentSkillModel.create({
  identifier,
  name: marketSkill.name,
  description: marketSkill.description,
  source: marketSkill.visibility === 'bundled' ? 'bundled' : 'market',
  manifest: marketSkill.manifest,
  content: marketSkill.content,
  editorData: marketSkill.editorData,
  resources: marketSkill.resources,
  zipFileHash,
  installedFromMarketIdentifier: identifier,
  installedFromSnapshot: {
    name: marketSkill.name,
    description: marketSkill.description,
    manifest: marketSkill.manifest,
    content: marketSkill.content,
  },
  installedMarketVersion: marketSkill.version,
});
```

- [ ] **Step 5: 修改 `_updateInstalledSkill` 重建 ZIP**

更新时同样调用 `buildAndStoreMarketSkillZip`，并在 `agentSkillModel.update` 中写入 `zipFileHash`。

```ts
const zipFileHash = await this.buildAndStoreMarketSkillZip({
  content: marketSkill.content,
  manifest: marketSkill.manifest,
  resources: marketSkill.resources,
});

await this.agentSkillModel.update(localSkill.id, {
  name: marketSkill.name,
  description: marketSkill.description,
  manifest: marketSkill.manifest,
  content: marketSkill.content,
  editorData: marketSkill.editorData,
  resources: marketSkill.resources,
  zipFileHash,
  installedFromSnapshot: {
    name: marketSkill.name,
    description: marketSkill.description,
    manifest: marketSkill.manifest,
    content: marketSkill.content,
  },
  installedMarketVersion: marketSkill.version,
});
```

- [ ] **Step 6: 运行 Skill 安装测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/server/services/community/index.test.ts'
```

Expected: PASS。

---

### Task 2: 桌面端 Skill ZIP 执行链路验证

**Files:**

- Modify/Test: `src/services/electron/desktopSkillRuntime.ts`
- Test: `src/services/electron/desktopSkillRuntime.test.ts` 或相邻测试文件
- Test: `src/server/routers/lambda/agentSkills.ts` 相关测试

**Interfaces:**

- Consumes: `agentSkills.getByIdWithZipUrl({ id })`

- Consumes: `localFileService.prepareSkillDirectory({ url, zipHash })`

- Produces: `desktopSkillRuntimeService.resolveExecutionDirectory(activatedSkills)` 返回本地目录

- [ ] **Step 1: 写测试，带 zipFileHash 的 skill 能解析执行目录**

Mock `agentSkillService.getById` 返回带 `zipFileHash` 的 skill，Mock `agentSkillService.getZipUrl` 返回 URL，Mock `localFileService.prepareSkillDirectory` 返回 extracted dir。

```ts
it('resolves local execution directory for zipped market skill', async () => {
  vi.spyOn(agentSkillService, 'getById').mockResolvedValue({
    id: 'skill-1',
    name: 'Playwright Skill',
    zipFileHash: 'hash-1',
  } as any);
  vi.spyOn(agentSkillService, 'getZipUrl').mockResolvedValue({
    name: 'Playwright Skill',
    url: 'https://files.example/skills/hash-1.zip',
  });
  vi.spyOn(localFileService, 'prepareSkillDirectory').mockResolvedValue({
    extractedDir: '/tmp/lobeyoyo/skills/hash-1',
    success: true,
  } as any);

  const cwd = await desktopSkillRuntimeService.resolveExecutionDirectory([
    { id: 'skill-1', name: 'Playwright Skill' },
  ] as any);

  expect(cwd).toBe('/tmp/lobeyoyo/skills/hash-1');
});
```

- [ ] **Step 2: 运行测试确认现有逻辑是否已通过**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/services/electron/desktopSkillRuntime.test.ts'
```

Expected: PASS 或在测试文件不存在时先创建测试文件。该任务目标是锁住已有行为，不需要重构运行时。

- [ ] **Step 3: 增加缺 ZIP 的明确返回语义测试**

历史缺 `zipFileHash` 的 skill 本期不迁移，运行时保持返回 `undefined`，让命令在默认 cwd 执行或后续 UI 提示处理。

```ts
it('returns undefined when installed skill has no zipFileHash', async () => {
  vi.spyOn(agentSkillService, 'getById').mockResolvedValue({
    id: 'legacy-skill',
    name: 'Legacy Skill',
    zipFileHash: null,
  } as any);

  const cwd = await desktopSkillRuntimeService.resolveExecutionDirectory([
    { id: 'legacy-skill', name: 'Legacy Skill' },
  ] as any);

  expect(cwd).toBeUndefined();
  expect(agentSkillService.getZipUrl).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: 运行桌面 skill runtime 测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/services/electron/desktopSkillRuntime.test.ts'
```

Expected: PASS。

---

### Task 3: MCP runner 识别与引导数据

**Files:**

- Create: `src/helpers/mcpRunner.ts`
- Test: `src/helpers/mcpRunner.test.ts`

**Interfaces:**

- Produces: `detectMcpRunner(command?: string): McpRunnerInfo`

- Produces: `getMcpRunnerGuide(runner: McpRunner): McpRunnerGuide`

- Consumes later: `MCPRunnerGuide` UI and `mcpStore/action.ts`

- [ ] **Step 1: 写 runner 识别测试**

```ts
import { detectMcpRunner } from './mcpRunner';

describe('detectMcpRunner', () => {
  it.each([
    ['npx', 'node'],
    ['npm', 'node'],
    ['node', 'node'],
    ['uvx', 'uv'],
    ['uv', 'uv'],
    ['python', 'python'],
    ['python3', 'python'],
    ['pip', 'python'],
    ['docker', 'docker'],
    ['/usr/local/bin/npx', 'node'],
    ['custom-server', 'unknown'],
  ])('maps %s to %s runner', (command, runner) => {
    expect(detectMcpRunner(command).runner).toBe(runner);
  });
});
```

- [ ] **Step 2: 实现 helper**

```ts
export type McpRunner = 'docker' | 'node' | 'python' | 'unknown' | 'uv';

export interface McpRunnerInfo {
  command?: string;
  displayName: string;
  runner: McpRunner;
}

export interface McpRunnerGuide {
  description: string;
  downloadUrl?: string;
  manualCommand?: string;
  title: string;
}

const basename = (command?: string) => command?.split(/[\\/]/).pop()?.toLowerCase();

export const detectMcpRunner = (command?: string): McpRunnerInfo => {
  const name = basename(command);

  if (name === 'node' || name === 'npm' || name === 'npx') {
    return { command, displayName: 'Node.js', runner: 'node' };
  }

  if (name === 'uv' || name === 'uvx') {
    return { command, displayName: 'uv', runner: 'uv' };
  }

  if (name === 'python' || name === 'python3' || name === 'pip') {
    return { command, displayName: 'Python', runner: 'python' };
  }

  if (name === 'docker') {
    return { command, displayName: 'Docker', runner: 'docker' };
  }

  return { command, displayName: command || 'Command', runner: 'unknown' };
};

export const getMcpRunnerGuide = (runner: McpRunner): McpRunnerGuide => {
  switch (runner) {
    case 'node':
      return {
        title: 'Install Node.js',
        description: 'This MCP server uses Node.js or npx. Install Node.js, then retry.',
        downloadUrl: 'https://nodejs.org/',
      };
    case 'uv':
      return {
        title: 'Install uv',
        description: 'This MCP server uses uv or uvx. Install uv, then retry.',
        downloadUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
      };
    case 'python':
      return {
        title: 'Install Python',
        description: 'This MCP server uses Python. Install Python 3, then retry.',
        downloadUrl: 'https://www.python.org/downloads/',
      };
    case 'docker':
      return {
        title: 'Install Docker',
        description: 'This MCP server uses Docker. Install Docker Desktop, then retry.',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
      };
    default:
      return {
        title: 'Install required command',
        description: 'Install the missing command, then retry the MCP installation.',
      };
  }
};
```

- [ ] **Step 3: 运行 helper 测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/helpers/mcpRunner.test.ts'
```

Expected: PASS。

---

### Task 4: MCP stdio 安装走完整流程

**Files:**

- Modify: `src/routes/(main)/community/(detail)/mcp/features/Sidebar/ActionButton/InstallMcp.tsx`
- Modify: `src/store/discover/slices/mcp/action.ts` if install action needs to expose connection type
- Test: `src/routes/(main)/community/(detail)/mcp/features/Sidebar/ActionButton/InstallMcp.test.tsx` or nearest existing test

**Interfaces:**

- Consumes: MCP detail `customParams.mcp.type` or `connectionType`

- Consumes: `useToolStore().installMCPPlugin(identifier)`

- Consumes: `useDiscoverStore().installMcp(identifier)` for lightweight HTTP/cloud installs

- Produces: stdio MCP install invokes full install flow

- [ ] **Step 1: 写组件 / 行为测试**

Mock 当前 detail 为 stdio MCP，点击安装后应调用 `installMCPPlugin`，不调用轻量 `installMcp`。

```tsx
it('uses full install flow for stdio market MCP', async () => {
  const installMCPPlugin = vi.fn().mockResolvedValue(true);
  const installMcp = vi.fn().mockResolvedValue(undefined);

  mockToolStore({ installMCPPlugin });
  mockDiscoverStore({ installMcp });
  mockMcpDetailContext({
    identifier: 'stdio-mcp',
    customParams: { mcp: { type: 'stdio', command: 'npx', args: ['-y', 'server'] } },
  });

  render(<InstallMcp />);
  await userEvent.click(screen.getByRole('button', { name: /install/i }));

  expect(installMCPPlugin).toHaveBeenCalledWith('stdio-mcp');
  expect(installMcp).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 修改安装分支**

在 `InstallMcp.tsx` 中获取当前 MCP 的连接类型。优先读取 `customParams.mcp.type`，没有时用 `connectionType`。

```ts
const isStdioMcp =
  detail?.customParams?.mcp?.type === 'stdio' || detail?.connectionType === 'stdio';

const handleInstall = async () => {
  if (isStdioMcp) {
    await installMCPPlugin(identifier);
  } else {
    await installMcp(identifier);
  }

  await refreshPlugins();
};
```

保持发布者下线 / 重新上架 / 恢复本地逻辑不变。只替换普通用户安装和更新路径。

- [ ] **Step 3: HTTP/cloud 保持轻量安装测试**

```tsx
it('keeps lightweight install for http market MCP', async () => {
  mockMcpDetailContext({
    identifier: 'http-mcp',
    customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
  });

  render(<InstallMcp />);
  await userEvent.click(screen.getByRole('button', { name: /install/i }));

  expect(installMcp).toHaveBeenCalledWith('http-mcp');
  expect(installMCPPlugin).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: 运行 MCP 安装按钮测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/routes/(main)/community/(detail)/mcp/features/Sidebar/ActionButton/InstallMcp.test.tsx'
```

Expected: PASS。

---

### Task 5: Runner 缺失时显示非程序员友好的引导

**Files:**

- Create: `src/features/MCP/MCPInstallProgress/MCPRunnerGuide.tsx`
- Modify: `src/features/MCP/MCPInstallProgress/index.tsx`
- Modify: `src/store/tool/slices/mcpStore/action.ts`
- Test: `src/features/MCP/MCPInstallProgress/MCPRunnerGuide.test.tsx`

**Interfaces:**

- Consumes: `installProgress.connection.command`

- Consumes: `installProgress.systemDependencies`

- Produces: UI with download/open guide and recheck button

- [ ] **Step 1: 写 UI 测试**

```tsx
it('shows Node.js guide and retry action for missing npx runner', async () => {
  const installMCPPlugin = vi.fn();
  mockToolStore({ installMCPPlugin });

  render(<MCPRunnerGuide identifier="stdio-mcp" command="npx" />);

  expect(screen.getByText(/Node\.js/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
    'href',
    'https://nodejs.org/',
  );

  await userEvent.click(screen.getByRole('button', { name: /recheck/i }));
  expect(installMCPPlugin).toHaveBeenCalledWith('stdio-mcp');
});
```

- [ ] **Step 2: 实现 `MCPRunnerGuide`**

```tsx
import { Button, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';

import { detectMcpRunner, getMcpRunnerGuide } from '@/helpers/mcpRunner';
import { useToolStore } from '@/store/tool';

interface MCPRunnerGuideProps {
  command?: string;
  identifier: string;
}

const MCPRunnerGuide = memo<MCPRunnerGuideProps>(({ command, identifier }) => {
  const installMCPPlugin = useToolStore((s) => s.installMCPPlugin);
  const runner = detectMcpRunner(command);
  const guide = getMcpRunnerGuide(runner.runner);

  return (
    <Flexbox gap={12} padding={12}>
      <Text as="h5">{guide.title}</Text>
      <Text type="secondary">{guide.description}</Text>
      <Flexbox horizontal gap={8}>
        {guide.downloadUrl && (
          <Button href={guide.downloadUrl} target="_blank">
            Download
          </Button>
        )}
        <Button type="primary" onClick={() => installMCPPlugin(identifier)}>
          Recheck and continue
        </Button>
      </Flexbox>
    </Flexbox>
  );
});

export default MCPRunnerGuide;
```

后续可接 i18n；第一步先复用已有 `plugin` namespace 或最小英文文案，避免扩大范围。

- [ ] **Step 3: 在 `MCPInstallProgress/index.tsx` 中接入**

当 `DEPENDENCIES_REQUIRED` 且 `installProgress.connection?.command` 存在时，优先展示 `MCPRunnerGuide`；否则保留原 `MCPDependenciesGuide`。

```tsx
{
  needsDependencies && installProgress?.connection?.command ? (
    <MCPRunnerGuide command={installProgress.connection.command} identifier={identifier} />
  ) : (
    needsDependencies &&
    installProgress?.systemDependencies && (
      <MCPDependenciesGuide
        identifier={identifier}
        systemDependencies={installProgress.systemDependencies}
      />
    )
  );
}
```

- [ ] **Step 4: 确保 `installMCPPlugin` 缺依赖时保存 connection**

`src/store/tool/slices/mcpStore/action.ts` 目前在 `DEPENDENCIES_REQUIRED` 已保存 `connection: result.connection`。确认 current project 分支一致；如果没有，补上。

```ts
updateMCPInstallProgress(identifier, {
  connection: result.connection,
  manifest: data,
  progress: 40,
  step: MCPInstallStep.DEPENDENCIES_REQUIRED,
  systemDependencies: result.systemDependencies,
});
```

- [ ] **Step 5: 运行 runner guide 测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/features/MCP/MCPInstallProgress/MCPRunnerGuide.test.tsx'
```

Expected: PASS。

---

### Task 6: 回归测试和验收

**Files:**

- Test: `src/server/services/community/index.test.ts`
- Test: `src/store/tool/slices/mcpStore/action.test.ts`
- Test: `src/helpers/mcpRunner.test.ts`
- Test: `src/features/MCP/MCPInstallProgress/MCPRunnerGuide.test.tsx`

**Interfaces:**

- Produces: 新安装 Skill 对桌面端可执行

- Produces: stdio MCP 安装使用完整 flow

- Produces: HTTP/cloud MCP 不被过度复杂化

- [ ] **Step 1: 跑 Skill 相关测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/server/services/community/index.test.ts' 'src/services/electron/desktopSkillRuntime.test.ts'
```

Expected: PASS。

- [ ] **Step 2: 跑 MCP 相关测试**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/helpers/mcpRunner.test.ts' 'src/features/MCP/MCPInstallProgress/MCPRunnerGuide.test.tsx' 'src/store/tool/slices/mcpStore/action.test.ts'
```

Expected: PASS。

- [ ] **Step 3: 手动桌面验收**

在桌面开发环境中验证：

1. 安装一个 market skill。
2. 查询用户 skill 记录，确认 `zipFileHash` 存在。
3. 激活该 skill，让它执行一个引用资源或需要 CWD 的命令。
4. 安装一个 HTTP MCP，确认仍轻量落库并能调用。
5. 安装一个 `stdio` MCP，确认触发完整安装流程。
6. 如果本机缺 runner，确认显示下载 / 引导卡片。
7. 安装 runner 后点击 “重新检查并继续”，确认 MCP 落库并可调用。

- [ ] **Step 4: 不运行全量根 type-check，除非收尾必须**

遵守项目规则，默认使用测试和编辑诊断；如果确实需要全量类型检查，只在最终收尾运行一次：

```bash
bun run type-check
```

Expected: PASS；如果机器负载高，跳过并在最终说明中注明。

---

## Self-Review

- Spec coverage: 覆盖了 Skill ZIP-backed 安装、桌面 ZIP 执行、MCP stdio 完整安装、runner 引导、Web / 桌面边界。
- Placeholder scan: 本计划不包含 TBD/TODO；每个任务有明确文件、接口、测试和实现方向。
- Type consistency: `zipFileHash`、`installedFromMarketIdentifier`、`installMCPPlugin`、`MCPInstallStep.DEPENDENCIES_REQUIRED` 与现有代码命名一致。
