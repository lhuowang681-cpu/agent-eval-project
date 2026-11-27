/**
 * SandboxToolClient
 * 基于 @ctrip/opensandbox SDK 的 Agent 工具封装
 *
 * @alibaba-group/opensandbox 有bug，暂时使用 @ctrip/opensandbox 替代
 *
 * 功能：
 *  1. 沙箱生命周期管理（创建/复用/销毁）
 *  2. 从 S3 拉取文件并注入沙箱
 *  3. 执行 Python / Shell / Node.js 代码
 *  4. 读取执行结果并返回结构化输出
 *  5. 暴露标准 Agent Tool 定义（OpenAI / Anthropic 格式）
 */

import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ConnectionConfig,
  type ExecutionHandlers,
  Sandbox,
  SandboxException,
  SandboxManager,
} from '@ctrip/opensandbox';
import { nanoid } from 'nanoid';

import { fileEnv } from '@/envs/file';

// ─── 类型定义 ─────────────────────────────────────────────────

export interface SandboxCreateOptions {
  entrypoint?: string[];
  image?: string;
  resource?: {
    cpu?: string;
    memory?: string;
  };
  timeoutSeconds?: number;
}

export interface SandboxConnectionConfig {
  apiKey: string;
  debug: boolean;
  domain: string;
  headers: Record<string, string>;
  protocol: 'http' | 'https';
  requestTimeoutSeconds: number;
  useServerProxy: boolean;
}

export interface SandboxS3Config {
  bucket: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  endpoint?: string;
  forcePathStyle: boolean; // MinIO/OSS 需要
  region: string;
}

export interface SandboxHttpConfig {
  /**
   * 是否校验 HTTPS 证书，默认 true。
   * 内网自签证书环境（如 *.ctripcorp.com）可设为 false。
   */
  rejectUnauthorized?: boolean;
}

export type SupportedLanguage = 'python' | 'shell' | 'node';

export interface ExecuteCodeInput {
  /** 要执行的代码字符串 */
  code: string;
  language: SupportedLanguage;
  /** 执行前需要注入沙箱的 S3 文件列表 */
  s3Files?: Array<{
    bucket: string;
    key: string;
    /** 注入到沙箱中的目标路径，例如 "/workspace/data.csv" */
    sandboxPath: string;
  }>;
  /** 执行超时（毫秒），默认 60000 */
  timeoutMs?: number;
}

export interface ExecuteResult {
  error?: string;
  executionTimeMs: number;
  /** 执行后读取的文件内容（可选，由 readOutputFiles 指定） */
  outputFiles?: Record<string, string>;
  stderr: string;
  stdout: string;
  success: boolean;
}

export interface RunWithFilesInput extends ExecuteCodeInput {
  /** 执行完成后，从沙箱读取哪些文件作为输出（路径列表） */
  readOutputFiles?: string[];
}

/** S3 文件来源（结构化形式） */
export interface S3FileSource {
  /** 可选，默认使用 SandboxToolClient 初始化时的 bucket */
  bucket?: string;
  /** S3 Object Key */
  key: string;
}

/** runCommand 注入文件的 source/destination 定义 */
export interface RunCommandFileInput {
  /** 沙箱内目标路径，如 `/workspace/data.csv` */
  destination: string;
  /**
   * 文件来源，支持：
   * - 预签名 / HTTP(S) URL：`'https://.../file.md?X-Amz-...'`
   * - S3 URI：`'s3://bucket/path/to/file.md'`
   * - 仅 Key 字符串：`'path/to/file.md'`（使用 client 默认 bucket）
   * - 结构化：`{ key: 'path/to/file.md', bucket?: 'my-bucket' }`
   */
  source: string | S3FileSource;
}

/** 后台命令任务记录（按 session 存储） */
export interface BackgroundJobRecord {
  commandId: string;
  lastStdoutOffset: number;
  pidPath: string;
  running: boolean;
  stderrPath: string;
  stdoutPath: string;
}

/** runCommand 的可选参数 */
export interface RunCommandOptions {
  /** 后台执行：立即返回 commandId，通过 getCommandOutput 拉取输出 */
  background?: boolean;
  /** 环境变量 */
  envs?: Record<string, string>;
  /** 执行前注入沙箱的文件列表 */
  files?: RunCommandFileInput[];
  /** 会话 ID，同一 sessionId 在 timeoutSeconds 内复用沙箱，idle 超时后自动释放 */
  sessionId: string;
  /** 命令执行超时（毫秒） */
  timeoutMs?: number;
  /** 工作目录 */
  workingDirectory?: string;
}

export interface RunCommandResult {
  /** 后台命令 ID（background=true 时返回） */
  commandId?: string;
  error?: string;
  executionTimeMs: number;
  exitCode?: number;
  /** 是否复用了已有沙箱（false 表示新建或 session 已过期后重建） */
  sessionReused: boolean;
  stderr: string;
  stdout: string;
  success: boolean;
}

/** session 内已注入沙箱的文件记录 */
export interface SessionInjectedFile {
  destination: string;
  injectedAt: number;
  sizeBytes: number;
  source: string | S3FileSource;
  /** 便于展示的来源描述 */
  sourceLabel: string;
}

/** session 最近一次命令执行记录 */
export interface SessionLastCommand {
  command: string;
  executedAt: number;
  executionTimeMs: number;
  exitCode?: number;
  success: boolean;
}

