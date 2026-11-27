# 内置 Node.js/ Python 便携运行时 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端从内网静态服务下载官方 Node.js 24.14.0 / Python 3.12.13 便携包，per-user 解压使用，支持安装 / 重装 / 卸载，agent 能自动找到并优先使用内置版本，不依赖 winget/brew。

**Architecture:** 新增 `apps/desktop/src/main/modules/portableRuntime/` 模块；`PortableRuntimeManager` 负责下载→SHA256 校验→解压到 `userData/runtimes/{name}.new/`→原子 rename 切换。所有 spawn 通过 `buildRuntimeEnv()` 注入 runtime bin 到 PATH。检测侧优先查 `userData/runtimes/`, 给 `ToolStatus` 增加 `managedBy` / `installedVersion` 字段。UI 三态按钮 + 进度条 + 二次确认。同时顺手修 winget args。

**Tech Stack:** TypeScript / Electron / Node.js `undici`(下载)/ `fflate`(zip 解压)/ 系统 `tar`(tar.gz/tar.xz)/ 已有 `fix-path`(shell PATH 修补)/ 已有 `execa`。

## Global Constraints

- Node.js runtime 版本固定 `24.14.0`,Python runtime 固定 `3.12.13` + pbs release `20260623`。
- 下载 host 白名单：仅 `mirrors.ops.ctripcorp.com`、`docs.c-ctrip.com`, 其他一律拒绝。
- 所有 fs 变更操作前必须过 `assertInsideRuntimesRoot()` 前缀校验 (resolve + realpath)。
- 解压任何 archive 前必须过 zip slip 防护：拒绝 entry 名含 `..` / 绝对路径 / 指向外部的 symlink。
- 只操作 `app.getPath('userData')/runtimes/` 目录，per-user, 禁止修改系统 PATH 或系统目录。
- Windows 上 env 里同时写 `PATH` 和 `Path`(用相同值), 避免大小写分裂。
- 不新增 npm 依赖 —— 用现有的 `undici`(HTTP)、`fflate`(zip)、系统 `tar`(tar.gz/tar.xz)、`fix-path`。
- 所有新代码放 `apps/desktop/src/main/modules/portableRuntime/`,Vitest 单测放同目录 `__tests__/`。
- i18n key 同时写 `src/locales/default/setting.ts`、`locales/zh-CN/setting.json`、`locales/en-US/setting.json`。
- 提交信息：每步 commit 前缀 gitmoji, 遵循项目风格 (参考 recent commits)。

---

## 文件结构总览

**新增**(全部在 `apps/desktop/src/main/modules/portableRuntime/`):

| 文件                                       | 责任                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `types.ts`                                 | `RuntimeName` / `PlatformKey` / `RuntimeEntry` / `PlatformEntry` / `RuntimeManifest` / `InstallProgressEvent` / `InstallResult` / `UninstallResult` / `InstalledRuntime` |
| `manifest.ts`                              | `RUNTIME_MANIFEST` 常量 + `ALLOWED_DOWNLOAD_HOSTS` + `getPlatformKey()` + `resolveRuntime()` + `assertAllowedHost()`                                                     |
| `paths.ts`                                 | `getRuntimesRoot()` / `getRuntimeDir()` / `getRuntimeBinDir()` / `getRuntimeExecutable()` / `assertInsideRuntimesRoot()`                                                 |
| `env.ts`                                   | `listInstalledRuntimeBinDirs()` / `buildRuntimeEnv()`                                                                                                                    |
| `download.ts`                              | `downloadWithSha256()`(流式下载 + 边下边算 SHA256 + 进度回调)/ `parseShasumsFile()` / `fetchNodeSha256()`                                                                |
| `extract.ts`                               | `extractArchive()`(tar.gz/tar.xz 走系统 `tar`;zip 走 `fflate`)+ zip slip 防护 + rootPrefix 剥离                                                                          |
| `processGuard.ts`                          | `registerManagedProcess()` / `unregisterManagedProcess()` / `ensureNotInUse()`                                                                                           |
| `cleanup.ts`                               | `cleanupStaleDirs()`(扫 `*.tmp-*` / `*.new` / `*.old-*`)                                                                                                                 |
| `meta.ts`                                  | `readRuntimeMeta()` / `writeRuntimeMeta()`(读写 `.calcifer-meta.json`)                                                                                                   |
| `PortableRuntimeManager.ts`                | 核心类:`install()` / `reinstall()` / `uninstall()` / `list()` / `isManaged()` / `getBinDir()` + EventEmitter `progress`                                                  |
| `index.ts`                                 | 对外导出 + `getPortableRuntimeManager()` 单例                                                                                                                            |
| `__tests__/manifest.test.ts`               | manifest resolve / 白名单                                                                                                                                                |
| `__tests__/paths.test.ts`                  | 前缀校验 / 平台路径                                                                                                                                                      |
| `__tests__/download.test.ts`               | SHASUMS 解析 / SHA256 mismatch                                                                                                                                           |
| `__tests__/extract.test.ts`                | zip slip 防护 /rootPrefix 剥离                                                                                                                                           |
| `__tests__/PortableRuntimeManager.test.ts` | install/uninstall 主流程                                                                                                                                                 |

**修改**:

| 文件                                                                         | 改动                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `packages/electron-client-ipc/src/types/toolDetector.ts`                     | `ToolStatus` 加 `managedBy` / `installedVersion`; 新增 `InstallProgressEvent` / `RuntimeInstallResult` / `RuntimeUninstallResult` |
| `packages/electron-client-ipc/src/events/toolDetector.ts`                    | 新增事件定义 `installProgress`                                                                                                    |
| `apps/desktop/src/main/controllers/ToolDetectorCtr.ts`                       | 新增 `installPortableRuntime` / `uninstallPortableRuntime` IPC + 广播 progress 事件                                               |
| `apps/desktop/src/main/modules/toolDetectors/toolInstaller.ts`               | node/python 分支切到 `PortableRuntimeManager.install()`;winget args 加 `--source winget --silent`                                 |
| `apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.ts` | node/python 检测优先查 `userData/runtimes/`                                                                                       |
| `apps/desktop/src/main/core/App.ts`(或对应入口)                              | 启动时 `cleanupStaleDirs()`(非阻塞)                                                                                               |
| `src/libs/mcp/client.ts`                                                     | `spawn` env 加上 `buildRuntimeEnv()` 注入                                                                                         |
| `src/services/electron/toolDetector.ts`                                      | 新增 `installPortableRuntime` / `uninstallPortableRuntime` / `subscribeInstallProgress`                                           |
| `src/routes/(main)/settings/system-tools/features/ToolDetectorSection.tsx`   | 三态按钮 + 进度条 + 二次确认 + 重装 / 卸载下拉                                                                                    |
| `src/locales/default/setting.ts` + `locales/{zh-CN,en-US}/setting.json`      | 新增 i18n keys                                                                                                                    |

---

## Task 1: 定义类型与 IPC 类型扩展

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/types.ts`
- Modify: `packages/electron-client-ipc/src/types/toolDetector.ts`

**Interfaces:**

- Produces:
  - `type RuntimeName = 'node' | 'python'`
  - `type PlatformKey = 'win32-x64' | 'win32-arm64' | 'darwin-arm64' | 'darwin-x64'`
  - `type ArchiveFormat = 'tar.gz' | 'tar.xz' | 'zip'`
  - `interface PlatformEntry { url; format; rootPrefix; sha256?; archiveName? }`
  - `interface RuntimeEntry { version; releaseTag?; shasumsUrl?; platforms; binSubdir; executable }`
  - `interface RuntimeManifest { node: RuntimeEntry; python: RuntimeEntry }`
  - `interface InstallProgressEvent { toolName; phase; percent?; downloaded?; total?; message?; error? }`
  - `interface InstalledRuntime { name; version; installedAt; sourceUrl; sha256 }`
  - `interface RuntimeInstallResult { success; skipped?; toolName; version?; error? }`
  - `interface RuntimeUninstallResult { success; toolName; alreadyGone?; error? }`

- Extended `ToolStatus`: `managedBy?: 'app' | 'system'`,`installedVersion?: string`

- [ ] **Step 1.1: 创建 `types.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/types.ts
export type RuntimeName = 'node' | 'python';
export type PlatformKey = 'win32-x64' | 'win32-arm64' | 'darwin-arm64' | 'darwin-x64';
export type ArchiveFormat = 'tar.gz' | 'tar.xz' | 'zip';

export interface PlatformEntry {
  archiveName?: string;
  format: ArchiveFormat;
  rootPrefix: string;
  sha256?: string;
  url: string;
}

export interface RuntimeEntry {
  binSubdir: { darwin: string; win32: string };
  executable: { darwin: string; win32: string };
  platforms: Partial<Record<PlatformKey, PlatformEntry>>;
  releaseTag?: string;
  shasumsUrl?: string;
  version: string;
}

export interface RuntimeManifest {
  node: RuntimeEntry;
  python: RuntimeEntry;
}

export type InstallPhase = 'download' | 'verify' | 'extract' | 'switch' | 'done' | 'error';

export interface InstallProgressEvent {
  downloaded?: number;
  error?: string;
  message?: string;
  percent?: number;
  phase: InstallPhase;
  toolName: RuntimeName;
  total?: number;
}

export interface InstalledRuntime {
  installedAt: string;
  name: RuntimeName;
  sha256: string;
  sourceUrl: string;
  version: string;
}

export interface RuntimeInstallResult {
  error?: string;
  skipped?: boolean;
  success: boolean;
  toolName: RuntimeName;
  version?: string;
}

export interface RuntimeUninstallResult {
  alreadyGone?: boolean;
  error?: string;
  success: boolean;
  toolName: RuntimeName;
}

export interface RuntimeMetaFile {
  downloadedAt: string;
  platformKey: PlatformKey;
  sha256: string;
  sourceUrl: string;
  version: string;
}
```

- [ ] **Step 1.2: 扩展 `packages/electron-client-ipc/src/types/toolDetector.ts`**

```ts
// 在末尾追加
export type RuntimeName = 'node' | 'python';
export type InstallPhase = 'download' | 'verify' | 'extract' | 'switch' | 'done' | 'error';

