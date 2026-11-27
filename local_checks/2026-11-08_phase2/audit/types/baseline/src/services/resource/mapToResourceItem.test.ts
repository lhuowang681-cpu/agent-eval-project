import { describe, expect, it } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

import { mapToResourceItem } from './index';

const baseItem: FileListItem = {
  chunkCount: 3,
  chunkingError: null,
  chunkingStatus: AsyncTaskStatus.Success,
  createdAt: new Date('2026-06-05T00:00:00Z'),
  embeddingError: null,
  embeddingStatus: AsyncTaskStatus.Error,
  fileType: 'custom/document',
  finishEmbedding: false,
  id: 'docs_7SaawU3CcabMhYVo',
  name: 'Feishu doc',
  size: 100,
  sourceType: 'file',
  updatedAt: new Date('2026-06-05T00:00:00Z'),
  url: 'internal://document/placeholder',
};

describe('mapToResourceItem', () => {
  // 验收标准: 飞书文档(file-backed document)的 fileId 必须透传,
  // 否则前端重试会用 document id 触发,后端查不到 file 而落空。
  it('forwards fileId so retry/embedding actions target the file, not the document', () => {
    const result = mapToResourceItem({ ...baseItem, fileId: 'file_abc123' });

    expect(result.fileId).toBe('file_abc123');
    // id 仍是 document id(用于导航/选择等),fileId 才是 file 操作的目标
    expect(result.id).toBe('docs_7SaawU3CcabMhYVo');
  });

  // 普通文件没有独立 fileId(等于 id),透传 undefined 不应报错
  it('passes through undefined fileId for plain files', () => {
    const result = mapToResourceItem({ ...baseItem, fileId: undefined });

    expect(result.fileId).toBeUndefined();
  });
});
