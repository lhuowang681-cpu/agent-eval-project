import { describe, expect, it } from 'vitest';

import { AsyncTaskStatus } from '@/types/asyncTask';

import { getParsingStatusDisplay } from './getParsingStatusDisplay';

describe('getParsingStatusDisplay', () => {
  // 验收标准 1: 飞书导入文档 (custom/document, isPage=true) 已向量化 → 显示状态标签
  it('shows status badge for a vectorized page document (e.g. Feishu import)', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: AsyncTaskStatus.Success,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: true,
      }),
    ).toBe('statusBadge');
  });

  // 飞书文档 embedding/chunk 失败时,也要让用户看到失败状态(可点重试)
  it('shows status badge for a page document whose chunking errored', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: AsyncTaskStatus.Error,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: true,
      }),
    ).toBe('statusBadge');
  });

  // 验收标准 2 (回归): 真·手写笔记 (isPage=true, 无向量化) → 不显示任何状态
  it('shows nothing for a plain note page without vectorization', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: null,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: true,
      }),
    ).toBe('none');

    expect(
      getParsingStatusDisplay({
        chunkingStatus: undefined,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: true,
      }),
    ).toBe('none');
  });

  // 验收标准 3 (回归): 普通上传文件 (isPage=false) 已分块 → 状态标签不变
  it('shows status badge for a normal uploaded file that is chunked', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: AsyncTaskStatus.Success,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: false,
      }),
    ).toBe('statusBadge');
  });

  // 回归: 普通文件尚未分块 → 显示手动分块按钮
  it('shows the chunk button for a normal file that is not chunked yet', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: null,
        isCreatingFileParseTask: false,
        isFolder: false,
        isPage: false,
      }),
    ).toBe('chunkButton');
  });

  // 回归: 正在创建分块任务 → 显示(loading 的)分块按钮
  it('shows the chunk button while a parse task is being created', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: null,
        isCreatingFileParseTask: true,
        isFolder: false,
        isPage: false,
      }),
    ).toBe('chunkButton');
  });

  // 回归: 文件夹 → 不显示状态
  it('shows nothing for a folder', () => {
    expect(
      getParsingStatusDisplay({
        chunkingStatus: AsyncTaskStatus.Success,
        isCreatingFileParseTask: false,
        isFolder: true,
        isPage: false,
      }),
    ).toBe('none');
  });
});