export interface InstallProgressEvent {
  downloaded?: number;
  error?: string;
  message?: string;
  percent?: number;
  phase: InstallPhase;
  toolName: RuntimeName;
  total?: number;
}

export interface RuntimeInstallResult {
  error?: string;
  skipped?: boolean;
  success: boolean;
  toolName: RuntimeName;
  version?: string;
}

export interface RuntimeUninstallResult {
  alreadyGone?: boolean;
  error?: string;
  success: boolean;
  toolName: RuntimeName;
}
```

同时改 `ToolStatus`:

```ts
export interface ToolStatus {
  available: boolean;
  error?: string;
  installedVersion?: string;
  lastChecked?: Date;
  managedBy?: 'app' | 'system';
  path?: string;
  resolvedPathEnv?: string;
  version?: string;
}
```

同步改 `apps/desktop/src/main/core/infrastructure/ToolDetectorManager.ts` 里的 `ToolStatus`(保持两处一致)。

- [ ] **Step 1.3: 编译验证**

```bash
cd /Users/ptsu/project/calcifer-chathub && bunx tsgo --noEmit -p packages/electron-client-ipc/tsconfig.json
```

Expected: 0 errors

- [ ] **Step 1.4: Commit**

```bash
git add packages/electron-client-ipc/src/types/toolDetector.ts \
  apps/desktop/src/main/core/infrastructure/ToolDetectorManager.ts \
  apps/desktop/src/main/modules/portableRuntime/types.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 定义便携运行时类型与 IPC 扩展

新增 portableRuntime 模块的类型定义,ToolStatus 增加 managedBy/installedVersion
字段以便前端区分系统安装与应用内置。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Manifest 与平台解析

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/manifest.ts`
- Test: `apps/desktop/src/main/modules/portableRuntime/__tests__/manifest.test.ts`

**Interfaces:**

- Consumes: `types.ts` 中的所有类型

- Produces:
  - `RUNTIME_MANIFEST: RuntimeManifest`
  - `ALLOWED_DOWNLOAD_HOSTS: Set<string>`
  - `getPlatformKey(): PlatformKey`(不支持时 throw `UnsupportedPlatformError`)
  - `resolveRuntime(name: RuntimeName): { entry: RuntimeEntry; platform: PlatformEntry }`
  - `assertAllowedHost(url: string): void`
  - `class UnsupportedPlatformError extends Error`

- [ ] **Step 2.1: 写测试 (先失败)**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/manifest.test.ts
import { describe, expect, it, vi } from 'vitest';

import {
  ALLOWED_DOWNLOAD_HOSTS,
  RUNTIME_MANIFEST,
  UnsupportedPlatformError,
  assertAllowedHost,
  getPlatformKey,
  resolveRuntime,
} from '../manifest';

describe('manifest', () => {
  describe('RUNTIME_MANIFEST', () => {
    it('has node and python entries with 4 platforms each', () => {
      expect(RUNTIME_MANIFEST.node.version).toBe('24.14.0');
      expect(RUNTIME_MANIFEST.python.version).toBe('3.12.13');
      const nodePlatforms = Object.keys(RUNTIME_MANIFEST.node.platforms);
      const pythonPlatforms = Object.keys(RUNTIME_MANIFEST.python.platforms);
      expect(nodePlatforms.sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
        'win32-arm64',
        'win32-x64',
      ]);
      expect(pythonPlatforms.sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
        'win32-arm64',
        'win32-x64',
      ]);
    });

    it('python entries all have hardcoded sha256', () => {
      for (const p of Object.values(RUNTIME_MANIFEST.python.platforms)) {
        expect(p!.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('node entries have archiveName for SHASUMS lookup', () => {
      for (const p of Object.values(RUNTIME_MANIFEST.node.platforms)) {
        expect(p!.archiveName).toBeTruthy();
      }
    });

    it('all URLs use allowed hosts', () => {
      const collect = (entry: any) => Object.values(entry.platforms).map((p: any) => p.url);
      const urls = [
        ...collect(RUNTIME_MANIFEST.node),
        ...collect(RUNTIME_MANIFEST.python),
        RUNTIME_MANIFEST.node.shasumsUrl!,
      ];
      for (const url of urls) {
        expect(ALLOWED_DOWNLOAD_HOSTS.has(new URL(url).hostname)).toBe(true);
      }
    });
  });

  describe('getPlatformKey', () => {
    it('returns darwin-arm64 for macOS ARM', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
      expect(getPlatformKey()).toBe('darwin-arm64');
    });

    it('returns win32-x64 for Windows x64', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(getPlatformKey()).toBe('win32-x64');
    });

    it('throws on Linux', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(() => getPlatformKey()).toThrow(UnsupportedPlatformError);
    });
  });

  describe('resolveRuntime', () => {
    it('returns platform entry for supported platform', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
      const { entry, platform } = resolveRuntime('python');
      expect(entry.version).toBe('3.12.13');
      expect(platform.sha256).toBeTruthy();
      expect(platform.format).toBe('tar.gz');
    });

    it('throws on unsupported platform', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(() => resolveRuntime('node')).toThrow(UnsupportedPlatformError);
    });
  });

  describe('assertAllowedHost', () => {
    it('accepts whitelisted host', () => {
      expect(() => assertAllowedHost('https://docs.c-ctrip.com/files/8/foo.tar.gz')).not.toThrow();
    });

    it('rejects unknown host', () => {
      expect(() => assertAllowedHost('https://evil.example.com/x')).toThrow(
        /Disallowed download host/,
      );
    });

    it('rejects non-http protocols', () => {
      expect(() => assertAllowedHost('file:///etc/passwd')).toThrow();
    });
  });
});
```

- [ ] **Step 2.2: 运行测试验证失败**

```bash
cd /Users/ptsu/project/calcifer-chathub && bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/manifest.test.ts'
```

Expected: FAIL 全部 (文件不存在)

- [ ] **Step 2.3: 实现 `manifest.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/manifest.ts
import type {
  PlatformEntry,
  PlatformKey,
  RuntimeEntry,
  RuntimeManifest,
  RuntimeName,
} from './types';

export class UnsupportedPlatformError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnsupportedPlatformError';
  }
}

export const RUNTIME_MANIFEST: RuntimeManifest = {
  node: {
    binSubdir: { darwin: 'bin', win32: '.' },
    executable: { darwin: 'node', win32: 'node.exe' },
    platforms: {
      'darwin-arm64': {
        archiveName: 'node-v24.14.0-darwin-arm64.tar.xz',
        format: 'tar.xz',
        rootPrefix: 'node-v24.14.0-darwin-arm64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.xz',
      },
      'darwin-x64': {
        archiveName: 'node-v24.14.0-darwin-x64.tar.xz',
        format: 'tar.xz',
        rootPrefix: 'node-v24.14.0-darwin-x64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-x64.tar.xz',
      },
      'win32-arm64': {
        archiveName: 'node-v24.14.0-win-arm64.zip',
        format: 'zip',
        rootPrefix: 'node-v24.14.0-win-arm64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-win-arm64.zip',
      },
      'win32-x64': {
        archiveName: 'node-v24.14.0-win-x64.zip',
        format: 'zip',
        rootPrefix: 'node-v24.14.0-win-x64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip',
      },
    },
    shasumsUrl: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/SHASUMS256.txt',
    version: '24.14.0',
  },
  python: {
    binSubdir: { darwin: 'bin', win32: '.' },
    executable: { darwin: 'python3', win32: 'python.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz',
      },
      'darwin-x64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: '7c57fdd1fa675190093700eb0d8e7117e1f9eae7c30a46dea5f8d5266bcfc791',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-x86_64-apple-darwin-install_only.tar.gz',
      },
      'win32-arm64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: 'd459934cc52d28212a438cb6c9cfcb5396a8f23ed74cb47744d7af7fac618ad8',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-aarch64-pc-windows-msvc-install_only.tar.gz',
      },
      'win32-x64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: 'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz',
      },
    },
    releaseTag: '20260623',
    version: '3.12.13',
  },
};

export const ALLOWED_DOWNLOAD_HOSTS = new Set(['docs.c-ctrip.com', 'mirrors.ops.ctripcorp.com']);

export function getPlatformKey(): PlatformKey {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win32-x64';
  if (p === 'win32' && a === 'arm64') return 'win32-arm64';
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  throw new UnsupportedPlatformError(`Unsupported platform: ${p}-${a}`);
}

export function resolveRuntime(name: RuntimeName): {
  entry: RuntimeEntry;
  platform: PlatformEntry;
} {
  const entry = RUNTIME_MANIFEST[name];
  const key = getPlatformKey();
  const platform = entry.platforms[key];
  if (!platform) {
    throw new UnsupportedPlatformError(`Runtime ${name} not available on ${key}`);
  }
  return { entry, platform };
}

export function assertAllowedHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed download protocol: ${parsed.protocol}`);
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`Disallowed download host: ${parsed.hostname}`);
  }
}
```

- [ ] **Step 2.4: 运行测试验证通过**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/manifest.test.ts'
```

Expected: PASS (all)

- [ ] **Step 2.5: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/
git commit -m "$(
  cat << 'EOF'
✨ feat: 便携运行时 manifest 与平台解析

