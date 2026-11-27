// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { SkillImportError } from './errors';
import { SkillSecurityScanner } from './securityScanner';

const jsonResponse = (body: unknown, ok = true, status = 200) =>
  ({
    json: async () => body,
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
  }) as Response;

const createScanner = (fetchMock: ReturnType<typeof vi.fn>, timeoutMs = 1000) =>
  new SkillSecurityScanner({
    baseUrl: 'https://scan.example.com/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    pollIntervalMs: 1,
    source: 'web',
    timeoutMs,
  });

const createScannerWithDefaultSource = (fetchMock: ReturnType<typeof vi.fn>) =>
  new SkillSecurityScanner({
    baseUrl: 'https://scan.example.com/api/v1',
    fetch: fetchMock as unknown as typeof fetch,
    pollIntervalMs: 1,
    timeoutMs: 1000,
  });

describe('SkillSecurityScanner', () => {
  it('should create a git scan and allow low risk reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-git-1', success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          report_data: { recommendation: '可以安装', risk_level: 'low', score: 90 },
          status: 'completed',
        }),
      );
    const scanner = createScanner(fetchMock);

    await scanner.assertGitSafe({
      branch: 'main',
      gitUrl: 'https://github.com/lobehub/skill-demo',
      targetSubdir: 'skills/demo',
    });

    const createTaskInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(fetchMock.mock.calls[0][0]).toBe('https://scan.example.com/api/v1/scan');
    expect(createTaskInit.method).toBe('POST');
    expect(JSON.parse(createTaskInit.body as string)).toMatchObject({
      git_branch: 'main',
      git_url: 'https://github.com/lobehub/skill-demo',
      source: 'web',
      source_type: 'git',
      target_subdir: 'skills/demo',
    });

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://scan.example.com/api/v1/scan/scan-git-1/status',
    );
  });

  it('should upload zip files with form data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-zip-1', success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          report_data: { risk_level: 'none', score: 100 },
          status: 'completed',
        }),
      );
    const scanner = createScanner(fetchMock);

    await scanner.assertZipSafe({
      buffer: Buffer.from('zip-content'),
      fileName: 'skill.zip',
    });

    const createTaskInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(createTaskInit.body).toBeInstanceOf(FormData);
  });

  it('should use tripYoYo as the default source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-default-source-1', success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          report_data: { risk_level: 'none', score: 100 },
          status: 'completed',
        }),
      );
    const scanner = createScannerWithDefaultSource(fetchMock);

    await scanner.assertGitSafe({ gitUrl: 'https://github.com/lobehub/skill-demo' });

    const createTaskInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(createTaskInit.body as string)).toMatchObject({
      source: 'tripYoYo',
    });
  });

  it('should reject medium risk reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-risk-1', success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          report_data: {
            recommendation: '需要人工审查后再安装',
            risk_level: 'medium',
            score: 80,
          },
          status: 'completed',
        }),
      );
    const scanner = createScanner(fetchMock);

    await expect(
      scanner.assertZipSafe({ buffer: Buffer.from('zip-content') }),
    ).rejects.toMatchObject({
      code: 'SECURITY_SCAN_REJECTED',
    });
  });

  it('should fail closed when scan status is failed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-failed-1', success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          error_code: 'GIT_CLONE_FAILED',
          error_message: 'Git 克隆失败',
          status: 'failed',
        }),
      );
    const scanner = createScanner(fetchMock);

    await expect(
      scanner.assertGitSafe({ gitUrl: 'https://github.com/a/b' }),
    ).rejects.toBeInstanceOf(SkillImportError);
  });

  it('should timeout when scan never completes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'scan-timeout-1', success: true }))
      .mockResolvedValue(jsonResponse({ status: 'running' }));
    const scanner = createScanner(fetchMock, 1);

    await expect(scanner.assertGitSafe({ gitUrl: 'https://github.com/a/b' })).rejects.toMatchObject(
      {
        code: 'SECURITY_SCAN_FAILED',
        message: '扫描接口超时，请重试',
      },
    );
  });
});

describe('SkillSecurityScanner — public scan-start methods', () => {
  it('startGitScan should return the scan_id without waiting', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'start-git-1', success: true }));
    const scanner = createScanner(fetchMock);

    const scanId = await scanner.startGitScan({
      branch: 'main',
      gitUrl: 'https://github.com/lobehub/demo',
      targetSubdir: './',
    });

    expect(scanId).toBe('start-git-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://scan.example.com/api/v1/scan');
  });

  it('startZipScan should return the scan_id without waiting', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ scan_id: 'start-zip-1', success: true }));
    const scanner = createScanner(fetchMock);

    const scanId = await scanner.startZipScan({
      buffer: Buffer.from('zip-content'),
      fileName: 'skill.zip',
    });

    expect(scanId).toBe('start-zip-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('fetchScanStatus should return raw status from API', async () => {
    const statusPayload = { progress: 42, stage_message: 'Scanning...', status: 'running' };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(statusPayload));
    const scanner = createScanner(fetchMock);

    const status = await scanner.fetchScanStatus('scan-abc');

    expect(status.status).toBe('running');
    expect(status.progress).toBe(42);
    expect(fetchMock.mock.calls[0][0]).toBe('https://scan.example.com/api/v1/scan/scan-abc/status');
  });

  it('assertScanIdSafe should pass for completed + safe scan', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        report_data: { risk_level: 'low', score: 90 },
        status: 'completed',
      }),
    );
    const scanner = createScanner(fetchMock);

    await expect(scanner.assertScanIdSafe('safe-scan-id')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('assertScanIdSafe should throw SECURITY_SCAN_REJECTED for completed + medium risk', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        report_data: { recommendation: '需要人工审查', risk_level: 'medium', score: 70 },
        status: 'completed',
      }),
    );
    const scanner = createScanner(fetchMock);

    await expect(scanner.assertScanIdSafe('risky-scan-id')).rejects.toMatchObject({
      code: 'SECURITY_SCAN_REJECTED',
    });
  });

  it('assertScanIdSafe should throw SECURITY_SCAN_FAILED when scan is still running', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ progress: 50, status: 'running' }));
    const scanner = createScanner(fetchMock);

    await expect(scanner.assertScanIdSafe('incomplete-scan-id')).rejects.toMatchObject({
      code: 'SECURITY_SCAN_FAILED',
      message: expect.stringContaining('尚未完成'),
    });
  });
});
