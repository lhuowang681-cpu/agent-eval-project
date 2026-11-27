import { describe, expect, it, vi } from 'vitest';

import { resolveAttachmentMetadata } from './resolveAttachments';

const mocks = vi.hoisted(() => ({
  findByIds: vi.fn(),
}));

vi.mock('@/database/models/file', () => ({
  FileModel: vi.fn().mockImplementation(() => ({
    findByIds: mocks.findByIds,
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn(),
}));

vi.mock('@/server/services/document', () => ({
  DocumentService: vi.fn(),
}));

describe('resolveAttachmentMetadata', () => {
  it('should expose localPath from file metadata', async () => {
    mocks.findByIds.mockResolvedValue([
      {
        fileType: 'application/pdf',
        id: 'file-local',
        metadata: { localPath: '/Users/me/Downloads/report.pdf' },
        name: 'report.pdf',
        size: 1024,
        url: 'files/report.pdf',
      },
    ]);

    const result = await resolveAttachmentMetadata({
      db: {} as any,
      fileIds: ['file-local'],
      signUrls: false,
      userId: 'user-id',
    });

    expect(result).toEqual([
      {
        fileType: 'application/pdf',
        id: 'file-local',
        localPath: '/Users/me/Downloads/report.pdf',
        name: 'report.pdf',
        processingMode: 'local',
        size: 1024,
        url: 'files/report.pdf',
      },
    ]);
  });
});