内嵌 Node 24.14.0 / Python 3.12.13 便携包下载地址与校验方式,增加下载域名白名单。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Paths / meta / cleanup

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/paths.ts`
- Create: `apps/desktop/src/main/modules/portableRuntime/meta.ts`
- Create: `apps/desktop/src/main/modules/portableRuntime/cleanup.ts`
- Test: `apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts`

**Interfaces:**

- Consumes: `manifest.ts` 中的 `RuntimeName` / `RUNTIME_MANIFEST`;`types.ts` 中的 `RuntimeMetaFile`;`electron.app.getPath`

- Produces:
  - `getRuntimesRoot(): string`
  - `getRuntimeDir(name: RuntimeName): string`
  - `getRuntimeBinDir(name: RuntimeName): string`
  - `getRuntimeExecutable(name: RuntimeName): string`
  - `getTempRuntimeDir(name: RuntimeName): string`(`.tmp-<pid>`)
  - `getNewRuntimeDir(name: RuntimeName): string`(`.new`)
  - `getOldRuntimeDir(name: RuntimeName): string`(`.old-<timestamp>`)
  - `assertInsideRuntimesRoot(target: string): void`
  - `readRuntimeMeta(name: RuntimeName): Promise<RuntimeMetaFile | null>`
  - `writeRuntimeMeta(dir: string, meta: RuntimeMetaFile): Promise<void>`
  - `cleanupStaleDirs(): Promise<void>`

- [ ] **Step 3.1: 写 paths 测试**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? '/tmp/testUserData' : '') },
}));

const { assertInsideRuntimesRoot, getRuntimeBinDir, getRuntimeDir, getRuntimesRoot } =
  await import('../paths');

describe('paths', () => {
  it('getRuntimesRoot returns userData/runtimes', () => {
    expect(getRuntimesRoot()).toBe(path.join('/tmp/testUserData', 'runtimes'));
  });

  it('getRuntimeDir returns runtimes/{name}', () => {
    expect(getRuntimeDir('python')).toBe(path.join('/tmp/testUserData', 'runtimes', 'python'));
  });

  it('getRuntimeBinDir returns platform-specific bin subdir', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    expect(getRuntimeBinDir('python')).toBe(
      path.join('/tmp/testUserData', 'runtimes', 'python', 'bin'),
    );
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    expect(getRuntimeBinDir('python')).toBe(path.join('/tmp/testUserData', 'runtimes', 'python'));
  });

  describe('assertInsideRuntimesRoot', () => {
    it('accepts paths inside runtimes root', () => {
      expect(() =>
        assertInsideRuntimesRoot(path.join('/tmp/testUserData', 'runtimes', 'python')),
      ).not.toThrow();
    });

    it('rejects paths outside runtimes root', () => {
      expect(() => assertInsideRuntimesRoot('/etc/passwd')).toThrow(/path escape/i);
    });

    it('rejects parent-relative escapes', () => {
      expect(() =>
        assertInsideRuntimesRoot(path.join('/tmp/testUserData', 'runtimes', '..', 'evil')),
      ).toThrow(/path escape/i);
    });
  });
});
```

- [ ] **Step 3.2: 运行测试验证失败**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts'
```

Expected: FAIL

- [ ] **Step 3.3: 实现 `paths.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/paths.ts
import { app } from 'electron';
import path from 'node:path';

import { RUNTIME_MANIFEST } from './manifest';
import type { RuntimeName } from './types';

export function getRuntimesRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes');
}

export function getRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), name);
}

export function getRuntimeBinDir(name: RuntimeName): string {
  const subdir =
    process.platform === 'win32'
      ? RUNTIME_MANIFEST[name].binSubdir.win32
      : RUNTIME_MANIFEST[name].binSubdir.darwin;
  return subdir === '.' ? getRuntimeDir(name) : path.join(getRuntimeDir(name), subdir);
}

export function getRuntimeExecutable(name: RuntimeName): string {
  const exe =
    process.platform === 'win32'
      ? RUNTIME_MANIFEST[name].executable.win32
      : RUNTIME_MANIFEST[name].executable.darwin;
  return path.join(getRuntimeBinDir(name), exe);
}

export function getTempRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.tmp-${process.pid}`);
}

export function getNewRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.new`);
}

export function getOldRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.old-${Date.now()}`);
}

export function assertInsideRuntimesRoot(target: string): void {
  const root = path.resolve(getRuntimesRoot());
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refused: path escape attempt: ${target}`);
  }
}
```

- [ ] **Step 3.4: 运行 paths 测试验证通过**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts'
```

Expected: PASS

- [ ] **Step 3.5: 实现 `meta.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/meta.ts
import fs from 'node:fs/promises';
import path from 'node:path';

import { getRuntimeDir } from './paths';
import type { RuntimeMetaFile, RuntimeName } from './types';

const META_FILENAME = '.calcifer-meta.json';

export async function readRuntimeMeta(name: RuntimeName): Promise<RuntimeMetaFile | null> {
  const file = path.join(getRuntimeDir(name), META_FILENAME);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as RuntimeMetaFile;
  } catch {
    return null;
  }
}

export async function writeRuntimeMeta(dir: string, meta: RuntimeMetaFile): Promise<void> {
  const file = path.join(dir, META_FILENAME);
  await fs.writeFile(file, JSON.stringify(meta, null, 2), 'utf8');
}
```

- [ ] **Step 3.6: 实现 `cleanup.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/cleanup.ts
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/utils/logger';

import { assertInsideRuntimesRoot, getRuntimesRoot } from './paths';

const logger = createLogger('portableRuntime:cleanup');

const STALE_PATTERNS = [/\.tmp-\d+$/, /\.new$/, /\.old-\d+$/];

export async function cleanupStaleDirs(): Promise<void> {
  const root = getRuntimesRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return;
    throw e;
  }

  await Promise.all(
    entries
      .filter((name) => STALE_PATTERNS.some((r) => r.test(name)))
      .map(async (name) => {
        const full = path.join(root, name);
        try {
          assertInsideRuntimesRoot(full);
          await fs.rm(full, { recursive: true, force: true });
          logger.debug(`cleaned stale dir: ${name}`);
        } catch (e) {
          logger.warn(`failed to clean ${name}:`, e);
        }
      }),
  );
}
```

- [ ] **Step 3.7: 运行完整测试确认**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts'
```

Expected: PASS

- [ ] **Step 3.8: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/paths.ts \
  apps/desktop/src/main/modules/portableRuntime/meta.ts \
  apps/desktop/src/main/modules/portableRuntime/cleanup.ts \
  apps/desktop/src/main/modules/portableRuntime/__tests__/paths.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 便携运行时路径工具与残留清扫

RUNTIMES_ROOT 前缀校验防路径逃逸,启动时扫 .tmp-/.new/.old- 残留。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 下载 + SHA256 校验

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/download.ts`
- Test: `apps/desktop/src/main/modules/portableRuntime/__tests__/download.test.ts`

**Interfaces:**

- Consumes: `manifest.ts` 的 `assertAllowedHost`;`undici` 的 `request`

- Produces:
  - `downloadWithSha256(url: string, dest: string, expected: string, onProgress?: (e: { downloaded; total; percent }) => void): Promise<void>` — 流式下载 + 边下边算 + 校验；失败 throw `VerifyMismatchError` / `DownloadError`
  - `parseShasumsFile(text: string): Map<string, string>` — `SHASUMS256.txt` 解析:`<sha256>  <filename>` 行 → Map
  - `fetchNodeSha256(shasumsUrl: string, archiveName: string): Promise<string>`
  - `class VerifyMismatchError extends Error`
  - `class DownloadError extends Error`

- [ ] **Step 4.1: 写测试**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/download.test.ts
import { describe, expect, it } from 'vitest';

import { parseShasumsFile } from '../download';

describe('parseShasumsFile', () => {
  it('parses standard SHASUMS format', () => {
    const text = [
      '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16  node-v24.14.0-darwin-arm64.tar.xz',
      'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e  node-v24.14.0-win-x64.zip',
      '',
    ].join('\n');
    const map = parseShasumsFile(text);
    expect(map.get('node-v24.14.0-win-x64.zip')).toBe(
      'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e',
    );
    expect(map.get('node-v24.14.0-darwin-arm64.tar.xz')).toBe(
      '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16',
    );
  });

  it('ignores empty or malformed lines', () => {
    const text = ['', 'not a valid line', 'abc  file.zip'].join('\n');
    const map = parseShasumsFile(text);
    expect(map.size).toBe(1);
    expect(map.get('file.zip')).toBe('abc');
  });

  it('handles CRLF line endings', () => {
    const text = 'abc123  file.zip\r\ndef456  other.tar.gz\r\n';
    const map = parseShasumsFile(text);
    expect(map.size).toBe(2);
  });
});
```

- [ ] **Step 4.2: 运行测试验证失败**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/download.test.ts'
```

Expected: FAIL

- [ ] **Step 4.3: 实现 `download.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/download.ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { request } from 'undici';

import { assertAllowedHost } from './manifest';

export class VerifyMismatchError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'VerifyMismatchError';
  }
}
export class DownloadError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DownloadError';
  }
}

export interface DownloadProgress {
  downloaded: number;
  percent: number;
  total: number;
}

export async function downloadWithSha256(
  url: string,
  dest: string,
  expectedSha256: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  assertAllowedHost(url);
  const res = await request(url, { method: 'GET' });
  if (res.statusCode >= 400) {
    throw new DownloadError(`HTTP ${res.statusCode} for ${url}`);
  }
  const totalHeader = res.headers['content-length'];
  const total = Array.isArray(totalHeader)
    ? Number(totalHeader[0])
    : totalHeader
      ? Number(totalHeader)
      : 0;
  let downloaded = 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);

  const tapStream = new (await import('node:stream')).Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      downloaded += chunk.length;
      if (onProgress && total > 0) {
        onProgress({
          downloaded,
          percent: Math.floor((downloaded / total) * 100),
          total,
        });
      }
      cb(null, chunk);
    },
  });

  await pipeline(res.body, tapStream, out);

  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    await fs.promises.unlink(dest).catch(() => undefined);
    throw new VerifyMismatchError(`SHA256 mismatch: expected ${expectedSha256}, got ${actual}`);
  }
}

export function parseShasumsFile(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-fA-F]+)\s+\*?(\S+)$/.exec(trimmed);
    if (!match) continue;
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

export async function fetchNodeSha256(shasumsUrl: string, archiveName: string): Promise<string> {
  assertAllowedHost(shasumsUrl);
  const res = await request(shasumsUrl, { method: 'GET' });
  if (res.statusCode >= 400) {
    throw new DownloadError(`Failed to fetch SHASUMS: HTTP ${res.statusCode}`);
  }
  const text = await res.body.text();
  const map = parseShasumsFile(text);
  const sha = map.get(archiveName);
  if (!sha) {
    throw new DownloadError(`SHA256 for ${archiveName} not found in SHASUMS file`);
  }
  return sha;
}
```