export type SessionSandboxState = 'active' | 'expired' | 'not_found';

/** getSessionStatus 返回结构 */
export interface SessionSandboxStatus {
  /** 沙箱创建时间（仅 active） */
  createdAt?: number;
  /** 距离 idle 超时自动释放的剩余毫秒（仅 active） */
  idleRemainingMs?: number;
  injectedFiles: SessionInjectedFile[];
  /** 上次访问时间（仅 active） */
  lastAccessAt?: number;
  lastCommand?: SessionLastCommand;
  sandbox?: {
    id: string;
    healthy: boolean;
    lifecycleState?: string;
    expiresAt?: string | null;
    metrics?: {
      cpuUsedPercentage: number;
      memoryUsedMiB: number;
      memoryTotalMiB: number;
    };
  };
  sessionId: string;
  state: SessionSandboxState;
}

interface InjectedFileRecord {
  destination: string;
  injectedAt: number;
  sizeBytes: number;
  source: string | S3FileSource;
}

interface LastCommandRecord {
  command: string;
  executedAt: number;
  executionTimeMs: number;
  exitCode?: number;
  success: boolean;
}

interface SandboxSessionEntry {
  backgroundJobs?: Map<string, BackgroundJobRecord>;
  createdAt: number;
  injectedFiles: InjectedFileRecord[];
  lastAccessAt: number;
  lastCommand?: LastCommandRecord;
  releaseTimer?: ReturnType<typeof setTimeout>;
  sandbox: Sandbox;
}

const REUSABLE_SANDBOX_STATES = ['Running', 'Creating', 'Allocated', 'Paused', 'Resuming'];

const defaultCreateOptions: SandboxCreateOptions = {
  image: 'agentark/sandbox-code-interpreter:v1.0.1',
  resource: { cpu: '1', memory: '2Gi' },
  entrypoint: ['/opt/opensandbox/code-interpreter.sh', '>', '/tmp/code-interpreter.log', '2>&1'],
  timeoutSeconds: 10 * 60,
};

const defaultConnectionConfig: SandboxConnectionConfig = {
  domain: process.env.SANDBOX_DOMAIN || 'localhost',
  apiKey: process.env.SANDBOX_API_KEY || '',
  protocol: (process.env.SANDBOX_PROTOCOL as 'http' | 'https') || 'http',
  headers: process.env.SANDBOX_API_KEY ? { 'SANDBOX-API-KEY': process.env.SANDBOX_API_KEY } : {},
  requestTimeoutSeconds: 60,
  debug: false,
  useServerProxy: false,
};

// ─── 核心封装类 ───────────────────────────────────────────────

export class SandboxToolClient {
  private createOptions: SandboxCreateOptions;
  private connectionConfig: ConnectionConfig;
  private s3Client?: S3Client;
  private s3Bucket?: string;
  private httpRejectUnauthorized = true;

  /** 当前活跃的沙箱实例（可复用，供 executeCode 等使用） */
  private activeSandbox?: Sandbox;

  /** sessionId -> 沙箱会话，跨实例共享以实现 runCommand 复用 */
  private static sessions = new Map<string, SandboxSessionEntry>();

  constructor(
    createOptions: SandboxCreateOptions = {},
    connectionConfig: Partial<SandboxConnectionConfig> = {},
    s3Config?: SandboxS3Config,
    httpConfig?: SandboxHttpConfig,
  ) {
    this.createOptions = { ...defaultCreateOptions, ...createOptions };

    this.connectionConfig = new ConnectionConfig({
      ...defaultConnectionConfig,
      ...connectionConfig,
    });

    if (s3Config) {
      this.s3Client = new S3Client(s3Config);
      this.s3Bucket = s3Config.bucket;
    }

    if (httpConfig?.rejectUnauthorized !== undefined) {
      this.httpRejectUnauthorized = httpConfig.rejectUnauthorized;
    }
  }

  /** session idle TTL，与 createOptions.timeoutSeconds 保持一致 */
  private getSessionTtlMs(): number {
    return this.getTimeoutSeconds() * 1000;
  }

  private getTimeoutSeconds(): number {
    return this.createOptions.timeoutSeconds ?? defaultCreateOptions.timeoutSeconds!;
  }

  private isServerExpired(expiresAt: Date | string | null | undefined, now: number): boolean {
    if (!expiresAt) return false;

    const expiresAtMs =
      expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs <= now;
  }

  /**
   * 刷新 session 的 idle 计时，并向 OpenSandbox 服务端续期（expiresAt = now + timeoutSeconds）。
   * 续期失败不阻断后续沙箱操作。
   */
  private async touchActiveSession(sessionId: string, entry: SandboxSessionEntry): Promise<void> {
    const now = Date.now();
    const sessionTtlMs = this.getSessionTtlMs();

    try {
      await entry.sandbox.renew(this.getTimeoutSeconds());
    } catch {
      // 服务端续期失败时仍允许复用，可能由平台自动续期或沙箱即将回收
    }

    entry.lastAccessAt = now;
    SandboxToolClient.scheduleSessionRelease(sessionId, entry, sessionTtlMs);
  }

