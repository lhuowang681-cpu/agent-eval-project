import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MessageModel } from '@/database/models/message';
import { type FileService } from '@/server/services/file';

import * as preInjectModule from '../preInjectSandboxFiles';
import { type SandboxToolClient } from '../sandboxToolClient';
import {
  collectSandboxFileIdsFromTopic,
  ensureTopicSandboxFiles,
  extractExportedFileId,
} from './ensureTopicSandboxFiles';

afterEach(() => {
  vi.restoreAllMocks();
});

const sandboxPdf = {
  fileType: 'application/pdf',
  name: 'doc.pdf',
  size: 30_000,
  url: 'https://example.com/doc.pdf',
};

describe('ensureTopicSandboxFiles', () => {
  it('merges message fileIds with topic history fileIds', async () => {
    const messageModel = {
      query: vi.fn().mockResolvedValue([{ role: 'user', fileList: [{ id: 'f2' }] }]),
    } as unknown as MessageModel;

    const fileService = {
      getFileRecord: vi.fn().mockResolvedValue(sandboxPdf),
    } as unknown as FileService;

    const resolveSpy = vi
      .spyOn(preInjectModule, 'resolveSandboxFileInputs')
      .mockResolvedValue([
        { destination: '/mnt/user-data/uploads/f1_a.pdf', source: 'https://example.com/a.pdf' },
      ]);

    const sandboxClient = {
      ensureFilesInjected: vi.fn().mockResolvedValue({ injectedCount: 1, sessionReused: true }),
    } as unknown as SandboxToolClient;

    const result = await ensureTopicSandboxFiles({
      fileIds: ['f1'],
      fileService,
      messageModel,
      sandboxClient,
      topicId: 'topic-1',
    });

    expect(messageModel.query).toHaveBeenCalledWith({ topicId: 'topic-1' });
    expect(resolveSpy).toHaveBeenCalledWith(['f1', 'f2'], fileService);
    expect(result.injectedCount).toBe(1);
  });

  it('returns empty when topic has no file ids to resolve', async () => {
    const sandboxClient = {
      ensureFilesInjected: vi.fn(),
    } as unknown as SandboxToolClient;

    const result = await ensureTopicSandboxFiles({
      fileService: {} as FileService,
      sandboxClient,
      topicId: 'topic-2',
    });

    expect(result.injectedCount).toBe(0);
    expect(result.files).toEqual([]);
    expect(sandboxClient.ensureFilesInjected).not.toHaveBeenCalled();
  });
});

describe('collectSandboxFileIdsFromTopic', () => {
  it('deduplicates file ids across user messages', async () => {
    const messageModel = {
      query: vi.fn().mockResolvedValue([
        { role: 'user', fileList: [{ id: 'file-a' }] },
        { role: 'user', fileList: [{ id: 'file-a' }, { id: 'file-b' }] },
        { role: 'assistant', fileList: [{ id: 'file-c' }] },
      ]),
    } as unknown as MessageModel;

    const fileService = {
      getFileRecord: vi.fn().mockResolvedValue(sandboxPdf),
    } as unknown as FileService;

    const ids = await collectSandboxFileIdsFromTopic('topic-3', fileService, messageModel);

    expect(ids).toEqual(['file-a', 'file-b']);
    expect(fileService.getFileRecord).toHaveBeenCalledTimes(2);
  });

  it('includes exportFile tool outputs from topic history', async () => {
    const messageModel = {
      query: vi.fn().mockResolvedValue([
        {
          plugin: { apiName: 'exportFile' },
          pluginState: { fileId: 'ppt-export', success: true },
          role: 'tool',
        },
        { role: 'user', content: 'analyze the ppt again' },
      ]),
    } as unknown as MessageModel;

    const fileService = {
      getFileRecord: vi.fn().mockResolvedValue({
        fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        name: 'report.pptx',
        size: 50_000,
        url: 'code-interpreter-exports/2026-06-16/topic-1/report.pptx',
      }),
    } as unknown as FileService;

    const ids = await collectSandboxFileIdsFromTopic('topic-4', fileService, messageModel);

    expect(ids).toEqual(['ppt-export']);
  });
});

describe('extractExportedFileId', () => {
  it('returns fileId from exportFile tool state', () => {
    expect(
      extractExportedFileId({
        plugin: { apiName: 'exportFile' },
        pluginState: { fileId: 'file-1', success: true },
        role: 'tool',
      }),
    ).toBe('file-1');
  });

  it('ignores failed exportFile tool state', () => {
    expect(
      extractExportedFileId({
        plugin: { apiName: 'exportFile' },
        pluginState: { fileId: 'file-1', success: false },
        role: 'tool',
      }),
    ).toBeUndefined();
  });
});