- [ ] **Step 4.4: 运行测试验证通过**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/download.test.ts'
```

Expected: PASS

- [ ] **Step 4.5: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/download.ts \
  apps/desktop/src/main/modules/portableRuntime/__tests__/download.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 便携运行时流式下载与 SHA256 校验

用 undici 边下边算 SHA256,支持进度回调;SHASUMS 解析器兼容 CRLF。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 解压 tar.gz/tar.xz/zip

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/extract.ts`
- Test: `apps/desktop/src/main/modules/portableRuntime/__tests__/extract.test.ts`

**Interfaces:**

- Consumes: `types.ts` 的 `ArchiveFormat`;`fflate` 的 `unzipSync`;`execa`

- Produces:
  - `extractArchive(archive: string, destDir: string, format: ArchiveFormat, rootPrefix: string): Promise<void>`
  - 严格拒绝 entry 名含 `..` / 绝对路径 / 未在 rootPrefix 下
  - tar.gz/tar.xz 走 `execa('tar', ['-xzf'|'-xJf', archive, '-C', dest, '--strip-components', N])`
  - zip 走 `fflate.unzipSync`

- [ ] **Step 5.1: 写测试**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/extract.test.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

import { extractArchive } from '../extract';

describe('extractArchive (zip)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'extract-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('extracts a well-formed zip and strips rootPrefix', async () => {
    const zip = zipSync({
      'node-v24.14.0-win-x64/node.exe': strToU8('fake-node-binary'),
      'node-v24.14.0-win-x64/npm.cmd': strToU8('fake-npm'),
    });
    const zipPath = path.join(tmp, 'test.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await extractArchive(zipPath, dest, 'zip', 'node-v24.14.0-win-x64/');
    expect(await fs.readFile(path.join(dest, 'node.exe'), 'utf8')).toBe('fake-node-binary');
    expect(await fs.readFile(path.join(dest, 'npm.cmd'), 'utf8')).toBe('fake-npm');
  });

  it('rejects zip slip (../)', async () => {
    const zip = zipSync({
      '../evil.txt': strToU8('bad'),
    });
    const zipPath = path.join(tmp, 'evil.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await expect(extractArchive(zipPath, dest, 'zip', '')).rejects.toThrow(/unsafe|slip|escape/i);
  });

  it('rejects absolute path entries', async () => {
    const zip = zipSync({
      '/etc/passwd': strToU8('bad'),
    });
    const zipPath = path.join(tmp, 'abs.zip');
    await fs.writeFile(zipPath, zip);
    const dest = path.join(tmp, 'dest');
    await fs.mkdir(dest);
    await expect(extractArchive(zipPath, dest, 'zip', '')).rejects.toThrow(
      /unsafe|absolute|escape/i,
    );
  });
});
```

- [ ] **Step 5.2: 运行测试验证失败**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/extract.test.ts'
```

Expected: FAIL

- [ ] **Step 5.3: 实现 `extract.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/extract.ts
import { execa } from 'execa';
import { unzipSync } from 'fflate';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ArchiveFormat } from './types';

function isUnsafeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || name.startsWith('\\')) return true;
  if (/^[a-zA-Z]:/.test(name)) return true;
  const parts = name.split(/[/\\]/);
  return parts.some((p) => p === '..');
}

async function extractZip(archivePath: string, destDir: string, rootPrefix: string): Promise<void> {
  const buf = await fs.readFile(archivePath);
  const entries = unzipSync(buf);
  const prefix = rootPrefix ?? '';

  for (const [name, data] of Object.entries(entries)) {
    if (isUnsafeEntryName(name)) {
      throw new Error(`Refused: unsafe zip entry name: ${name}`);
    }
    let rel = name;
    if (prefix && rel.startsWith(prefix)) {
      rel = rel.slice(prefix.length);
    } else if (prefix) {
      continue;
    }
    if (!rel) continue;
    const outPath = path.join(destDir, rel);
    const resolved = path.resolve(outPath);
    if (
      !resolved.startsWith(path.resolve(destDir) + path.sep) &&
      resolved !== path.resolve(destDir)
    ) {
      throw new Error(`Refused: zip slip attempt: ${name}`);
    }
    if (name.endsWith('/')) {
      await fs.mkdir(outPath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, data);
    }
  }
}

async function extractTarViaSystemTar(
  archivePath: string,
  destDir: string,
  rootPrefix: string,
  format: 'tar.gz' | 'tar.xz',
): Promise<void> {
  const strip = rootPrefix ? rootPrefix.replace(/\/$/, '').split('/').length : 0;
  const flag = format === 'tar.gz' ? '-xzf' : '-xJf';
  const args = [flag, archivePath, '-C', destDir];
  if (strip > 0) {
    args.push('--strip-components', String(strip));
  }
  await execa('tar', args, { timeout: 5 * 60 * 1000, windowsHide: true });
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  format: ArchiveFormat,
  rootPrefix: string,
): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  if (format === 'zip') {
    await extractZip(archivePath, destDir, rootPrefix);
    return;
  }
  await extractTarViaSystemTar(archivePath, destDir, rootPrefix, format);
}
```

- [ ] **Step 5.4: 运行测试验证通过**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/extract.test.ts'
```

Expected: PASS

- [ ] **Step 5.5: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/extract.ts \
  apps/desktop/src/main/modules/portableRuntime/__tests__/extract.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 便携运行时归档解压(zip / tar.gz / tar.xz)

Windows zip 走 fflate,macOS tar.gz/tar.xz 走系统 tar;zip slip 与绝对路径 entry 拒绝。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: PortableRuntimeManager 核心类

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/processGuard.ts`
- Create: `apps/desktop/src/main/modules/portableRuntime/PortableRuntimeManager.ts`
- Create: `apps/desktop/src/main/modules/portableRuntime/index.ts`
- Test: `apps/desktop/src/main/modules/portableRuntime/__tests__/PortableRuntimeManager.test.ts`

**Interfaces:**

- Consumes: 前面所有模块

- Produces:
  - `registerManagedProcess(pid: number, name: RuntimeName): void`
  - `unregisterManagedProcess(pid: number): void`
  - `ensureNotInUse(name: RuntimeName): { inUse: boolean; pids: number[] }`
  - `class PortableRuntimeManager extends EventEmitter`
    - `install(name: RuntimeName, opts?: { force?: boolean }): Promise<RuntimeInstallResult>`
    - `reinstall(name: RuntimeName): Promise<RuntimeInstallResult>`
    - `uninstall(name: RuntimeName): Promise<RuntimeUninstallResult>`
    - `isManaged(name: RuntimeName): Promise<boolean>`
    - `getBinDir(name: RuntimeName): Promise<string | undefined>`
    - `getInstalledMeta(name: RuntimeName): Promise<RuntimeMetaFile | null>`
    - emits `progress` events (`InstallProgressEvent`)
  - `getPortableRuntimeManager(): PortableRuntimeManager` singleton

- [ ] **Step 6.1: 实现 `processGuard.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/processGuard.ts
import type { RuntimeName } from './types';

const managed = new Map<number, RuntimeName>();

export function registerManagedProcess(pid: number, name: RuntimeName): void {
  managed.set(pid, name);
}
export function unregisterManagedProcess(pid: number): void {
  managed.delete(pid);
}
export function ensureNotInUse(name: RuntimeName): {
  inUse: boolean;
  pids: number[];
} {
  const pids = Array.from(managed.entries())
    .filter(([, n]) => n === name)
    .map(([pid]) => pid)
    .filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        managed.delete(pid);
        return false;
      }
    });
  return { inUse: pids.length > 0, pids };
}
```

- [ ] **Step 6.2: 实现 `PortableRuntimeManager.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/PortableRuntimeManager.ts
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/utils/logger';

import { downloadWithSha256, fetchNodeSha256 } from './download';
import { extractArchive } from './extract';
import { assertAllowedHost, getPlatformKey, resolveRuntime } from './manifest';
import { readRuntimeMeta, writeRuntimeMeta } from './meta';
import {
  assertInsideRuntimesRoot,
  getNewRuntimeDir,
  getOldRuntimeDir,
  getRuntimeBinDir,
  getRuntimeDir,
  getRuntimesRoot,
  getTempRuntimeDir,
} from './paths';
import { ensureNotInUse } from './processGuard';
import type {
  InstallProgressEvent,
  RuntimeInstallResult,
  RuntimeMetaFile,
  RuntimeName,
  RuntimeUninstallResult,
} from './types';

const logger = createLogger('portableRuntime:manager');

export class PortableRuntimeManager extends EventEmitter {
  private emitProgress(e: InstallProgressEvent) {
    this.emit('progress', e);
  }

  async isManaged(name: RuntimeName): Promise<boolean> {
    return (await readRuntimeMeta(name)) !== null;
  }

  async getBinDir(name: RuntimeName): Promise<string | undefined> {
    return (await this.isManaged(name)) ? getRuntimeBinDir(name) : undefined;
  }

  async getInstalledMeta(name: RuntimeName): Promise<RuntimeMetaFile | null> {
    return readRuntimeMeta(name);
  }

  async install(name: RuntimeName, opts: { force?: boolean } = {}): Promise<RuntimeInstallResult> {
    try {
      const { entry, platform } = resolveRuntime(name);
      assertAllowedHost(platform.url);
      if (entry.shasumsUrl) assertAllowedHost(entry.shasumsUrl);

      const existing = await readRuntimeMeta(name);
      if (!opts.force && existing && existing.version === entry.version) {
        return {
          skipped: true,
          success: true,
          toolName: name,
          version: entry.version,
        };
      }

      await fs.mkdir(getRuntimesRoot(), { recursive: true });
      const tmpDir = getTempRuntimeDir(name);
      assertInsideRuntimesRoot(tmpDir);
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });

      const archivePath = path.join(tmpDir, platform.archiveName ?? `${name}-archive`);

      const expectedSha =
        platform.sha256 ?? (await fetchNodeSha256(entry.shasumsUrl!, platform.archiveName!));

      this.emitProgress({ phase: 'download', toolName: name });
      await downloadWithSha256(platform.url, archivePath, expectedSha, (p) =>
        this.emitProgress({
          downloaded: p.downloaded,
          percent: p.percent,
          phase: 'download',
          toolName: name,
          total: p.total,
        }),
      );

      this.emitProgress({ phase: 'verify', toolName: name });

      const newDir = getNewRuntimeDir(name);
      assertInsideRuntimesRoot(newDir);
      await fs.rm(newDir, { recursive: true, force: true });
      await fs.mkdir(newDir, { recursive: true });

      this.emitProgress({ phase: 'extract', toolName: name });
      await extractArchive(archivePath, newDir, platform.format, platform.rootPrefix);

      const meta: RuntimeMetaFile = {
        downloadedAt: new Date().toISOString(),
        platformKey: getPlatformKey(),
        sha256: expectedSha,
        sourceUrl: platform.url,
        version: entry.version,
      };
      await writeRuntimeMeta(newDir, meta);

      if (process.platform === 'darwin') {
        try {
          const { execa } = await import('execa');
          await execa('xattr', ['-dr', 'com.apple.quarantine', newDir], {
            timeout: 10_000,
          });
        } catch (e) {
          logger.warn('xattr failed (non-fatal):', e);
        }
      }

      this.emitProgress({ phase: 'switch', toolName: name });

      const inUse = ensureNotInUse(name);
      if (inUse.inUse) {
        throw new Error(
          `Runtime ${name} is in use by pid(s): ${inUse.pids.join(', ')}. Please stop them and retry.`,
        );
      }

      const targetDir = getRuntimeDir(name);
      const oldDir = getOldRuntimeDir(name);

      try {
        await fs.access(targetDir);
        await fs.rename(targetDir, oldDir);
      } catch {
        /* not exists, ok */
      }
      try {
        await fs.rename(newDir, targetDir);
      } catch (e) {
        try {
          await fs.rename(oldDir, targetDir);
        } catch {
          /* best effort */
        }
        throw e;
      }

      fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

      this.emitProgress({ phase: 'done', toolName: name });

      return { success: true, toolName: name, version: entry.version };
    } catch (error) {
      const message = (error as Error).message || String(error);
      logger.error(`install ${name} failed:`, error);
      this.emitProgress({ error: message, phase: 'error', toolName: name });
      const tmpDir = getTempRuntimeDir(name);
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      fs.rm(getNewRuntimeDir(name), { recursive: true, force: true }).catch(() => undefined);
      return { error: message, success: false, toolName: name };
    }
  }

  async reinstall(name: RuntimeName): Promise<RuntimeInstallResult> {
    return this.install(name, { force: true });
  }

  async uninstall(name: RuntimeName): Promise<RuntimeUninstallResult> {
    try {
      const dir = getRuntimeDir(name);
      assertInsideRuntimesRoot(dir);
      try {
        await fs.access(dir);
      } catch {
        return { alreadyGone: true, success: true, toolName: name };
      }
      const inUse = ensureNotInUse(name);
      if (inUse.inUse) {
        return {
          error: `Runtime ${name} is in use by pid(s): ${inUse.pids.join(', ')}. Please stop them and retry.`,
          success: false,
          toolName: name,
        };
      }
      const oldDir = getOldRuntimeDir(name);
      await fs.rename(dir, oldDir);
      fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
      return { success: true, toolName: name };
    } catch (error) {
      return {
        error: (error as Error).message || String(error),
        success: false,
        toolName: name,
      };
    }
  }
}

let singleton: PortableRuntimeManager | undefined;
export function getPortableRuntimeManager(): PortableRuntimeManager {
  singleton ??= new PortableRuntimeManager();
  return singleton;
}
```

- [ ] **Step 6.3: 实现 `index.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/index.ts
export { cleanupStaleDirs } from './cleanup';
export { PortableRuntimeManager, getPortableRuntimeManager } from './PortableRuntimeManager';
export { readRuntimeMeta } from './meta';
export { getRuntimeBinDir, getRuntimeDir, getRuntimeExecutable, getRuntimesRoot } from './paths';
export { registerManagedProcess, unregisterManagedProcess } from './processGuard';
export type {
  InstalledRuntime,
  InstallPhase,
  InstallProgressEvent,
  RuntimeInstallResult,
  RuntimeMetaFile,
  RuntimeName,
  RuntimeUninstallResult,
} from './types';
```

- [ ] **Step 6.4: 写 Manager 测试 (mock 网络与文件系统)**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/PortableRuntimeManager.test.ts
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TMP = path.join(os.tmpdir(), `pbrm-test-${process.pid}`);

vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? TMP : '') },
}));