  /**
   * 若 topic/session 对应沙箱仍存在且未过期，则向 OpenSandbox 续期。
   * 用于用户继续聊天但尚未触发沙箱工具的场景。
   */
  async renewSessionIfActive(sessionId: string): Promise<boolean> {
    const now = Date.now();
    const sessionTtlMs = this.getSessionTtlMs();
    const cached = SandboxToolClient.sessions.get(sessionId);

    if (cached && now - cached.lastAccessAt >= sessionTtlMs) {
      return false;
    }

    if (cached) {
      try {
        const info = await cached.sandbox.getInfo();
        if (this.isServerExpired(info.expiresAt, now)) {
          return false;
        }
      } catch {
        return false;
      }

      await this.touchActiveSession(sessionId, cached);
      return true;
    }

    try {
      const manager = SandboxManager.create({ connectionConfig: this.connectionConfig });
      const { items } = await manager.listSandboxInfos({
        states: REUSABLE_SANDBOX_STATES,
        metadata: { sessionId },
      });

      if (!items.length) {
        return false;
      }

      const sandboxInfo = items[0];
      if (this.isServerExpired(sandboxInfo.expiresAt, now)) {
        return false;
      }

      const sandbox = await Sandbox.connect({
        connectionConfig: this.connectionConfig,
        sandboxId: sandboxInfo.id,
      });

      const entry: SandboxSessionEntry = {
        sandbox,
        createdAt: now,
        lastAccessAt: now,
        injectedFiles: [],
      };
      SandboxToolClient.sessions.set(sessionId, entry);
      await this.touchActiveSession(sessionId, entry);
      return true;
    } catch {
      return false;
    }
  }

  // ─── 沙箱生命周期 ──────────────────────────────────────────

  /**
   * 获取或创建沙箱实例
   * 复用策略：同一 SandboxToolClient 实例内复用沙箱，避免重复创建开销
   */
  async getSandbox(): Promise<Sandbox> {
    if (this.activeSandbox) {
      return this.activeSandbox;
    }
    const sandbox = await Sandbox.create({
      connectionConfig: this.connectionConfig,
      image: this.createOptions.image,
      timeoutSeconds: this.createOptions.timeoutSeconds,
      entrypoint: this.createOptions.entrypoint,
      resource: this.createOptions.resource,
    });
    this.activeSandbox = sandbox;
    return sandbox;
  }

  /** 强制创建一个全新的沙箱（用于隔离执行场景） */
  async createFreshSandbox(): Promise<Sandbox> {
    if (this.activeSandbox) {
      await this.destroySandbox();
    }
    return this.getSandbox();
  }

  /** 销毁当前沙箱，释放资源 */
  async destroySandbox(): Promise<void> {
    if (this.activeSandbox) {
      await this.activeSandbox.kill();
      this.activeSandbox = undefined;
    }
  }

  /** 手动释放指定 sessionId 的沙箱 */
  async releaseSession(sessionId: string): Promise<void> {
    const entry = SandboxToolClient.sessions.get(sessionId);
    if (entry) {
      await SandboxToolClient.releaseSessionEntry(sessionId, entry);
    }
  }

  /**
   * 查询 sessionId 对应沙箱的运行状态及已注入文件列表。
   * 若 session 不存在或已过期，state 分别为 not_found / expired。
   */
  async getSessionStatus(sessionId: string): Promise<SessionSandboxStatus> {
    const entry = SandboxToolClient.sessions.get(sessionId);
    if (!entry) {
      return {
        sessionId,
        state: 'not_found',
        injectedFiles: [],
      };
    }

    const now = Date.now();
    const sessionTtlMs = this.getSessionTtlMs();
    const idleRemainingMs = sessionTtlMs - (now - entry.lastAccessAt);
    if (idleRemainingMs <= 0) {
      return {
        sessionId,
        state: 'expired',
        createdAt: entry.createdAt,
        lastAccessAt: entry.lastAccessAt,
        injectedFiles: entry.injectedFiles.map(toSessionInjectedFile),
        lastCommand: entry.lastCommand,
      };
    }

    const base: SessionSandboxStatus = {
      sessionId,
      state: 'active',
      createdAt: entry.createdAt,
      lastAccessAt: entry.lastAccessAt,
      idleRemainingMs,
      injectedFiles: entry.injectedFiles.map(toSessionInjectedFile),
      lastCommand: entry.lastCommand,
    };

    try {
      const [healthy, info, metrics] = await Promise.all([
        entry.sandbox.isHealthy(),
        entry.sandbox.getInfo(),
        entry.sandbox.getMetrics().catch(() => undefined),
      ]);

      base.sandbox = {
        id: String(entry.sandbox.id),
        healthy,
        lifecycleState: info.status?.state,
        expiresAt: info.expiresAt?.toISOString() ?? null,
        ...(metrics && {
          metrics: {
            cpuUsedPercentage: metrics.cpuUsedPercentage,
            memoryUsedMiB: metrics.memoryUsedMiB,
            memoryTotalMiB: metrics.memoryTotalMiB,
          },
        }),
      };
    } catch {
      base.sandbox = {
        id: String(entry.sandbox.id),
        healthy: false,
      };
    }

    return base;
  }

