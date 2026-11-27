import fs from 'node:fs/promises';
import path from 'node:path';

import type { ExecutionSnapshot, SnapshotSummary } from '../types';
import type { ISnapshotStore } from './types';

const DEFAULT_DIR = '.agent-tracing';
const PARTIAL_DIR = '_partial';

export class FileSnapshotStore implements ISnapshotStore {
  private dir: string;

  constructor(rootDir?: string) {
    this.dir = path.resolve(rootDir ?? process.cwd(), DEFAULT_DIR);
  }

  // ==================== Completed snapshots ====================

  async save(snapshot: ExecutionSnapshot): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });

    const ts = new Date(snapshot.startedAt).toISOString().replaceAll(':', '-');
    const shortId = snapshot.traceId.slice(0, 12);
    const filename = `${ts}_${shortId}.json`;
    const filePath = path.join(this.dir, filename);

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');

    // Update `latest.json` to point at the freshest snapshot.
    //
    // 优先用符号链接（省一份磁盘拷贝），但**必须能回落到复制**：
    // Windows 上非提权进程创建符号链接会 EPERM（需开发者模式或管理员），
    // 于是 `latest.json` 从来就没被创建过 —— 分步快照照常落盘，但
    // `agent-tracing inspect` 的「看最新一条」永远失效，
    // 而调用方只在日志里看到一句 `snapshot finalization failed`。
    // 同样的写法在 `packages/llm-generation-tracing` 里直接导致单测失败。
    const latestPath = path.join(this.dir, 'latest.json');
    try {
      await fs.unlink(latestPath);
    } catch {
      // ignore if doesn't exist
    }

    try {
      await fs.symlink(filename, latestPath);
    } catch {
      // 回落到复制：语义一致（latest.json 就是最新快照的内容），
      // 代价只是多一份磁盘拷贝。
      await fs.copyFile(filePath, latestPath);
    }
  }

  async get(traceId: string): Promise<ExecutionSnapshot | null> {
    if (traceId === 'latest') return this.getLatest();

    // Search completed snapshots first
    const files = await this.listFiles();
    const match = files.find((f) => f.includes(traceId.slice(0, 12)));
    if (match) {
      const content = await fs.readFile(path.join(this.dir, match), 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    }

    // Fallback to partials
    const partial = await this.getPartial(traceId);
    if (partial) return partialToSnapshot(partial);

    return null;
  }

  async list(options?: { limit?: number }): Promise<SnapshotSummary[]> {
    const files = await this.listFiles();
    const limit = options?.limit ?? 10;
    const recent = files.slice(0, limit);

    const summaries: SnapshotSummary[] = [];

    for (const file of recent) {
      try {
        const content = await fs.readFile(path.join(this.dir, file), 'utf8');
        const snapshot = JSON.parse(content) as ExecutionSnapshot;
        summaries.push(toSummary(snapshot));
      } catch {
        // skip corrupted files
      }
    }

    return summaries;
  }

  async getLatest(): Promise<ExecutionSnapshot | null> {
    const latestPath = path.join(this.dir, 'latest.json');
    try {
      const realPath = await fs.realpath(latestPath);
      const content = await fs.readFile(realPath, 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    } catch {
      // No latest symlink — fall back to most recent by filename
      const files = await this.listFiles();
      if (files.length === 0) return null;

      const content = await fs.readFile(path.join(this.dir, files[0]), 'utf8');
      return JSON.parse(content) as ExecutionSnapshot;
    }
  }

  // ==================== Partial snapshots ====================

  private partialDir(): string {
    return path.join(this.dir, PARTIAL_DIR);
  }

  private partialPath(operationId: string): string {
    const safe = operationId.replaceAll('/', '_');
    return path.join(this.partialDir(), `${safe}.json`);
  }

  async listPartials(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.partialDir());
      return entries
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  async getPartial(idOrFilename: string): Promise<Partial<ExecutionSnapshot> | null> {
    // Try exact filename first
    try {
      const filePath = idOrFilename.endsWith('.json')
        ? path.join(this.partialDir(), idOrFilename)
        : this.partialPath(idOrFilename);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      // Fall back to substring match
      const files = await this.listPartials();
      const match = files.find((f) => f.includes(idOrFilename));
      if (!match) return null;
      const content = await fs.readFile(path.join(this.partialDir(), match), 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    }
  }

  async loadPartial(operationId: string): Promise<Partial<ExecutionSnapshot> | null> {
    try {
      const content = await fs.readFile(this.partialPath(operationId), 'utf8');
      return JSON.parse(content) as Partial<ExecutionSnapshot>;
    } catch {
      return null;
    }
  }

  async savePartial(operationId: string, partial: Partial<ExecutionSnapshot>): Promise<void> {
    await fs.mkdir(this.partialDir(), { recursive: true });
    await fs.writeFile(this.partialPath(operationId), JSON.stringify(partial), 'utf8');
  }

  async removePartial(operationId: string): Promise<void> {
    try {
      await fs.unlink(this.partialPath(operationId));
    } catch {
      // ignore
    }
  }

  // ==================== Internal ====================

  private async listFiles(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dir);
      return entries
        .filter((f) => f.endsWith('.json') && f !== 'latest.json')
        .sort()
        .reverse(); // newest first (ISO timestamp prefix)
    } catch {
      return [];
    }
  }
}

function partialToSnapshot(partial: Partial<ExecutionSnapshot>): ExecutionSnapshot {
  return {
    completedAt: undefined,
    completionReason: undefined,
    error: undefined,
    model: partial.model,
    operationId: partial.operationId ?? '?',
    provider: partial.provider,
    startedAt: partial.startedAt ?? Date.now(),
    steps: partial.steps ?? [],
    totalCost: partial.totalCost ?? 0,
    totalSteps: partial.steps?.length ?? 0,
    totalTokens: partial.totalTokens ?? 0,
    traceId: partial.traceId ?? '?',
    ...partial,
  } as ExecutionSnapshot;
}

function toSummary(snapshot: ExecutionSnapshot): SnapshotSummary {
  return {
    completionReason: snapshot.completionReason,
    createdAt: snapshot.startedAt,
    durationMs: (snapshot.completedAt ?? Date.now()) - snapshot.startedAt,
    hasError: !!snapshot.error,
    model: snapshot.model,
    operationId: snapshot.operationId,
    totalSteps: snapshot.totalSteps,
    totalTokens: snapshot.totalTokens,
    traceId: snapshot.traceId,
  };
}