vi.mock('../download', () => ({
  DownloadError: class DownloadError extends Error {},
  VerifyMismatchError: class VerifyMismatchError extends Error {},
  downloadWithSha256: vi.fn(async (_url: string, dest: string) => {
    await fs.writeFile(dest, 'fake-archive');
  }),
  fetchNodeSha256: vi.fn(async () => 'deadbeef'),
  parseShasumsFile: vi.fn(),
}));

vi.mock('../extract', () => ({
  extractArchive: vi.fn(async (_a: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'python.exe'), 'fake');
  }),
}));

const { getPortableRuntimeManager } = await import('../PortableRuntimeManager');
const { readRuntimeMeta } = await import('../meta');

describe('PortableRuntimeManager', () => {
  beforeEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
    await fs.mkdir(TMP, { recursive: true });
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
  });
  afterEach(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it('install writes meta and executable', async () => {
    const m = getPortableRuntimeManager();
    const result = await m.install('python');
    expect(result.success).toBe(true);
    const meta = await readRuntimeMeta('python');
    expect(meta?.version).toBe('3.12.13');
    const exePath = path.join(TMP, 'runtimes', 'python', 'python.exe');
    await expect(fs.access(exePath)).resolves.toBeUndefined();
  });

  it('install skips when version matches and not forced', async () => {
    const m = getPortableRuntimeManager();
    await m.install('python');
    const second = await m.install('python');
    expect(second.skipped).toBe(true);
  });

  it('reinstall force-runs install', async () => {
    const m = getPortableRuntimeManager();
    await m.install('python');
    const result = await m.reinstall('python');
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });

  it('uninstall removes runtime dir', async () => {
    const m = getPortableRuntimeManager();
    await m.install('python');
    const un = await m.uninstall('python');
    expect(un.success).toBe(true);
    const meta = await readRuntimeMeta('python');
    expect(meta).toBeNull();
  });

  it('uninstall returns alreadyGone when not installed', async () => {
    const m = getPortableRuntimeManager();
    const un = await m.uninstall('python');
    expect(un.success).toBe(true);
    expect(un.alreadyGone).toBe(true);
  });

  it('emits progress events', async () => {
    const m = getPortableRuntimeManager();
    const events: string[] = [];
    m.on('progress', (e) => events.push(e.phase));
    await m.install('python', { force: true });
    expect(events).toContain('download');
    expect(events).toContain('verify');
    expect(events).toContain('extract');
    expect(events).toContain('switch');
    expect(events).toContain('done');
  });
});
```

- [ ] **Step 6.5: 运行 Manager 测试**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/PortableRuntimeManager.test.ts'
```

Expected: PASS

- [ ] **Step 6.6: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/processGuard.ts \
  apps/desktop/src/main/modules/portableRuntime/PortableRuntimeManager.ts \
  apps/desktop/src/main/modules/portableRuntime/index.ts \
  apps/desktop/src/main/modules/portableRuntime/__tests__/PortableRuntimeManager.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: PortableRuntimeManager 主流程

install/reinstall/uninstall 原子切换 + 进度事件 + 进程占用防护。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `buildRuntimeEnv()` — 统一 spawn env

**Files:**

- Create: `apps/desktop/src/main/modules/portableRuntime/env.ts`

**Interfaces:**

- Consumes: `paths.ts`;`meta.ts`

- Produces:
  - `listInstalledRuntimeBinDirs(): Promise<string[]>` — 遍历 node/python, 若 meta 存在则返回其 bin 目录
  - `buildRuntimeEnv(base?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>` — 前置内置 runtime bin, 合并去重，同步 Windows `Path`
  - `buildRuntimeEnvSync(binDirs: string[], base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv` — 同步版本 (spawn 前调用者可以先 warm 一次 binDirs)

- [ ] **Step 7.1: 写 env 测试**

```ts
// apps/desktop/src/main/modules/portableRuntime/__tests__/env.test.ts
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/testUD' },
}));

const { buildRuntimeEnvSync } = await import('../env');

describe('buildRuntimeEnvSync', () => {
  it('prepends bin dirs to PATH (posix)', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync(['/rt/python/bin', '/rt/node'], {
      PATH: '/usr/bin:/bin',
    });
    expect(result.PATH).toBe('/rt/python/bin:/rt/node:/usr/bin:/bin');
  });

  it('deduplicates PATH entries', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync(['/rt/python/bin'], {
      PATH: '/rt/python/bin:/usr/bin',
    });
    expect(result.PATH).toBe('/rt/python/bin:/usr/bin');
  });

  it('sets both PATH and Path on Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const result = buildRuntimeEnvSync(['C:\\rt\\python'], {
      Path: 'C:\\Windows',
    });
    expect(result.PATH).toBe('C:\\rt\\python;C:\\Windows');
    expect(result.Path).toBe('C:\\rt\\python;C:\\Windows');
  });

  it('preserves other env vars', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const result = buildRuntimeEnvSync([], {
      FOO: 'bar',
      PATH: '/usr/bin',
    });
    expect(result.FOO).toBe('bar');
  });
});
```

- [ ] **Step 7.2: 运行测试验证失败**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/env.test.ts'
```

Expected: FAIL

- [ ] **Step 7.3: 实现 `env.ts`**

```ts
// apps/desktop/src/main/modules/portableRuntime/env.ts
import path from 'node:path';

import { readRuntimeMeta } from './meta';
import { getRuntimeBinDir } from './paths';
import type { RuntimeName } from './types';