  /**
   * 获取或创建 session 对应的沙箱。
   * 优先级：
   *  1. client-side Map 快速路径（未过期则直接复用）
   *  2. 服务端查询：通过 metadata.sessionId 找到仍在 Running 的沙箱则 connect 复用
   *  3. 创建新沙箱，携带 metadata: { sessionId } 以便服务端识别
   */
  private async acquireSessionSandbox(
    sessionId: string,
  ): Promise<{ sandbox: Sandbox; sessionReused: boolean }> {
    const now = Date.now();
    const sessionTtlMs = this.getSessionTtlMs();
    const existing = SandboxToolClient.sessions.get(sessionId);

    // 1. 客户端缓存命中（快速路径，无需 API 调用）
    if (existing && now - existing.lastAccessAt < sessionTtlMs) {
      await this.touchActiveSession(sessionId, existing);
      return { sandbox: existing.sandbox, sessionReused: true };
    }

    if (existing) {
      await SandboxToolClient.releaseSessionEntry(sessionId, existing);
    }

    // 2. 服务端查询：找到携带该 sessionId 且仍在 Running 的沙箱则复用
    try {
      const manager = SandboxManager.create({ connectionConfig: this.connectionConfig });
      const { items } = await manager.listSandboxInfos({
        states: REUSABLE_SANDBOX_STATES,
        metadata: { sessionId },
      });
      if (items.length > 0) {
        const sandbox = await Sandbox.connect({
          connectionConfig: this.connectionConfig,
          sandboxId: items[0].id,
        });
        const entry: SandboxSessionEntry = {
          sandbox,
          createdAt: now,
          lastAccessAt: now,
          injectedFiles: [],
        };
        SandboxToolClient.sessions.set(sessionId, entry);
        await this.touchActiveSession(sessionId, entry);
        return { sandbox, sessionReused: true };
      }
    } catch {
      // 服务端查询失败时降级到新建沙箱
    }

    // 3. 创建新沙箱，携带 metadata: { sessionId }
    const sandbox = await Sandbox.create({
      connectionConfig: this.connectionConfig,
      image: this.createOptions.image,
      timeoutSeconds: this.createOptions.timeoutSeconds,
      entrypoint: this.createOptions.entrypoint,
      resource: this.createOptions.resource,
      metadata: { sessionId },
    });

    const entry: SandboxSessionEntry = {
      sandbox,
      createdAt: now,
      lastAccessAt: now,
      injectedFiles: [],
    };
    SandboxToolClient.sessions.set(sessionId, entry);
    await this.touchActiveSession(sessionId, entry);

    return { sandbox, sessionReused: false };
  }

  private static scheduleSessionRelease(
    sessionId: string,
    entry: SandboxSessionEntry,
    sessionTtlMs: number,
  ): void {
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
    }

