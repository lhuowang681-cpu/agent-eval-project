import { describe, expect, it, vi } from 'vitest';

import type { SandboxToolClient } from '../sandboxToolClient';
import { dispatchOpenSandboxTool } from './handlers';

describe('dispatchOpenSandboxTool', () => {
  it('blocks runCommand dependency install before sandbox execution', async () => {
    const client = {
      runCommand: vi.fn(),
    } as unknown as SandboxToolClient;

    const response = await dispatchOpenSandboxTool({
      client,
      params: { command: 'uv pip install python-docx' },
      sessionId: 'topic-1',
      toolName: 'runCommand',
    });

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('DEPENDENCY_INSTALL_BLOCKED');
    expect(response.error?.message).toContain('python-docx');
    expect(client.runCommand).not.toHaveBeenCalled();
  });

  it('returns INVALID_PARAMS when runCommand has no command', async () => {
    const client = {
      runCommand: vi.fn(),
    } as unknown as SandboxToolClient;

    const response = await dispatchOpenSandboxTool({
      client,
      params: {},
      sessionId: 'topic-1',
      toolName: 'runCommand',
    });

    expect(response.success).toBe(false);
    expect(response.error?.code).toBe('INVALID_PARAMS');
  });

  it('uses search/replace params for editLocalFile', async () => {
    const client = {
      readSandboxFile: vi.fn().mockResolvedValue({ content: 'foo bar foo', totalLines: 1 }),
      writeSandboxFile: vi.fn().mockResolvedValue({ bytesWritten: 3 }),
    } as unknown as SandboxToolClient;

    const response = await dispatchOpenSandboxTool({
      client,
      params: { all: true, path: '/tmp/x.txt', replace: 'baz', search: 'foo' },
      sessionId: 'topic-1',
      toolName: 'editLocalFile',
    });

    expect(response.success).toBe(true);
    expect(response.data?.result).toMatchObject({ replacements: 2 });
    expect(client.writeSandboxFile).toHaveBeenCalledWith('topic-1', '/tmp/x.txt', 'baz bar baz');
  });

  it('maps readLocalFile via readSandboxFile', async () => {
    const client = {
      readSandboxFile: vi.fn().mockResolvedValue({ content: 'hello', totalLines: 1 }),
    } as unknown as SandboxToolClient;

    const response = await dispatchOpenSandboxTool({
      client,
      params: { path: '/tmp/a.txt' },
      sessionId: 'topic-1',
      toolName: 'readLocalFile',
    });

    expect(response.success).toBe(true);
    expect(response.data?.result).toEqual({ content: 'hello', totalLines: 1 });
  });

  it('exportFile reads sandbox bytes and uploads from server (not curl)', async () => {
    const xlsxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const client = {
      readSandboxFileBytes: vi.fn().mockResolvedValue(xlsxBytes),
    } as unknown as SandboxToolClient;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));

    const path = '/tmp/tielv_only_智行火车支付用户归因报表_铁旅纵横.xlsx';
    const response = await dispatchOpenSandboxTool({
      client,
      params: { path, uploadUrl: 'https://s3.example/presigned-put' },
      sessionId: 'topic-1',
      toolName: 'exportFile',
    });

    expect(response.success).toBe(true);
    expect(response.data?.result).toEqual({ success: true, error: undefined });
    expect(client.readSandboxFileBytes).toHaveBeenCalledWith('topic-1', path);
    expect(fetch).toHaveBeenCalledWith('https://s3.example/presigned-put', {
      body: xlsxBytes,
      method: 'PUT',
    });

    vi.unstubAllGlobals();
  });

  it('exportFile reports read failure when file missing in sandbox', async () => {
    const client = {
      readSandboxFileBytes: vi.fn().mockRejectedValue(new Error('file not found')),
    } as unknown as SandboxToolClient;

    const response = await dispatchOpenSandboxTool({
      client,
      params: { path: '/tmp/missing.xlsx', uploadUrl: 'https://s3.example/upload' },
      sessionId: 'topic-1',
      toolName: 'exportFile',
    });

    expect(response.data?.result).toMatchObject({ success: false, error: 'file not found' });
  });
});
