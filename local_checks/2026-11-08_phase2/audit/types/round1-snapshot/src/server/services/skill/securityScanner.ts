import debug from 'debug';
import { zip as fflateZip } from 'fflate';

import { appEnv } from '@/envs/app';
import type { ScanStatusResponse } from '@/helpers/skillScanReport';
import {
  formatScanFailedMessage,
  formatScanRejectedMessage,
  normalizeScanReport,
} from '@/helpers/skillScanReport';

import { SkillImportError } from './errors';

const log = debug('lobe-server:skill-security-scanner');

const DEFAULT_SCAN_SOURCE = 'tripYoYo';
const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;
const ALLOWED_RISK_LEVELS = new Set(['none', 'low']);
const TERMINAL_PENDING_STATUSES = new Set(['pending', 'downloading', 'validating', 'running']);

export type { ScanStatusResponse } from '@/helpers/skillScanReport';

interface ScanTaskResponse {
  error_code?: string;
  message?: string;
  scan_id?: string;
  status?: string;
  success?: boolean;
}

interface SkillSecurityScannerConfig {
  baseUrl?: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  source?: string;
  timeoutMs?: number;
}

export interface GitScanInput {
  branch?: string;
  gitUrl: string;
  targetSubdir?: string;
}

export interface ZipScanInput {
  buffer: Buffer;
  fileName?: string;
  targetSubdir?: string;
}

export class SkillSecurityScanner {
  private readonly baseUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly source: string;
  private readonly timeoutMs: number;

  constructor(config?: SkillSecurityScannerConfig) {
    this.baseUrl = config?.baseUrl ?? appEnv.SKILL_SECURITY_SCAN_BASE_URL;
    this.fetchImpl = config?.fetch ?? globalThis.fetch;
    this.pollIntervalMs =
      config?.pollIntervalMs ??
      appEnv.SKILL_SECURITY_SCAN_POLL_INTERVAL_MS ??
      DEFAULT_POLL_INTERVAL_MS;
    this.source = config?.source ?? appEnv.SKILL_SECURITY_SCAN_SOURCE ?? DEFAULT_SCAN_SOURCE;
    this.timeoutMs =
      config?.timeoutMs ?? appEnv.SKILL_SECURITY_SCAN_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS;
  }

  get enabled() {
    return Boolean(this.baseUrl);
  }

  // ===== Public scan-start methods (return scanId for frontend polling) =====