    entry.releaseTimer = setTimeout(() => {
      const current = SandboxToolClient.sessions.get(sessionId);
      if (current === entry && Date.now() - entry.lastAccessAt >= sessionTtlMs) {
        void SandboxToolClient.releaseSessionEntry(sessionId, entry);
      }
    }, sessionTtlMs);
  }

  private static async releaseSessionEntry(
    sessionId: string,
    entry: SandboxSessionEntry,
  ): Promise<void> {
    if (entry.releaseTimer) {
      clearTimeout(entry.releaseTimer);
    }
    SandboxToolClient.sessions.delete(sessionId);
    try {
      await entry.sandbox.kill();
    } catch {
      // 沙箱可能已被服务端回收，忽略释放错误
    }
  }

  // ─── 命令执行 ───────────────────────────────────────────────

  /**
   * 确保指定文件已注入 session 沙箱（跳过已注入的目标路径）
   */
  async ensureFilesInjected(
    sessionId: string,
    files: RunCommandFileInput[],
  ): Promise<{ injectedCount: number; sessionReused: boolean }> {
    if (!files.length) {
      return { injectedCount: 0, sessionReused: false };
    }

    const status = await this.getSessionStatus(sessionId);
    const existingDestinations = new Set(status.injectedFiles.map((file) => file.destination));
    const pending = files.filter((file) => !existingDestinations.has(file.destination));

    if (pending.length === 0) {
      return {
        injectedCount: 0,
        sessionReused: status.state === 'active',
      };
    }

    const { sandbox, sessionReused } = await this.acquireSessionSandbox(sessionId);
    const entry = SandboxToolClient.sessions.get(sessionId);

    await Promise.all(
      pending.map(async (file) => {
        const sizeBytes = await this.injectFileFromSource(sandbox, file.source, file.destination);
        if (entry) {
          this.recordInjectedFile(entry, file, sizeBytes);
        }
      }),
    );

    return { injectedCount: pending.length, sessionReused };
  }

  /**
   * 在沙箱中执行 shell 命令，可选注入远程文件后执行。
   * 通过 sessionId 管理沙箱：timeoutSeconds 内同 sessionId 复用，idle 超时自动释放。
   *
   * @example
   * await client.runCommand('cat /file', {
   *   sessionId: 'user-123',
   *   files: [{
   *     source: { key: 'example/文件.md' },
   *     destination: '/file',
   *   }],
   * })
   */
  async runCommand(command: string, options: RunCommandOptions): Promise<RunCommandResult> {
    const { sandbox, sessionReused } = await this.acquireSessionSandbox(options.sessionId);
    const stdout: string[] = [];
    const stderr: string[] = [];
    let executionTimeMs = 0;

    if (options.background) {
      return this.runBackgroundCommand(command, options);
    }

    if (options.files?.length) {
      const entry = SandboxToolClient.sessions.get(options.sessionId);
      const existingDestinations = new Set(
        entry?.injectedFiles.map((file) => file.destination) ??
          (await this.getSessionStatus(options.sessionId)).injectedFiles.map(
            (file) => file.destination,
          ),
      );
      const pending = options.files.filter((file) => !existingDestinations.has(file.destination));

      await Promise.all(
        pending.map(async (file) => {
          const sizeBytes = await this.injectFileFromSource(sandbox, file.source, file.destination);
          if (entry) {
            this.recordInjectedFile(entry, file, sizeBytes);
          }
        }),
      );
    }

    const handlers: ExecutionHandlers = {
      onStdout: (m) => {
        stdout.push(m.text);
      },
      onStderr: (m) => {
        stderr.push(m.text);
      },
      onExecutionComplete: (c) => {
        executionTimeMs = c.executionTimeMs;
      },
    };

    const runOpts = {
      ...(options.workingDirectory && {
        workingDirectory: options.workingDirectory,
      }),
      ...(options.envs && { envs: options.envs }),
      ...(options.timeoutMs && {
        timeoutSeconds: Math.ceil(options.timeoutMs / 1000),
      }),
    };

    try {
      const execution = await sandbox.commands.run(
        command,
        Object.keys(runOpts).length ? runOpts : undefined,
        handlers,
      );
      const exitCode = execution.exitCode ?? undefined;
      const result: RunCommandResult = {
        success: (exitCode ?? 0) === 0,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        exitCode,
        executionTimeMs,
        sessionReused,
      };
      this.recordLastCommand(options.sessionId, command, result);
      return result;
    } catch (err) {
      const message =
        err instanceof SandboxException
          ? `SandboxException [${err.error.code}]: ${err.error.message}`
          : String(err);
      const result: RunCommandResult = {
        success: false,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        executionTimeMs,
        sessionReused,
        error: message,
      };
      this.recordLastCommand(options.sessionId, command, result);
      return result;
    }
  }

  /**
   * 在 session 沙箱中读取文件（可选行范围）
   */
  async readSandboxFile(
    sessionId: string,
    path: string,
    startLine?: number,
    endLine?: number,
  ): Promise<{ content: string; totalLines: number }> {
    const { sandbox } = await this.acquireSessionSandbox(sessionId);
    const raw = (await sandbox.files.readFile(path)).toString();
    const lines = raw.split('\n');
    const totalLines = lines.length;

    if (startLine === undefined && endLine === undefined) {
      return { content: raw, totalLines };
    }

    const start = Math.max(1, startLine ?? 1);
    const end = Math.min(totalLines, endLine ?? totalLines);
    const slice = lines.slice(start - 1, end).join('\n');
    return { content: slice, totalLines };
  }

  /**
   * 在 session 沙箱中读取文件原始字节（用于 exportFile 等二进制导出）
   *
   * 必须使用 readBytes：readFile 会按 UTF-8 解码，破坏 xlsx/pdf 等二进制文件。
   */
  async readSandboxFileBytes(sessionId: string, path: string): Promise<Buffer> {
    const { sandbox } = await this.acquireSessionSandbox(sessionId);
    const bytes = await sandbox.files.readBytes(path);
    return Buffer.from(bytes);
  }

  /**
   * 在 session 沙箱中写入文件
   */
  async writeSandboxFile(
    sessionId: string,
    path: string,
    content: string,
  ): Promise<{ bytesWritten: number }> {
    const { sandbox } = await this.acquireSessionSandbox(sessionId);
    const buffer = Buffer.from(content, 'utf8');
    await this.writeFileToSandbox(sandbox, path, buffer);
    return { bytesWritten: buffer.length };
  }

  /**
   * 在 session 沙箱中执行代码（与 topic session 一致）
   */
  async executeCodeInSession(
    sessionId: string,
    code: string,
    language: SupportedLanguage,
    options?: Pick<RunCommandOptions, 'timeoutMs' | 'workingDirectory' | 'envs' | 'files'>,
  ): Promise<RunCommandResult> {
    const command = buildCommand(code, language);
    return this.runCommand(command, { sessionId, ...options });
  }

  /**
   * 读取后台命令增量输出
   */
  async getBackgroundJobOutput(
    sessionId: string,
    commandId: string,
  ): Promise<{ newOutput: string; running: boolean; error?: string }> {
    const entry = SandboxToolClient.sessions.get(sessionId);
    const job = entry?.backgroundJobs?.get(commandId);
    if (!job) {
      return { newOutput: '', running: false, error: `Unknown commandId: ${commandId}` };
    }

    const offset = job.lastStdoutOffset + 1;
    const readCmd = `if [ -f '${job.stdoutPath.replaceAll("'", "'\\''")}' ]; then tail -c +${offset} '${job.stdoutPath.replaceAll("'", "'\\''")}' 2>/dev/null || true; fi`;
    const readResult = await this.runCommand(readCmd, { sessionId, timeoutMs: 30_000 });
    const newOutput = readResult.stdout ?? '';

    const pidCheckCmd = `if [ -f '${job.pidPath.replaceAll("'", "'\\''")}' ] && kill -0 "$(cat '${job.pidPath.replaceAll("'", "'\\''")}')" 2>/dev/null; then echo running; else echo done; fi`;
    const pidResult = await this.runCommand(pidCheckCmd, { sessionId, timeoutMs: 10_000 });
    const running = pidResult.stdout.trim() === 'running';
    job.running = running;
    job.lastStdoutOffset += Buffer.byteLength(newOutput, 'utf8');

    return { newOutput, running };
  }

  /**
   * 终止后台命令
   */
  async killBackgroundJob(
    sessionId: string,
    commandId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const entry = SandboxToolClient.sessions.get(sessionId);
    const job = entry?.backgroundJobs?.get(commandId);
    if (!job) {
      return { success: false, error: `Unknown commandId: ${commandId}` };
    }

    const killCmd = `if [ -f '${job.pidPath.replaceAll("'", "'\\''")}' ]; then kill "$(cat '${job.pidPath.replaceAll("'", "'\\''")}')" 2>/dev/null || true; fi`;
    await this.runCommand(killCmd, { sessionId, timeoutMs: 10_000 });
    job.running = false;
    return { success: true };
  }

  private async runBackgroundCommand(
    command: string,
    options: RunCommandOptions,
  ): Promise<RunCommandResult> {
    const commandId = nanoid(12);
    const stdoutPath = `/tmp/lobe-bg-${commandId}.out`;
    const stderrPath = `/tmp/lobe-bg-${commandId}.err`;
    const pidPath = `/tmp/lobe-bg-${commandId}.pid`;
    const escapedCmd = command.replaceAll("'", "'\\''");
    const bgCommand = [
      `nohup sh -c '${escapedCmd}' > '${stdoutPath}' 2> '${stderrPath}' </dev/null &`,
      `echo $! > '${pidPath}'`,
      'echo started',
    ].join(' ');

    const result = await this.runCommand(bgCommand, { ...options, background: false });
    const entry = SandboxToolClient.sessions.get(options.sessionId);
    if (entry) {
      if (!entry.backgroundJobs) entry.backgroundJobs = new Map();
      entry.backgroundJobs.set(commandId, {
        commandId,
        pidPath,
        running: true,
        stderrPath,
        stdoutPath,
        lastStdoutOffset: 0,
      });
    }

    return {
      ...result,
      commandId,
      stdout: result.stdout || 'started',
      success: result.success,
    };
  }

  private recordInjectedFile(
    entry: SandboxSessionEntry,
    file: RunCommandFileInput,
    sizeBytes: number,
  ): void {
    const record: InjectedFileRecord = {
      source: file.source,
      destination: file.destination,
      injectedAt: Date.now(),
      sizeBytes,
    };
    const existingIndex = entry.injectedFiles.findIndex((f) => f.destination === file.destination);
    if (existingIndex >= 0) {
      entry.injectedFiles[existingIndex] = record;
    } else {
      entry.injectedFiles.push(record);
    }
  }

  private recordLastCommand(sessionId: string, command: string, result: RunCommandResult): void {
    const entry = SandboxToolClient.sessions.get(sessionId);
    if (!entry) return;

    entry.lastCommand = {
      command,
      success: result.success,
      executedAt: Date.now(),
      exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs,
    };
  }

  // ─── S3 文件注入 ────────────────────────────────────────────

  /**
   * 从 source 下载文件并写入沙箱指定路径
   */
  async injectFileFromSource(
    sandbox: Sandbox,
    source: string | S3FileSource,
    destination: string,
  ): Promise<number> {
    const buffer =
      typeof source === 'string' && isHttpUrl(source)
        ? await this.downloadFromHttp(source)
        : await this.downloadFromS3Source(source);

    await this.writeFileToSandbox(sandbox, destination, buffer);
    return buffer.length;
  }

  /**
   * 从 S3 下载文件并写入沙箱指定路径
   */
  async injectS3File(
    sandbox: Sandbox,
    bucket: string,
    key: string,
    sandboxPath: string,
  ): Promise<void> {
    const buffer = await this.downloadFromS3(bucket, key);
    await this.writeFileToSandbox(sandbox, sandboxPath, buffer);
  }

  /**
   * 批量注入 S3 文件到沙箱
   */
  async injectS3Files(
    sandbox: Sandbox,
    files: Array<{ bucket: string; key: string; sandboxPath: string }>,
  ): Promise<void> {
    await Promise.all(files.map((f) => this.injectS3File(sandbox, f.bucket, f.key, f.sandboxPath)));
  }

  private async downloadFromS3Source(source: string | S3FileSource): Promise<Buffer> {
    if (!this.s3Client) {
      throw new Error('S3 未配置，请在 SandboxToolClient 中提供 s3 配置');
    }
    const { bucket, key } = resolveS3Source(source, this.s3Bucket);
    return this.downloadFromS3(bucket, key);
  }

  private async downloadFromS3(bucket: string, key: string): Promise<Buffer> {
    if (!this.s3Client) {
      throw new Error('S3 未配置，请在 SandboxToolClient 中提供 s3 配置');
    }

    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error(`S3 文件为空: s3://${bucket}/${key}`);
    }

    return streamToBuffer(response.Body as Readable);
  }

  private async downloadFromHttp(url: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      lib
        .get(url, isHttps ? { rejectUnauthorized: this.httpRejectUnauthorized } : {}, (res) => {
          const statusCode = res.statusCode ?? 0;

          if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
            void this.downloadFromHttp(new URL(res.headers.location, url).href)
              .then(resolve)
              .catch(reject);
            return;
          }

          if (statusCode >= 400) {
            reject(new Error(`下载文件失败: ${url} (${statusCode} ${res.statusMessage ?? ''})`));
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    });
  }

  private async ensureSandboxDirectory(sandbox: Sandbox, dir: string): Promise<void> {
    const escaped = dir.replaceAll("'", "'\\''");
    await sandbox.commands.run(`mkdir -p '${escaped}'`);
  }

  private async writeFileToSandbox(
    sandbox: Sandbox,
    sandboxPath: string,
    data: Buffer,
  ): Promise<void> {
    const dir = sandboxPath.slice(0, Math.max(0, sandboxPath.lastIndexOf('/')));
    if (dir) {
      await this.ensureSandboxDirectory(sandbox, dir);
    }

    await sandbox.files.writeFiles([
      {
        path: sandboxPath,
        data,
        mode: 644,
      },
    ]);
  }

  // ─── 代码执行 ───────────────────────────────────────────────

  /**
   * 在沙箱中执行代码，支持 Python / Shell / Node.js
   */
  async executeCode(input: ExecuteCodeInput): Promise<ExecuteResult> {
    const sandbox = await this.getSandbox();
    const stdout: string[] = [];
    const stderr: string[] = [];
    let executionTimeMs = 0;

    // 注入 S3 文件
    if (input.s3Files?.length) {
      await this.injectS3Files(sandbox, input.s3Files);
    }

    // 构造实际执行的 shell 命令
    const command = buildCommand(input.code, input.language);

    const handlers: ExecutionHandlers = {
      onStdout: (m) => {
        stdout.push(m.text);
      },
      onStderr: (m) => {
        stderr.push(m.text);
      },
      onExecutionComplete: (c) => {
        executionTimeMs = c.executionTimeMs;
      },
    };

    try {
      await sandbox.commands.run(command, undefined, handlers);
      return {
        success: true,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        executionTimeMs,
      };
    } catch (err) {
      const message =
        err instanceof SandboxException
          ? `SandboxException [${err.error.code}]: ${err.error.message}`
          : String(err);
      return {
        success: false,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
        executionTimeMs,
        error: message,
      };
    }
  }

  /**
   * 完整工作流：注入文件 → 执行代码 → 读取输出文件
   * 这是 Agent 调用的主入口
   */
  async runWithFiles(input: RunWithFilesInput): Promise<ExecuteResult> {
    const result = await this.executeCode(input);

    // 执行后读取指定的输出文件
    if (result.success && input.readOutputFiles?.length) {
      const sandbox = await this.getSandbox();
      const outputFiles: Record<string, string> = {};

      await Promise.allSettled(
        input.readOutputFiles.map(async (filePath) => {
          try {
            const content = await sandbox.files.readFile(filePath);
            outputFiles[filePath] = content.toString();
          } catch {
            outputFiles[filePath] = '[文件不存在或读取失败]';
          }
        }),
      );

      result.outputFiles = outputFiles;
    }

    return result;
  }

  // ─── Agent Tool 定义 ─────────────────────────────────────────

  /**
   * 返回 Anthropic Claude 格式的 tool 定义
   * 直接传给 API 的 tools 参数
   */
  getAnthropicToolDefinitions() {
    return [
      {
        name: 'execute_code_in_sandbox',
        description:
          '在隔离沙箱中执行代码（Python/Shell/Node.js）。支持从S3注入大文件（CSV、JSON等），执行数据处理脚本，并返回结果和输出文件内容。',
        input_schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: '要执行的代码字符串',
            },
            language: {
              type: 'string',
              enum: ['python', 'shell', 'node'],
              description: '执行语言：python | shell | node',
            },
            s3_files: {
              type: 'array',
              description: '需要注入沙箱的S3文件列表',
              items: {
                type: 'object',
                properties: {
                  bucket: { type: 'string', description: 'S3 Bucket 名称' },
                  key: { type: 'string', description: 'S3 对象 Key' },
                  sandbox_path: {
                    type: 'string',
                    description: '在沙箱中的目标路径，例如 "/workspace/data.csv"',
                  },
                },
                required: ['bucket', 'key', 'sandbox_path'],
              },
            },
            read_output_files: {
              type: 'array',
              items: { type: 'string' },
              description: '执行完成后需要读取的沙箱文件路径列表，内容将包含在返回结果中',
            },
          },
          required: ['code', 'language'],
        },
      },
    ];
  }

  /**
   * 处理 Agent 的 tool_use 调用，返回 tool_result 格式
   */
  async handleToolCall(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<{ type: 'tool_result'; content: string }> {
    if (toolName !== 'execute_code_in_sandbox') {
      return {
        type: 'tool_result',
        content: JSON.stringify({ error: `未知工具: ${toolName}` }),
      };
    }

    const input = toolInput as {
      code: string;
      language: SupportedLanguage;
      s3_files?: Array<{ bucket: string; key: string; sandbox_path: string }>;
      read_output_files?: string[];
    };

    const result = await this.runWithFiles({
      code: input.code,
      language: input.language,
      s3Files: input.s3_files?.map((f) => ({
        bucket: f.bucket,
        key: f.key,
        sandboxPath: f.sandbox_path,
      })),
      readOutputFiles: input.read_output_files,
    });

    return {
      type: 'tool_result',
      content: JSON.stringify(result),
    };
  }
}