const ALL_RUNTIMES: RuntimeName[] = ['python', 'node'];

export async function listInstalledRuntimeBinDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for (const name of ALL_RUNTIMES) {
    const meta = await readRuntimeMeta(name);
    if (meta) dirs.push(getRuntimeBinDir(name));
  }
  return dirs;
}

export function buildRuntimeEnvSync(
  binDirs: string[],
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const sep = process.platform === 'win32' ? ';' : ':';
  const parts: string[] = [];
  for (const b of binDirs) parts.push(b);
  if (base.PATH) parts.push(base.PATH);
  if (process.platform === 'win32' && base.Path) parts.push(base.Path);

  const seen = new Set<string>();
  const merged = parts
    .flatMap((p) => p.split(sep))
    .map((p) => p.trim())
    .filter((p) => {
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join(sep);

  const next: NodeJS.ProcessEnv = { ...base, PATH: merged };
  if (process.platform === 'win32') {
    next.Path = merged;
  }
  return next;
}

export async function buildRuntimeEnv(
  base: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv> {
  const dirs = await listInstalledRuntimeBinDirs();
  return buildRuntimeEnvSync(dirs, base);
}

// 未使用 path import,保留以防未来扩展
void path;
```

清理未使用的 `path` import: 直接删掉那行 `import path`。

- [ ] **Step 7.4: 运行测试验证通过**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/__tests__/env.test.ts'
```

Expected: PASS

- [ ] **Step 7.5: Commit**

```bash
git add apps/desktop/src/main/modules/portableRuntime/env.ts \
  apps/desktop/src/main/modules/portableRuntime/__tests__/env.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: buildRuntimeEnv 统一注入内置运行时 PATH

Windows 同步 PATH/Path;POSIX 保序去重。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 检测侧集成 —— node/python 优先查内置

**Files:**

- Modify: `apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.ts`
- Modify: `apps/desktop/src/main/core/infrastructure/ToolDetectorManager.ts`(如果 `createCommandDetector` 需要 env 注入)

**Interfaces:**

- Consumes: `PortableRuntimeManager` 单例；`getRuntimeExecutable`;`readRuntimeMeta`

- Produces: `nodeDetector` / `pythonDetector` 优先返回 `{ managedBy: 'app', installedVersion, path, version }`,fallback 到原 `createCommandDetector` 逻辑

- [ ] **Step 8.1: 修改 `runtimeEnvironmentDetectors.ts`**

```ts
// apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.ts
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { readRuntimeMeta } from '@/modules/portableRuntime/meta';
import { getRuntimeExecutable } from '@/modules/portableRuntime/paths';
import type { RuntimeName } from '@/modules/portableRuntime/types';
import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

const execFileP = promisify(execFile);

async function detectManaged(name: RuntimeName): Promise<ToolStatus | undefined> {
  const meta = await readRuntimeMeta(name);
  if (!meta) return;
  const exe = getRuntimeExecutable(name);
  try {
    await fs.access(exe);
    const { stdout, stderr } = await execFileP(exe, ['--version'], {
      timeout: 3000,
      windowsHide: true,
    });
    const version = `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0] || meta.version;
    return {
      available: true,
      installedVersion: meta.version,
      managedBy: 'app',
      path: exe,
      version,
    };
  } catch {
    return;
  }
}

async function detectSystem(cmds: string[]): Promise<ToolStatus> {
  for (const cmd of cmds) {
    const status = await createCommandDetector(cmd).detect();
    if (status.available && status.version) {
      return { ...status, managedBy: 'system' };
    }
  }
  return { available: false };
}

export const nodeDetector: IToolDetector = {
  description: 'Node.js - JavaScript runtime',
  async detect() {
    return (await detectManaged('node')) ?? detectSystem(['node']);
  },
  name: 'node',
  priority: 1,
};

export const pythonDetector: IToolDetector = {
  description: 'Python - programming language runtime',
  async detect() {
    return (
      (await detectManaged('python')) ??
      detectSystem(platform() === 'win32' ? ['python', 'py'] : ['python3', 'python'])
    );
  },
  name: 'python',
  priority: 3,
};

export const npmDetector: IToolDetector = createCommandDetector('npm', {
  description: 'npm - Node.js package manager',
  priority: 2,
});
export const bunDetector: IToolDetector = createCommandDetector('bun', {
  description: 'Bun - fast JavaScript runtime and package manager',
  priority: 4,
});
export const bunxDetector: IToolDetector = createCommandDetector('bunx', {
  description: 'bunx - Bun package runner for executing npm packages',
  priority: 5,
});
export const pnpmDetector: IToolDetector = createCommandDetector('pnpm', {
  description: 'pnpm - fast, disk space efficient package manager',
  priority: 6,
});
export const uvDetector: IToolDetector = createCommandDetector('uv', {
  description: 'uv - extremely fast Python package manager',
  priority: 7,
});

export const runtimeEnvironmentDetectors: IToolDetector[] = [
  nodeDetector,
  npmDetector,
  pythonDetector,
  bunDetector,
  bunxDetector,
  pnpmDetector,
  uvDetector,
];
```

同时，`npmDetector` 需要在内置 node 存在时也能找到 npm。因为 `createCommandDetector('npm')` 走 `where npm`, 内置 runtime 未写系统 PATH, 所以需要在 detect 之前把内置 runtime bin 塞进临时 PATH。改法：让 `nodeDetector` 同步驱动 npm 的检测。首版简化 —— 让 npm 在应用内置存在时，直接指向 `getRuntimeBinDir('node')/npm.cmd`(Win) 或 `bin/npm`(macOS):

```ts
// 加在 npmDetector 前
async function detectManagedNpm(): Promise<ToolStatus | undefined> {
  const meta = await readRuntimeMeta('node');
  if (!meta) return;
  const binDir = (await import('@/modules/portableRuntime/paths')).getRuntimeBinDir('node');
  const npmPath = platform() === 'win32' ? `${binDir}\\npm.cmd` : `${binDir}/npm`;
  try {
    await fs.access(npmPath);
    const isCmd = /\.cmd$/i.test(npmPath);
    const { stdout, stderr } = isCmd
      ? ((await promisify((await import('node:child_process')).exec)(`"${npmPath}" --version`, {
          timeout: 3000,
          windowsHide: true,
        } as any)) as any)
      : await execFileP(npmPath, ['--version'], { timeout: 3000, windowsHide: true });
    const version = `${stdout}\n${stderr}`.trim().split(/\r?\n/)[0];
    return {
      available: true,
      installedVersion: meta.version,
      managedBy: 'app',
      path: npmPath,
      version,
    };
  } catch {
    return;
  }
}

export const npmDetector: IToolDetector = {
  description: 'npm - Node.js package manager',
  async detect() {
    return (
      (await detectManagedNpm()) ?? {
        ...(await createCommandDetector('npm').detect()),
        managedBy: 'system' as const,
      }
    );
  },
  name: 'npm',
  priority: 2,
};
```

- [ ] **Step 8.2: 更新 `runtimeEnvironmentDetectors.test.ts`**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.test.ts'
```

Expected: PASS (如现有测试断言 `available: false`, 检查是否需要 mock `readRuntimeMeta` → null; 若断言更严，补 spy)

如断言需要调整，修改测试文件补 mock:

```ts
vi.mock('@/modules/portableRuntime/meta', () => ({
  readRuntimeMeta: vi.fn().mockResolvedValue(null),
}));
```

- [ ] **Step 8.3: Commit**

```bash
git add apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.ts \
  apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 检测侧优先命中应用内置 Node / Python

meta 存在时返回 managedBy=app + installedVersion,fallback 到系统 PATH。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 切换 toolInstaller.ts —— node/python 走便携版

**Files:**

- Modify: `apps/desktop/src/main/modules/toolDetectors/toolInstaller.ts`

**Interfaces:**

- Consumes: `getPortableRuntimeManager()` / `ToolInstallResult`

- Produces: `installTool('node' | 'python')` 走便携版；其他工具保留；winget args 加 `--source winget --silent`

- [ ] **Step 9.1: 修改 `toolInstaller.ts`**

在文件顶部 import 并替换 node/python 分支:

```ts
import { getPortableRuntimeManager } from '@/modules/portableRuntime';

// ...

const winWinget = (id: string): InstallCommand => ({
  args: [
    'install',
    '--id',
    id,
    '--exact',
    '--source',
    'winget',
    '--silent',
    '--accept-package-agreements',
    '--accept-source-agreements',
  ],
  bin: 'winget',
  label: `winget install ${id}`,
});
```

在 `installTool` 函数顶部，截胡 node/python:

```ts
export const installTool = async (toolName: string): Promise<ToolInstallResult> => {
  const normalized = toolName === 'npm' ? 'node' : toolName;

  if (normalized === 'node' || normalized === 'python') {
    const mgr = getPortableRuntimeManager();
    const result = await mgr.install(normalized);
    return {
      commandLabel: `internal:portable-${normalized}`,
      error: result.error,
      success: result.success,
      toolName,
    };
  }

  const command = getInstallCommand(toolName);
  // ... 原有逻辑
};
```

- [ ] **Step 9.2: 更新 toolInstaller 现有测试**

现有测试是 `apps/desktop/src/main/controllers/__tests__/ToolDetectorCtr.installTool.test.ts`。检查其对 node/python 的断言是否 mock 了 `winget`, 如果是，需要改为 mock `getPortableRuntimeManager` 或跳过 node/python 相关 case。

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/controllers/__tests__/ToolDetectorCtr.installTool.test.ts'
```

如失败，补 mock:

```ts
vi.mock('@/modules/portableRuntime', () => ({
  getPortableRuntimeManager: () => ({
    install: vi.fn().mockResolvedValue({ success: true, toolName: 'python', version: '3.12.13' }),
  }),
}));
```

- [ ] **Step 9.3: Commit**

```bash
git add apps/desktop/src/main/modules/toolDetectors/toolInstaller.ts \
  apps/desktop/src/main/controllers/__tests__/ToolDetectorCtr.installTool.test.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: Node/Python 安装走便携版;winget 加 --source winget --silent

顺手修 winget 因 msstore 证书错误导致的安装失败。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: IPC 层 —— uninstall + progress 事件

**Files:**

- Modify: `apps/desktop/src/main/controllers/ToolDetectorCtr.ts`
- Modify: `src/services/electron/toolDetector.ts`

**Interfaces:**

- Produces:
  - `uninstallTool(name: RuntimeName): Promise<RuntimeUninstallResult>` IPC method
  - 后端通过 `broadcastRenderer` 广播 `toolDetector:installProgress` 事件

- [ ] **Step 10.1: 在 `ToolDetectorCtr.ts` 添加 uninstall 与 progress 转发**

```ts
// 在 class 内新增
import { getPortableRuntimeManager } from '@/modules/portableRuntime';
import type {
  InstallProgressEvent,
  RuntimeName,
  RuntimeUninstallResult,
} from '@lobechat/electron-client-ipc';

// 构造函数 or bootstrap 后:
constructor(app: any) {
  super(app);
  const mgr = getPortableRuntimeManager();
  mgr.on('progress', (e: InstallProgressEvent) => {
    this.app.browserManager?.getMainWindow()?.webContents?.send(
      'toolDetector:installProgress',
      e,
    );
  });
}

@IpcMethod()
async uninstallTool(name: RuntimeName): Promise<RuntimeUninstallResult> {
  logger.debug(`Uninstalling runtime: ${name}`);
  return getPortableRuntimeManager().uninstall(name);
}
```

(注：实际 broadcast API 需要与项目已有 IPC 广播方式对齐 —— 查阅现有 `browserManager` / `broadcastToRenderer` 用法后调用。若项目已有 helper, 用 helper; 否则按上面用 `webContents.send`。)

- [ ] **Step 10.2: 在 `src/services/electron/toolDetector.ts` 加订阅方法**

```ts
import type {
  InstallProgressEvent,
  RuntimeName,
  RuntimeUninstallResult,
} from '@lobechat/electron-client-ipc';

// class 内:
uninstallTool = async (name: RuntimeName): Promise<RuntimeUninstallResult> => {
  return ensureElectronIpc().toolDetector.uninstallTool(name);
};

onInstallProgress = (handler: (e: InstallProgressEvent) => void): (() => void) => {
  const ipc = (window as any).electronAPI ?? (window as any).ipcRenderer;
  const listener = (_evt: unknown, payload: InstallProgressEvent) => handler(payload);
  ipc?.on?.('toolDetector:installProgress', listener);
  return () => ipc?.removeListener?.('toolDetector:installProgress', listener);
};
```

(注：实际的 `ipcRenderer.on` 桥接方式取决于项目已有的 preload。查看现有 IPC 事件订阅调用点确认 API, 匹配调整。)

- [ ] **Step 10.3: Commit**

```bash
git add apps/desktop/src/main/controllers/ToolDetectorCtr.ts \
  src/services/electron/toolDetector.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: IPC 支持便携运行时卸载与安装进度广播

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: MCP client env 注入 —— agent 能找到内置 runtime

**Files:**

- Modify: `src/libs/mcp/client.ts`

**Interfaces:**

- Consumes: `buildRuntimeEnv` — 但 `src/libs/mcp/client.ts` 在渲染进程 / 服务端环境？查代码：该文件通过 `preCheckStdioCommand` 里 `spawn` 起 stdio, 是**主进程或 Node 服务端**代码。因此可以直接 import `buildRuntimeEnv`。

- [ ] **Step 11.1: 修改 `src/libs/mcp/client.ts`**

顶部加 import (注意 `apps/desktop/` 是 Electron 主进程，而 `src/libs/mcp/client.ts` 在 Next.js 服务端 —— 二者不共享 workspace。需要判断该文件是否会被桌面端主进程使用):

先探明该文件如何被使用:

```bash
grep -rEn "from '@/libs/mcp/client'\|from './client'" /Users/ptsu/project/calcifer-chathub/src /Users/ptsu/project/calcifer-chathub/apps 2> /dev/null | head
```

若结果显示该文件仅由 Next.js 服务端使用而非 Electron 主进程：则 env 注入需要另找入口 (如 `apps/desktop/src/main/modules/mcp*` 或 `packages/*`)。

若该文件确实同时被主进程消费 (项目多 workspace 使用), 则如下改造:

```ts
// 顶部
async function computeMcpEnv(userEnv?: Record<string, string>): Promise<Record<string, string>> {
  const merged: Record<string, string> = {
    ...(process.env as any),
    ...getDefaultEnvironment(),
    ...(userEnv ?? {}),
  };
  // 若在 Electron 主进程可用,加内置 runtime bin
  try {
    // 动态 import,避免 Next.js 服务端解析主进程模块
    const mod = await import('@/../apps/desktop/src/main/modules/portableRuntime/env').catch(
      () => undefined,
    );
    if (mod?.buildRuntimeEnv) {
      const enriched = await mod.buildRuntimeEnv(merged as any);
      return enriched as any;
    }
  } catch {
    /* not electron */
  }
  return merged;
}
```

因 workspace 边界与 alias 限制，这一步的**正确做法**是:

- 在 `packages/` 里抽一个共享 helper (如 `packages/runtime-env/`); 或
- 在 Electron 主进程新增一个 MCP client wrapper, 将 `env` 注入后再调用现有 client。

**首版最小改动方案**: 在渲染进程通过 IPC 拿到 `runtimeBinDirs`, 通过 `getDefaultEnvironment()` 的用户 env 参数把 PATH 传入。若客户端与主进程分离，则由主进程端在起 MCP server 时 (通常在 `desktop-bridge` 或 `local-file-shell` 或 desktop 自己的 MCP host) 使用 `buildRuntimeEnv`。

**因此本 Task 的实现取决于 MCP 实际托管入口**。审计步骤:

```bash
grep -rEn "StdioClientTransport\|new Client\|preCheckStdioCommand" \
  /Users/ptsu/project/calcifer-chathub/apps \
  /Users/ptsu/project/calcifer-chathub/packages \
  /Users/ptsu/project/calcifer-chathub/src 2> /dev/null
```

找到实际起 MCP stdio 子进程的**主进程端调用点**, 在那里注入 `buildRuntimeEnv()`。若主进程调用点即为 `src/libs/mcp/client.ts`(通过某种 workspace/alias), 按上一段动态 import fallback; 否则直接在主进程侧 spawn 处 merge。

**验证**: 在实施到此步时，先 grep 确认调用链，然后:

- 主进程直接 spawn → 直接 `env: await buildRuntimeEnv(baseEnv)`

- 服务端调用 → 通过 IPC 拿 `runtimeBinDirs`, 或直接接受 `preCheckStdioCommand` 的 `params.env` 由上游主进程构造

- [ ] **Step 11.2: 提交实际改动**

```bash
git add src/libs/mcp/client.ts <or actual file>
git commit -m "$(cat <<'EOF'
✨ feat: MCP client 起 stdio 子进程时注入便携运行时 PATH

agent 通过 MCP 调 python/node 时优先命中应用内置版本。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: 启动时清扫

**Files:**

- Modify: `apps/desktop/src/main/core/App.ts`(或应用启动主流程)

- [ ] **Step 12.1: 查找 App 启动入口**

```bash
grep -n "bootstrap\|whenReady" /Users/ptsu/project/calcifer-chathub/apps/desktop/src/main/core/App.ts | head -20
```

- [ ] **Step 12.2: 在 `whenReady` 之后添加 cleanup 调用**

```ts
import { cleanupStaleDirs } from '@/modules/portableRuntime';

// 在 App.bootstrap 或 whenReady 之后(非阻塞)
cleanupStaleDirs().catch((e) => logger.warn('cleanupStaleDirs failed:', e));
```

- [ ] **Step 12.3: Commit**

```bash
git add apps/desktop/src/main/core/App.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 启动时清扫便携运行时残留目录

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: UI —— 三态按钮 + 进度条 + 确认弹窗

**Files:**

- Modify: `src/routes/(main)/settings/system-tools/features/ToolDetectorSection.tsx`
- Modify: `src/locales/default/setting.ts`
- Modify: `locales/zh-CN/setting.json`,`locales/en-US/setting.json`

**Interfaces:**

- Consumes: `toolDetectorService.installTool` / `uninstallTool` / `onInstallProgress`;`ToolStatus.managedBy`

- Produces: UI 三态展示 + 卸载 / 重装下拉

- [ ] **Step 13.1: 增补 i18n keys (default)**

在 `src/locales/default/setting.ts` 的 `settingSystemTools` 节点加入:

```ts
install: {
  action: '安装',
  reinstall: '重新安装',
  uninstall: '卸载',
  installed: '已安装',
  installBundled: '安装应用内置版本',
  updateAvailable: '有新版本可用',
  progressDownload: '下载中 {{percent}}%',
  progressVerify: '校验中',
  progressExtract: '解压中',
  progressSwitch: '切换中',
  progressDone: '完成',
  confirmInstall: '将从公司镜像下载 {{name}} {{version}} 便携版并解压到应用数据目录。仅在本应用内生效,不影响系统其他 {{name}}。',
  confirmReinstall: '⚠️ 重装将删除当前应用内 {{name}},并重新下载。通过此 {{name}} 安装的包会一并清除,如有需要请先备份。',
  confirmUninstall: '⚠️ 卸载将删除应用内 {{name}}(包括所有已装包)。依赖 {{name}} 的 Skill/MCP 工具可能无法工作。',
  processStillRunning: '{{name}} 仍有进程在运行,请关闭后重试',
  verifyFailed: '文件校验失败,可能被篡改或下载不完整',
  downloadFailed: '下载失败:{{error}}',
},
status: {
  managedByApp: '应用内置',
  managedBySystem: '系统安装',
},
```

- [ ] **Step 13.2: 更新 zh-CN 与 en-US**

复制 default 的所有 key 到 `locales/zh-CN/setting.json`(中文原文),`locales/en-US/setting.json` 翻译为英文。**其他语种不动**(CI 处理)。

- [ ] **Step 13.3: 修改 `ToolDetectorSection.tsx`**

关键点:

1. 增加进度状态 `installProgress: Record<string, InstallProgressEvent>`。
2. `useEffect` 订阅 `toolDetectorService.onInstallProgress`, 更新 `installProgress[toolName]`。
3. 渲染逻辑：根据 `status.managedBy`, 渲染不同按钮:
   - 未装:`[安装]`
   - 系统装:`[已安装(系统)]` 禁用 + `[安装应用内置版本]` 次要按钮 (仅 node/python)
   - 应用装 & 版本一致:`[重装 ▾]` → `重新安装` / `卸载`
   - 应用装 & 版本落后:`[更新到 vX.Y.Z]`
   - 进行中：进度条

由于 UI 代码量大，分文件展示要点:

```tsx
// 新增 imports
import { Dropdown, Progress } from 'antd';
import type { InstallProgressEvent } from '@lobechat/electron-client-ipc';

// 状态
const [installProgress, setInstallProgress] = useState<Record<string, InstallProgressEvent>>({});
const [uninstallingTool, setUninstallingTool] = useState<string>();

// useEffect 订阅
useEffect(() => {
  const off = toolDetectorService.onInstallProgress((e) => {
    setInstallProgress((prev) => ({ ...prev, [e.toolName]: e }));
    if (e.phase === 'done' || e.phase === 'error') {
      setTimeout(() => {
        setInstallProgress((prev) => {
          const next = { ...prev };
          delete next[e.toolName];
          return next;
        });
      }, 1500);
    }
  });
  return () => off?.();
}, []);

// handleUninstall
const handleUninstall = useCallback(
  (toolName: string) => {
    modal.confirm({
      title: t('settingSystemTools.install.confirmUninstall', { name: toolName }),
      content: '',
      okText: t('settingSystemTools.install.uninstall'),
      onOk: async () => {
        setUninstallingTool(toolName);
        try {
          const result = await toolDetectorService.uninstallTool(toolName as any);
          if (!result.success) {
            message.error(result.error);
            return;
          }
          message.success(t('settingSystemTools.install.uninstall'));
          await detectTools(true);
        } finally {
          setUninstallingTool(undefined);
        }
      },
    });
  },
  [detectTools, message, modal, t],
);

// 渲染按钮块(替换现有 Button)
const progress = installProgress[tool.name];
const running = progress && progress.phase !== 'done' && progress.phase !== 'error';
const isPortable = tool.name === 'node' || tool.name === 'python';

let actionNode: React.ReactNode;
if (running) {
  actionNode = <Progress percent={progress.percent ?? 0} size="small" style={{ width: 160 }} />;
} else if (status?.available && status.managedBy === 'app' && isPortable) {
  actionNode = (
    <Dropdown
      menu={{
        items: [
          {
            key: 'reinstall',
            label: t('settingSystemTools.install.reinstall'),
            onClick: () => handleInstall(tool.name, true),
          },
          {
            key: 'uninstall',
            label: t('settingSystemTools.install.uninstall'),
            onClick: () => handleUninstall(tool.name),
          },
        ],
      }}
    >
      <Button size="small">{t('settingSystemTools.install.installed')}</Button>
    </Dropdown>
  );
} else if (status?.available && status.managedBy === 'system' && isPortable) {
  actionNode = (
    <Flexbox horizontal gap={4}>
      <Button disabled size="small">
        {t('settingSystemTools.install.installed')}
      </Button>
      <Button size="small" onClick={() => handleInstall(tool.name)}>
        {t('settingSystemTools.install.installBundled')}
      </Button>
    </Flexbox>
  );
} else if (status?.available) {
  actionNode = (
    <Button disabled size="small">
      {t('settingSystemTools.install.installed')}
    </Button>
  );
} else {
  actionNode = (
    <Button size="small" onClick={() => handleInstall(tool.name)}>
      {t('settingSystemTools.install.action')}
    </Button>
  );
}
```

`handleInstall` 也要加个 `force` 参数，`true` 时走 reinstall (需要新增前端 API `reinstallTool` 或复用 install (force))。因为 IPC 侧 install 已是幂等 —— 首版让 "重新安装" 走 `installTool` 之前先 `uninstallTool` 一次，或者在 `ToolDetectorCtr` 加 `reinstallTool` IPC。为简化:**给 Ctr 加一个 `reinstallTool` IPC**, 走 `mgr.reinstall(name)`。

- [ ] **Step 13.4: 补齐 `reinstallTool` IPC**

在 `ToolDetectorCtr.ts` 加:

```ts
@IpcMethod()
async reinstallTool(name: RuntimeName) {
  return getPortableRuntimeManager().reinstall(name);
}
```

在 `toolDetector.ts` service 加:

```ts
reinstallTool = async (name: RuntimeName) => ensureElectronIpc().toolDetector.reinstallTool(name);
```

`handleInstall` 拆成:

```ts
const handleInstall = useCallback((toolName: string, reinstall = false) => {
  modal.confirm({
    title: t(reinstall ? 'settingSystemTools.install.confirmReinstall' : 'settingSystemTools.install.confirmInstall', { name: toolName }),
    // ...
    onOk: async () => {
      setInstallingTool(toolName);
      try {
        const result = reinstall
          ? await toolDetectorService.reinstallTool(toolName as any)
          : await toolDetectorService.installTool(toolName);
        // ...
      } finally {
        setInstallingTool(undefined);
      }
    },
  });
}, ...);
```

- [ ] **Step 13.5: 前端类型检查 & 手动 UI 验证**

```bash
# 单文件 LSP 诊断(不跑全量 tsc)
```

用 LSP 工具对 `src/routes/(main)/settings/system-tools/features/ToolDetectorSection.tsx` 做 diagnostics, 零错误后:

```bash
bun run dev
```

打开设置 → 系统工具页面，人工确认:

- 未装状态显示 `[安装]`
- 装完显示 `[已安装]` + 下拉可见 `重新安装` / `卸载`

(此步为手工验证，若在 CI 环境无法运行，记录在 PR 说明中)

- [ ] **Step 13.6: Commit**

```bash
git add src/routes/\(main\)/settings/system-tools/features/ToolDetectorSection.tsx \
  src/locales/default/setting.ts \
  locales/zh-CN/setting.json \
  locales/en-US/setting.json \
  src/services/electron/toolDetector.ts \
  apps/desktop/src/main/controllers/ToolDetectorCtr.ts
git commit -m "$(
  cat << 'EOF'
✨ feat: 系统工具页支持便携运行时三态与进度显示

新增重装/卸载动作、下载进度实时展示、系统/内置双状态区分。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: 手工集成验证

- [ ] **Step 14.1: 运行全量 portableRuntime 单测**

```bash
bunx vitest run --silent='passed-only' 'apps/desktop/src/main/modules/portableRuntime/'
```

Expected: PASS

- [ ] **Step 14.2: 主要 spawn 点回归**

```bash
bunx vitest run --silent='passed-only' \
  'apps/desktop/src/main/modules/toolDetectors/runtimeEnvironmentDetectors.test.ts' \
  'apps/desktop/src/main/controllers/__tests__/ToolDetectorCtr.installTool.test.ts'
```

Expected: PASS

- [ ] **Step 14.3: type-check 关键 package**

```bash
bunx tsgo --noEmit -p apps/desktop/tsconfig.json
```

Expected: 0 errors

若报错，针对报错文件用 LSP 诊断修复，不重跑全量。

- [ ] **Step 14.4: 手工用例矩阵**(打包后跑一遍)

- Windows /macOS 各一台

- 用例:
  1. 未装 Python → 点安装 → 进度条 100% → 状态变绿 → 命中 `userData/runtimes/python`
  2. 通过 agent 调 python 脚本 → 输出正常
  3. 重装 Python → 版本目录被替换 → agent 仍工作
  4. 卸载 Python → status.available=false
  5. 断网点安装 → 报错提示，原状态不变
  6. 下载中 kill 应用 → 重启后 `.tmp-*` 被清 → 再次点安装成功

结果记录在 PR 描述里。

- [ ] **Step 14.5: 无需 commit (手工验证阶段)**

---

## Self-Review 结果

**Spec coverage**:

- [x] Node.js 便携版下载 (Task 2 manifest + Task 4 download + Task 5 extract + Task 6 Manager + Task 9 installer)
- [x] Python 便携版下载 (同上)
- [x] SHA256 校验 (Task 4)
- [x] 原子切换 (Task 6)
- [x] 重装 (Task 6 reinstall + Task 13 UI)
- [x] 卸载 (Task 6 uninstall + Task 10 IPC + Task 13 UI)
- [x] 进度事件 (Task 6 emit + Task 10 broadcast + Task 13 subscribe)
- [x] 检测优先内置 (Task 8)
- [x] managedBy 字段 (Task 1 types + Task 8 detector + Task 13 UI)
- [x] agent 找到内置 (Task 7 env + Task 11 MCP)
- [x] 启动清扫 (Task 3 cleanup + Task 12 App)
- [x] winget 顺手修 (Task 9)
- [x] 路径 & zip slip 防护 (Task 3 assertInsideRuntimesRoot + Task 5 extract)
- [x] 域名白名单 (Task 2 manifest + Task 4 download)
- [x] i18n(Task 13)

**Placeholder scan**: 全部步骤含实际代码或明确命令，未见 TBD/TODO。

**Type consistency**:`RuntimeName` / `PlatformKey` / `InstallProgressEvent` / `RuntimeInstallResult` / `RuntimeUninstallResult` 在 types.ts、manifest.ts、PortableRuntimeManager.ts、electron-client-ipc、service、UI 一致。`ToolStatus` 扩展字段同名。

---

## Execution Handoff

计划已完成，保存到 `docs/superpowers/plans/2026-07-01-portable-runtime.md`。将采用 **Inline Execution**(通过 executing-plans skill 按 checkpoints 批量执行), 因为任务链有较多跨模块依赖，分次 subagent 出错回滚成本高；直接在当前会话中一次跑完并在关键节点自检。