  async startGitScan(input: GitScanInput): Promise<string> {
    return this.createScanTask({
      body: JSON.stringify({
        git_branch: input.branch ?? '',
        git_url: input.gitUrl,
        source: this.source,
        source_type: 'git',
        target_subdir: input.targetSubdir ?? './',
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async startZipScan(input: ZipScanInput): Promise<string> {
    const formData = new FormData();
    formData.append('source', this.source);
    formData.append('source_type', 'zip');
    if (input.targetSubdir) formData.append('target_subdir', input.targetSubdir);
    formData.append(
      'file',
      new Blob([new Uint8Array(input.buffer)], { type: 'application/zip' }),
      input.fileName ?? 'skill.zip',
    );
    return this.createScanTask({ body: formData });
  }

  async startSkillMdScan(skillMdContent: string): Promise<string> {
    const buffer = await zipSkillMd(skillMdContent);
    return this.startZipScan({ buffer, fileName: 'skill.zip' });
  }

  async fetchScanStatus(scanId: string): Promise<ScanStatusResponse> {
    return this.fetchJson<ScanStatusResponse>(this.buildUrl(`/scan/${scanId}/status`), {
      method: 'GET',
    });
  }

  /** Verifies a previously-started scan has completed and passed the risk check. */
  async assertScanIdSafe(scanId: string): Promise<void> {
    if (!this.enabled) return;
    const status = await this.fetchScanStatus(scanId);
    log('assertScanIdSafe response: %O', formatScanStatusLog(status));

    if (status.status !== 'completed') {
      throw new SkillImportError(
        `安全扫描尚未完成（当前状态：${status.status ?? 'unknown'}），请稍后重试`,
        'SECURITY_SCAN_FAILED',
      );
    }

    this.assertReportSafe(status);
  }

  // ===== Blocking assert methods (for non-browser callers like CLI / market) =====

  async assertGitSafe(input: GitScanInput) {
    if (!this.enabled) return;
    const scanId = await this.startGitScan(input);
    await this.waitForSafeScan(scanId);
  }

  async assertZipSafe(input: ZipScanInput) {
    if (!this.enabled) return;
    const scanId = await this.startZipScan(input);
    await this.waitForSafeScan(scanId);
  }

  async assertSkillMdSafe(skillMdContent: string) {
    if (!this.enabled) return;
    const scanId = await this.startSkillMdScan(skillMdContent);
    await this.waitForSafeScan(scanId);
  }

  private async createScanTask(init: { body: BodyInit; headers?: HeadersInit }): Promise<string> {
    const response = await this.fetchJson<ScanTaskResponse>(this.buildUrl('/scan'), {
      body: init.body,
      headers: init.headers,
      method: 'POST',
    });
    log('createScanTask response: %O', response);

    if (!response.scan_id) {
      throw new SkillImportError(
        `Skill 安全扫描创建失败：${response.message || response.error_code || '未返回 scan_id'}`,
        'SECURITY_SCAN_FAILED',
      );
    }

    return response.scan_id;
  }

  private async waitForSafeScan(scanId: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt <= this.timeoutMs) {
      const status = await this.fetchScanStatus(scanId);
      log('getScanStatus response: %O', formatScanStatusLog(status));

      if (status.status === 'completed') {
        this.assertReportSafe(status);
        return;
      }

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new SkillImportError(formatScanFailedMessage(status), 'SECURITY_SCAN_FAILED');
      }

      if (!status.status || !TERMINAL_PENDING_STATUSES.has(status.status)) {
        throw new SkillImportError(
          `Skill 安全扫描状态异常：${status.status || 'unknown'}`,
          'SECURITY_SCAN_FAILED',
        );
      }

      await sleep(this.pollIntervalMs);
    }

    throw new SkillImportError('扫描接口超时，请重试', 'SECURITY_SCAN_FAILED');
  }

  private assertReportSafe(status: ScanStatusResponse) {
    const report = normalizeScanReport(status);

    if (ALLOWED_RISK_LEVELS.has(report.riskLevel)) return;

    throw new SkillImportError(formatScanRejectedMessage(status), 'SECURITY_SCAN_REJECTED');
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      const data = (await response.json().catch(() => ({}))) as ScanTaskResponse;

      if (!response.ok) {
        throw new SkillImportError(
          `Skill 安全扫描接口请求失败：${data.message || data.error_code || `${response.status} ${response.statusText}`}`,
          'SECURITY_SCAN_FAILED',
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof SkillImportError) throw error;

      log('fetchJson failed: %O', {
        cause: (error as Error).cause,
        message: (error as Error).message,
        method: init.method,
        name: (error as Error).name,
        url,
      });

      throw new SkillImportError(
        `Skill 安全扫描接口请求失败：${(error as Error).message}`,
        'SECURITY_SCAN_FAILED',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildUrl(path: string) {
    return `${this.baseUrl!.replace(/\/$/, '')}${path}`;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const zipSkillMd = (skillMdContent: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    fflateZip(
      {
        'SKILL.md': [
          new TextEncoder().encode(skillMdContent),
          { mtime: new Date('1980-01-01T00:00:00Z') },
        ],
      },
      { level: 6 },
      (error, data) => {
        if (error) {
          reject(
            new SkillImportError(
              `Skill 安全扫描打包失败：${error.message}`,
              'SECURITY_SCAN_FAILED',
            ),
          );
          return;
        }

        resolve(Buffer.from(data));
      },
    );
  });

const formatScanStatusLog = (status: ScanStatusResponse) => {
  const report = normalizeScanReport(status);

  return {
    current_stage: status.current_stage,
    error_code: status.error_code,
    error_message: status.error_message,
    progress: status.progress,
    report_data: status.status === 'completed' ? report : undefined,
    scan_id: status.scan_id,
    stage_message: status.stage_message,
    status: status.status,
  };
};