// ─── 辅助函数 ────────────────────────────────────────────────

/**
 * 根据语言构造执行命令
 * 将代码写入临时文件再执行，避免 shell 转义问题
 */
export function buildCommand(code: string, language: SupportedLanguage): string {
  const escaped = code.replaceAll("'", "'\\''");
  switch (language) {
    case 'python': {
      return `python3 -c '${escaped}'`;
    }
    case 'node': {
      return `node -e '${escaped}'`;
    }
    case 'shell':
    default: {
      return `bash -c '${escaped}'`;
    }
  }
}

/** Stream 转 Buffer */
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** 判断是否为 HTTP(S) URL */
function isHttpUrl(source: string): boolean {
  return source.startsWith('http://') || source.startsWith('https://');
}

/** 解析 S3 source 为 bucket + key */
function resolveS3Source(
  source: string | S3FileSource,
  defaultBucket?: string,
): { bucket: string; key: string } {
  if (typeof source === 'string') {
    if (source.startsWith('s3://')) {
      return parseS3Uri(source);
    }
    if (!defaultBucket) {
      throw new Error(
        `source "${source}" 缺少 bucket，请在 source 中指定 bucket 或配置 client 默认 bucket`,
      );
    }
    return { bucket: defaultBucket, key: source };
  }

  const bucket = source.bucket ?? defaultBucket;
  if (!bucket) {
    throw new Error(
      `source key "${source.key}" 缺少 bucket，请在 source 中指定 bucket 或配置 client 默认 bucket`,
    );
  }
  return { bucket, key: source.key };
}

