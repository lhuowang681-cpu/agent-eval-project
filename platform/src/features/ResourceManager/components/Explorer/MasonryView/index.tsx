'use client';

import { Center } from '@lobehub/ui';
import { VirtuosoMasonry } from '@virtuoso.dev/masonry';
import { cssVar } from 'antd-style';
import { type UIEvent } from 'react';
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { sortFileList } from '@/routes/(main)/resource/features/store/selectors';
import { useFileStore } from '@/store/file';
import { useFetchResources, useResourceData } from '@/store/file/slices/resource/hooks';
import {
  createResourceQueryParams,
  getResourceQueryKey,
} from '@/store/file/slices/resource/queryKey';
import { type FileListItem } from '@/types/files';

import { useMasonryColumnCount } from '../useMasonryColumnCount';
import MasonryItemWrapper from './MasonryItem/MasonryItemWrapper';
import MasonryViewSkeleton from './Skeleton';

const MasonryView = memo(function MasonryView() {
  // Access all state from Resource Manager store
  const [
    libraryId,
    category,
    selectedFileIds,
    setSelectedFileIds,
    setSelectAllResourceQueryKey,
    storeIsMasonryReady,
    sorter,
    sortType,
    storeIsTransitioning,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.selectedFileIds,
    s.setSelectedFileIds,
    s.setSelectAllResourceQueryKey,
    s.isMasonryReady,
    s.sorter,
    s.sortType,
    s.isTransitioning,
  ]);

  const { t } = useTranslation('file');
  const { currentFolderSlug } = useFolderPath();
  const columnCount = useMasonryColumnCount();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const queryParams = useMemo(
    () =>
      createResourceQueryParams({
        category,
        currentFolderSlug,
        libraryId,
        sortType,
        sorter,
      }),
    [category, currentFolderSlug, libraryId, sorter, sortType],
  );

  const { isLoading, isValidating } = useFetchResources(queryParams);
  const resourceData = useResourceData(queryParams);
  const [currentQueryParams, loadMoreResources] = useFileStore((s) => [
    s.queryParams,
    s.loadMoreResources,
  ]);
  const hasMore = resourceData?.hasMore ?? false;
  const queryKey = useMemo(() => getResourceQueryKey(queryParams), [queryParams]);
  const currentQueryKey = getResourceQueryKey(currentQueryParams);

  const isNavigating = useMemo(() => {
    if (resourceData) return false;
    if (!currentQueryKey) return false;

    return currentQueryKey !== queryKey;
  }, [currentQueryKey, queryKey, resourceData]);

  const resourceList = resourceData?.items ?? [];

  // Map ResourceItem[] to FileListItem[] for compatibility
  const rawData = resourceList?.map(
    (item): FileListItem => ({
      chunkCount: item.chunkCount ?? null,
      chunkingError: item.chunkingError ?? null,
      chunkingStatus: (item.chunkingStatus as any) ?? null,
      content: item.content,
      createdAt: item.createdAt,
      editorData: item.editorData,
      embeddingError: item.embeddingError ?? null,
      embeddingStatus: (item.embeddingStatus as any) ?? null,
      fileType: item.fileType,
      finishEmbedding: item.finishEmbedding ?? false,
      id: item.id,
      metadata: item.metadata,
      name: item.name,
      parentId: item.parentId,
      size: item.size,
      slug: item.slug,
      sourceType: item.sourceType,
      updatedAt: item.updatedAt,
      url: item.url ?? '',
    }),
  );

  // Sort data using current sort settings
  const data = sortFileList(rawData, sorter, sortType) || [];

  const dataLength = data.length;
  const effectiveIsLoading = isLoading ?? false;
  const effectiveIsNavigating = isNavigating ?? false;
  const effectiveIsValidating = isValidating ?? false;
  const effectiveIsTransitioning = storeIsTransitioning ?? false;
  const effectiveIsMasonryReady = storeIsMasonryReady;
  const hasCurrentResourceData = !!resourceData;

  const showSkeleton =
    !hasCurrentResourceData ||
    (effectiveIsLoading && dataLength === 0) ||
    (effectiveIsNavigating && effectiveIsValidating) ||
    effectiveIsTransitioning ||
    !effectiveIsMasonryReady;

  const masonryContext = useMemo(
    () => ({
      knowledgeBaseId: libraryId,
      selectFileIds: selectedFileIds,
      setSelectAllResourceQueryKey,
      setSelectedFileIds,
    }),
    [libraryId, selectedFileIds, setSelectAllResourceQueryKey, setSelectedFileIds],
  );

  // Handle automatic load more when scrolling to bottom
  const handleLoadMore = useCallback(async () => {
    if (!hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      await loadMoreResources(queryParams);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, loadMoreResources, isLoadingMore, queryParams]);

  // Handle scroll event to detect when near bottom
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const scrollTop = target.scrollTop;
      const scrollHeight = target.scrollHeight;
      const clientHeight = target.clientHeight;

      // Trigger load when within 300px of bottom
      if (scrollHeight - scrollTop - clientHeight < 300) {
        handleLoadMore();
      }
    },
    [handleLoadMore],
  );

  return showSkeleton ? (
    <MasonryViewSkeleton columnCount={columnCount} />
  ) : (
    <div
      style={{
        flex: 1,
        height: '100%',
        opacity: effectiveIsMasonryReady ? 1 : 0,
        overflowY: 'auto',
        transition: 'opacity 0.2s ease-in-out',
      }}
      onScroll={handleScroll}
    >
      <div style={{ paddingBlockEnd: 24, paddingBlockStart: 12, paddingInline: 24 }}>
        <VirtuosoMasonry
          ItemContent={MasonryItemWrapper}
          columnCount={columnCount}
          context={masonryContext}
          data={data}
          style={{
            gap: '16px',
            overflow: 'hidden',
          }}
        />
        {isLoadingMore && (
          <Center
            style={{
              color: cssVar.colorTextDescription,
              fontSize: 14,
              marginBlockStart: 16,
              minHeight: 40,
            }}
          >
            {t('loading', { defaultValue: 'Loading...' })}
          </Center>
        )}
      </div>
    </div>
  );
});

export default MasonryView;
