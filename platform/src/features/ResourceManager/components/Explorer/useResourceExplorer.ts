import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useFolderPath } from '@/routes/(main)/resource/features/hooks/useFolderPath';
import {
  useResourceManagerFetchFolderBreadcrumb,
  useResourceManagerStore,
} from '@/routes/(main)/resource/features/store';
import { useResourceData } from '@/store/file/slices/resource/hooks';
import { createResourceQueryParams } from '@/store/file/slices/resource/queryKey';
import { type FilesTabs } from '@/types/files';

interface UseFileExplorerProps {
  category?: FilesTabs;
  libraryId?: string;
}

export const useResourceExplorer = ({ category, libraryId }: UseFileExplorerProps) => {
  const [, setSearchParams] = useSearchParams();

  // Get state from Resource Manager store
  const [
    viewMode,
    isTransitioning,
    storeCategory,
    sorter,
    sortType,
    setCurrentFolderId,
    setIsTransitioning,
    setIsMasonryReady,
    handleBackToList,
  ] = useResourceManagerStore((s) => [
    s.viewMode,
    s.isTransitioning,
    s.category,
    s.sorter,
    s.sortType,
    s.setCurrentFolderId,
    s.setIsTransitioning,
    s.setIsMasonryReady,
    s.handleBackToList,
  ]);

  // Folder navigation
  const { currentFolderSlug } = useFolderPath();

  // Folder operations
  const { data: folderBreadcrumb } = useResourceManagerFetchFolderBreadcrumb(currentFolderSlug);

  const effectiveCategory = category ?? storeCategory;
  const queryParams = useMemo(
    () =>
      effectiveCategory
        ? createResourceQueryParams({
            category: effectiveCategory,
            currentFolderSlug,
            libraryId,
            sorter,
            sortType,
          })
        : null,
    [effectiveCategory, currentFolderSlug, libraryId, sorter, sortType],
  );
  const resourceData = useResourceData(queryParams);
  const resourceCount = resourceData?.items.length ?? 0;

  // Effects - Folder navigation
  useEffect(() => {
    if (!currentFolderSlug) {
      setCurrentFolderId(null);
    } else if (folderBreadcrumb && folderBreadcrumb.length > 0) {
      const currentFolder = folderBreadcrumb.at(-1);
      setCurrentFolderId(currentFolder?.id ?? null);
    }
  }, [currentFolderSlug, folderBreadcrumb, setCurrentFolderId]);

  // Handle view mode transition effects
  useEffect(() => {
    if (viewMode === 'masonry') {
      setIsTransitioning(true);
      setIsMasonryReady(false);
    }
  }, [viewMode, setIsTransitioning, setIsMasonryReady]);

  useEffect(() => {
    if (isTransitioning) {
      requestAnimationFrame(() => {
        const timer = setTimeout(() => {
          setIsTransitioning(false);
        }, 100);
        return () => clearTimeout(timer);
      });
    }
  }, [isTransitioning, resourceCount, setIsTransitioning]);

  useEffect(() => {
    if (viewMode === 'masonry' && !isTransitioning) {
      const timer = setTimeout(() => {
        setIsMasonryReady(true);
      }, 300);
      return () => clearTimeout(timer);
    } else if (viewMode === 'list') {
      setIsMasonryReady(false);
    }
  }, [viewMode, resourceCount, isTransitioning, setIsMasonryReady]);

  return {
    handleBackToList: () => {
      handleBackToList();
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        newParams.delete('file');
        return newParams;
      });
    },
  };
};