/** 解析 s3://bucket/key URI */
function parseS3Uri(uri: string): { bucket: string; key: string } {
  const match = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`无效的 S3 URI: ${uri}`);
  }
  return { bucket: match[1], key: match[2] };
}

function formatFileSource(source: string | S3FileSource): string {
  if (typeof source === 'string') {
    if (source.startsWith('s3://')) return source;
    if (isHttpUrl(source)) {
      const url = new URL(source);
      return `${url.origin}${url.pathname}`;
    }
    return source;
  }
  return source.bucket ? `s3://${source.bucket}/${source.key}` : source.key;
}

function toSessionInjectedFile(record: InjectedFileRecord): SessionInjectedFile {
  return {
    source: record.source,
    sourceLabel: formatFileSource(record.source),
    destination: record.destination,
    injectedAt: record.injectedAt,
    sizeBytes: record.sizeBytes,
  };
}

/**
 * 从环境变量创建 SandboxToolClient 实例
 *
 * 支持的环境变量：
 *   SANDBOX_DOMAIN    - 沙箱服务域名
 *   SANDBOX_API_KEY   - 沙箱 API Key
 *   SANDBOX_PROTOCOL  - http | https（默认 http）
 *   SANDBOX_IMAGE     - 沙箱镜像地址
 *   SANDBOX_TIMEOUT_SECONDS - 沙箱 idle 超时（秒）
 *   SANDBOX_HTTP_REJECT_UNAUTHORIZED - 设为 false 可跳过 HTTPS 证书校验（内网自签）
 *   SANDBOX_ALLOW_DEPENDENCY_INSTALL - 设为 true 可临时允许 pip/npm/uv install（测试用，默认禁止）
 */
