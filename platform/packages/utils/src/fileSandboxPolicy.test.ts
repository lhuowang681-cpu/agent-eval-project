import { describe, expect, it } from 'vitest';

import {
  enrichMessagesWithTopicSandboxFiles,
  getSandboxOutputPath,
  getSandboxStoragePath,
  getSandboxUploadPath,
  isAgentGeneratedSandboxFile,
  messagesHaveSandboxFiles,
  SANDBOX_FILE_SIZE_THRESHOLD,
  shouldProcessFileInSandbox,
} from './fileSandboxPolicy';

describe('fileSandboxPolicy', () => {
  it('should expose 20KB as File Reading plain-text hint only', () => {
    expect(SANDBOX_FILE_SIZE_THRESHOLD).toBe(20 * 1024);
  });

  it('should treat media files as not sandbox-eligible', () => {
    expect(shouldProcessFileInSandbox('image/png', 100_000)).toBe(false);
    expect(shouldProcessFileInSandbox('video/mp4', 100_000)).toBe(false);
    expect(shouldProcessFileInSandbox('audio/mpeg', 100_000)).toBe(false);
  });

  it('should sandbox all non-media attachments regardless of size', () => {
    expect(shouldProcessFileInSandbox('application/pdf', 1024)).toBe(true);
    expect(shouldProcessFileInSandbox('text/plain', 512)).toBe(true);
    expect(
      shouldProcessFileInSandbox(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        10_240,
      ),
    ).toBe(true);
    expect(shouldProcessFileInSandbox('application/pdf', 50_000)).toBe(true);
    expect(shouldProcessFileInSandbox('text/csv', 50_000)).toBe(true);
  });

  it('should build sandbox path under /mnt/user-data/uploads', () => {
    expect(getSandboxUploadPath('file-1', 'report.pdf')).toBe(
      '/mnt/user-data/uploads/file-1_report.pdf',
    );
  });

  it('should build agent output path under /mnt/user-data/outputs', () => {
    expect(getSandboxOutputPath('file-1', 'report.pptx')).toBe(
      '/mnt/user-data/outputs/file-1_report.pptx',
    );
  });

  it('should route storage path by file origin', () => {
    expect(getSandboxStoragePath('f1', 'a.pdf', 'files/user-1/abc/a.pdf')).toBe(
      '/mnt/user-data/uploads/f1_a.pdf',
    );
    expect(
      getSandboxStoragePath(
        'f2',
        'deck.pptx',
        'code-interpreter-exports/2026-06-16/topic-1/deck.pptx',
      ),
    ).toBe('/mnt/user-data/outputs/f2_deck.pptx');
  });

  it('should detect agent-generated sandbox files by S3 key prefix', () => {
    expect(isAgentGeneratedSandboxFile('code-interpreter-exports/topic/file.pptx')).toBe(true);
    expect(isAgentGeneratedSandboxFile('files/user/file.pdf')).toBe(false);
  });

  it('should detect sandbox files from small non-media attachments', () => {
    expect(
      messagesHaveSandboxFiles([
        {
          fileList: [
            {
              fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              size: 10_240,
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it('should not treat image-only attachments as sandbox files', () => {
    expect(
      messagesHaveSandboxFiles([
        {
          fileList: [{ fileType: 'image/png', size: 500_000 }],
        },
      ]),
    ).toBe(false);
  });

  it('should enrich latest user message with topic sandbox files', () => {
    const topicFiles = [
      {
        fileType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        id: 'exported-ppt',
        name: 'report.pptx',
        processingMode: 'sandbox' as const,
        sandboxPath: '/mnt/user-data/outputs/exported-ppt_report.pptx',
        size: 50_000,
        url: 'https://example.com/f/exported-ppt',
      },
    ];

    const enriched = enrichMessagesWithTopicSandboxFiles(
      [
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'continue analyzing the ppt' },
      ],
      topicFiles,
    );

    expect(enriched[1].fileList).toEqual(topicFiles);
  });
});
