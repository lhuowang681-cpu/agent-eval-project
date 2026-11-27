import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/utils/logger';

import { downloadWithSha256, fetchNodeSha256 } from './download';
import { refreshProcessEnvPath } from './env';
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

/**
 * Windows 上 rename 目录经常受防病毒/资源管理器扫描/文件句柄短暂占用影响返回 EPERM,
 * 短暂重试通常能穿过这个窗口。Mac 上 rename 一般一次成功,重试也几乎无副作用。
 */
async function renameWithRetry(from: string, to: string, attempts = 8): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      lastErr = e;
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES' && code !== 'ENOTEMPTY') {
        throw e;
      }
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw lastErr;
}

export class PortableRuntimeManager extends EventEmitter {
  private inflight = new Map<RuntimeName, Promise<RuntimeInstallResult>>();
  private inflightUninstall = new Map<RuntimeName, Promise<RuntimeUninstallResult>>();

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

  install(name: RuntimeName, opts: { force?: boolean } = {}): Promise<RuntimeInstallResult> {
    const existing = this.inflight.get(name);
    if (existing) return existing;
    const p = this.doInstall(name, opts).finally(() => {
      this.inflight.delete(name);
    });
    this.inflight.set(name, p);
    return p;
  }

  private async doInstall(
    name: RuntimeName,
    opts: { force?: boolean } = {},
  ): Promise<RuntimeInstallResult> {
    const tmpDir = getTempRuntimeDir(name);
    const newDir = getNewRuntimeDir(name);

    try {
      const { entry, platform } = resolveRuntime(name);
      assertAllowedHost(platform.url);
      if (entry.shasumsUrl) assertAllowedHost(entry.shasumsUrl);

      const existing = await readRuntimeMeta(name);
      if (!opts.force && existing && existing.version === entry.version) {
        // Already installed; ensure current process env picks it up in case a
        // prior session installed it but the bootstrap-time refresh missed it
        // (e.g. install happened after bootstrap in the previous session and
        // this session started before we call refreshProcessEnvPath below).
        refreshProcessEnvPath();
        return {
          skipped: true,
          success: true,
          toolName: name,
          version: entry.version,
        };
      }

      await fs.mkdir(getRuntimesRoot(), { recursive: true });
      assertInsideRuntimesRoot(tmpDir);
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.mkdir(tmpDir, { recursive: true });

      const archiveDefaultName =
        platform.archiveName ?? path.basename(new URL(platform.url).pathname) ?? `${name}-archive`;
      const archivePath = path.join(tmpDir, archiveDefaultName);

      const expectedSha =
        platform.sha256 ||
        (entry.shasumsUrl && platform.archiveName
          ? await fetchNodeSha256(entry.shasumsUrl, platform.archiveName)
          : undefined);
      if (!expectedSha) {
        throw new Error(
          `Missing sha256 for ${name} on ${getPlatformKey()}. Update manifest.ts with the sha256 emitted by the download-mirror-packages script.`,
        );
      }

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

      assertInsideRuntimesRoot(newDir);
      await fs.rm(newDir, { recursive: true, force: true });
      await fs.mkdir(newDir, { recursive: true });

      this.emitProgress({ phase: 'extract', toolName: name });
      const executableName =
        process.platform === 'win32' ? entry.executable.win32 : entry.executable.darwin;
      await extractArchive(
        archivePath,
        newDir,
        platform.format,
        platform.rootPrefix,
        executableName,
      );

      const meta: RuntimeMetaFile = {
        downloadedAt: new Date().toISOString(),
        platformKey: getPlatformKey(),
        sha256: expectedSha,
        sourceUrl: platform.url,
        version: entry.version,
      };
      await writeRuntimeMeta(newDir, meta);

      // 便携 node 装完写一份默认 npmrc,让内置 npm 走淘宝源加速。
      // Mac/Linux: npm globalconfig 默认查 <prefix>/etc/npmrc(prefix = node 目录父级,
      // 但 tar 布局里就是 bin/ 平级的 etc/)。
      // Windows: 无 etc/ 概念,npm 会查 <node.exe 同级>/node_modules/npm/npmrc。
      if (name === 'node') {
        try {
          const npmrcContent = 'registry=https://registry.npmmirror.com/\n';
          if (process.platform === 'win32') {
            const npmrcPath = path.join(newDir, 'node_modules', 'npm', 'npmrc');
            await fs.mkdir(path.dirname(npmrcPath), { recursive: true });
            await fs.writeFile(npmrcPath, npmrcContent, 'utf8');
          } else {
            const etcDir = path.join(newDir, 'etc');
            await fs.mkdir(etcDir, { recursive: true });
            await fs.writeFile(path.join(etcDir, 'npmrc'), npmrcContent, 'utf8');
          }
        } catch (e) {
          logger.warn('write portable node npmrc failed (non-fatal):', e);
        }
      }

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

      let hadOldTarget = false;
      try {
        await fs.access(targetDir);
        hadOldTarget = true;
        await renameWithRetry(targetDir, oldDir);
      } catch {
        /* target doesn't exist yet, that's fine */
      }

      try {
        await renameWithRetry(newDir, targetDir);
      } catch (e) {
        if (hadOldTarget) {
          try {
            await renameWithRetry(oldDir, targetDir);
          } catch (rollbackErr) {
            logger.error('rollback failed:', rollbackErr);
          }
        }
        throw e;
      }

      fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);

      // Rebuild process.env.PATH so subsequent spawn() calls (execScript,
      // runCommand, MCP stdio, execa) resolve node/python without waiting for
      // an app restart. Only runs after the atomic rename succeeds.
      refreshProcessEnvPath();

      this.emitProgress({ phase: 'done', toolName: name });

      return { success: true, toolName: name, version: entry.version };
    } catch (error) {
      const message = (error as Error).message || String(error);
      logger.error(`install ${name} failed:`, error);
      this.emitProgress({ error: message, phase: 'error', toolName: name });
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      fs.rm(newDir, { recursive: true, force: true }).catch(() => undefined);
      return { error: message, success: false, toolName: name };
    }
  }

  async reinstall(name: RuntimeName): Promise<RuntimeInstallResult> {
    return this.install(name, { force: true });
  }

  uninstall(name: RuntimeName): Promise<RuntimeUninstallResult> {
    const existing = this.inflightUninstall.get(name);
    if (existing) return existing;
    const p = this.doUninstall(name).finally(() => {
      this.inflightUninstall.delete(name);
    });
    this.inflightUninstall.set(name, p);
    return p;
  }

  private async doUninstall(name: RuntimeName): Promise<RuntimeUninstallResult> {
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
      await renameWithRetry(dir, oldDir);
      fs.rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
      // Drop the now-gone bin dir from process.env.PATH so future spawns don't
      // hand out dangling references.
      refreshProcessEnvPath();
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