export function createSandboxClientFromEnv(): SandboxToolClient {
  const apiKey = process.env.SANDBOX_API_KEY;
  const domain = process.env.SANDBOX_DOMAIN;
  const protocol = process.env.SANDBOX_PROTOCOL as 'http' | 'https' | undefined;
  const image = process.env.SANDBOX_IMAGE;
  const timeoutSeconds = process.env.SANDBOX_TIMEOUT_SECONDS
    ? Number(process.env.SANDBOX_TIMEOUT_SECONDS)
    : undefined;

  const connectionOverrides: Partial<SandboxConnectionConfig> = {
    ...(domain && { domain }),
    ...(protocol && { protocol }),
    ...(apiKey && {
      apiKey,
      headers: { 'SANDBOX-API-KEY': apiKey },
    }),
    debug: false,
    useServerProxy: false,
  };

  const createOverrides: SandboxCreateOptions = {
    ...(image && { image }),
    ...(timeoutSeconds && { timeoutSeconds }),
  };

  const s3Config =
    fileEnv.S3_ACCESS_KEY_ID && fileEnv.S3_SECRET_ACCESS_KEY && fileEnv.S3_BUCKET
      ? {
          bucket: fileEnv.S3_BUCKET,
          credentials: {
            accessKeyId: fileEnv.S3_ACCESS_KEY_ID,
            secretAccessKey: fileEnv.S3_SECRET_ACCESS_KEY,
          },
          endpoint: fileEnv.S3_ENDPOINT,
          forcePathStyle: fileEnv.S3_ENABLE_PATH_STYLE,
          region: fileEnv.S3_REGION || 'us-east-1',
        }
      : undefined;

  const httpConfig = {
    rejectUnauthorized: process.env.SANDBOX_HTTP_REJECT_UNAUTHORIZED !== 'false',
  };

  return new SandboxToolClient(createOverrides, connectionOverrides, s3Config, httpConfig);
}
