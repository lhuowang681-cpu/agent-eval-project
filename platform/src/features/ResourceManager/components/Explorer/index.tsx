'use client';

import { Flexbox } from '@lobehub/ui';
import { memo, useEffect, useMemo } from 'react';

import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import { useResourceManagerUrlSync } from '@/routes/(main)/resource/features/hooks/useResourceManagerUrlSync';
import { useResourceManagerStore } from '@/routes/(main)/resource/features/store';
import { sortFileList } from '@/routes/(main)/resource/features/store/selectors';
import { useFetchResources, useResourceData } from '@/store/file/slices/resource/hooks';
import {
  createResourceQueryParams,
  getResourceQueryKey,
} from '@/store/file/slices/resource/queryKey';

import EmptyPlaceholder from './EmptyPlaceholder';
import Header from './Header';
import ListView from './ListView';
import MasonryView from './MasonryView';
import SearchResultsOverlay from './SearchResultsOverlay';
import { useCheckTaskStatus } from './useCheckTaskStatus';
import { useResourceExplorer } from './useResourceExplorer';

/**
 * Explore resource items in a library
 *
 * Works with FileTree
 *
 * It's a un-reusable component for business logic only.
 * So we depend on context, not props.
 */
const ResourceExplorer = memo(() => {
  // Sync store state with URL query parameters
  useResourceManagerUrlSync();

  // Get state from Resource Manager store
  const [
    libraryId,
    category,
    viewMode,
    searchQuery,
    selectAllResourceQueryKey,
    setSelectedFileIds,
    setSelectAllResourceQueryKey,
    sorter,
    sortType,
    syncSelectedFileIdsForResourceQuery,
  ] = useResourceManagerStore((s) => [
    s.libraryId,
    s.category,
    s.viewMode,
    s.searchQuery,
    s.selectAllResourceQueryKey,
    s.setSelectedFileIds,
    s.setSelectAllResourceQueryKey,
    s.sorter,
    s.sortType,
    s.syncSelectedFileIdsForResourceQuery,
  ]);

  // searchQuery is still subscribed above for selection-clearing effect below

  // Get folder path for empty state check
  const { currentFolderSlug } = useFolderPath();

  // Build query params for SWR
  const queryParams = useMemo(
    () =>
      createResourceQueryParams({
        category,
        currentFolderSlug,
        libraryId,
        sortType,
        sorter,
      }),
    [category, libraryId, currentFolderSlug, sortType, sorter],
  );

  // Use SWR for data fetching with automatic caching and revalidation
  const { isLoading, isValidating } = useFetchResources(queryParams);

  // Get resource data from store for the current query key only.
  const resourceData = useResourceData(queryParams);
  const resourceList = resourceData?.items ?? [];
  const queryKey = useMemo(() => getResourceQueryKey(queryParams), [queryParams]);
  const resourceIds = useMemo(
    () => resourceData?.items?.map((item) => item.id) ?? [],
    [resourceData?.items],
  );

  // Map ResourceItem[] to FileListItem[] for compatibility
  // TODO: Eventually update all consumers to use ResourceItem directly
  const rawData = resourceList?.map((item) => ({
    ...item,
    // Ensure all FileListItem fields are present with proper types
    chunkCount: item.chunkCount ?? null,
    chunkingError: item.chunkingError ?? null,
    chunkingStatus: (item.chunkingStatus ?? null) as any,
    embeddingError: item.embeddingError ?? null,
    embeddingStatus: (item.embeddingStatus ?? null) as any,
    finishEmbedding: item.finishEmbedding ?? false,
    url: item.url ?? '',
  }));

  // Sort data using current sort settings
  const data = sortFileList(rawData, sorter, sortType);

  // Check task status
  useCheckTaskStatus(data);

  // Initialize folder/file navigation effects (still need hook for complex effects)
  useResourceExplorer({ category, libraryId });

  useEffect(() => {
    syncSelectedFileIdsForResourceQuery(queryKey, resourceIds);
  }, [queryKey, resourceIds, selectAllResourceQueryKey, syncSelectedFileIdsForResourceQuery]);

  // Clear selections when the current resource query scope changes.
  useEffect(() => {
    setSelectedFileIds([]);
    setSelectAllResourceQueryKey(null);
  }, [
    category,
    currentFolderSlug,
    libraryId,
    searchQuery,
    setSelectAllResourceQueryKey,
    setSelectedFileIds,
    sorter,
    sortType,
  ]);

  const showEmptyStatus =
    !!resourceData && !isLoading && !isValidating && data?.length === 0 && !currentFolderSlug;

  return (
    <Flexbox height={'100%'}>
      <Header />
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {showEmptyStatus ? (
          <EmptyPlaceholder />
        ) : viewMode === 'list' ? (
          <ListView />
        ) : (
          <MasonryView />
        )}
        <SearchResultsOverlay />
      </div>
    </Flexbox>
  );
});

ResourceExplorer.displayName = 'ResourceExplorer';

export default ResourceExplorer;
