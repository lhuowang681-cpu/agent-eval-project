import { useEffect } from 'react';

import { revalidateResources } from '@/store/file/slices/resource/hooks';
import { AsyncTaskStatus } from '@/types/asyncTask';
import { type FileListItem } from '@/types/files';

// 进行中 + 排队中都需持续轮询：批量导入（如飞书）时向量化在后台分批执行，
// 大量任务先处于 Pending 排队，若只盯 Processing 会在排队窗口漏掉轮询。
const ACTIVE_STATUSES = new Set<AsyncTaskStatus>([
  AsyncTaskStatus.Pending,
  AsyncTaskStatus.Processing,
]);

export const useCheckTaskStatus = (data: FileListItem[] | undefined) => {
  const isProcessing = data?.some(
    (item) =>
      (item.chunkingStatus && ACTIVE_STATUSES.has(item.chunkingStatus)) ||
      (item.embeddingStatus && ACTIVE_STATUSES.has(item.embeddingStatus)),
  );

  // Poll every 5s to check if chunking/embedding status has changed
  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      // Re-fetch with the same query params used for initial load
      revalidateResources();
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [isProcessing]);
};
