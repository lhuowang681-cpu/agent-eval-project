import type { FilesTabs, SortType } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

interface CreateResourceQueryParamsOptions {
  category: FilesTabs;
  currentFolderSlug?: string | null;
  libraryId?: string;
  sorter: 'name' | 'createdAt' | 'size';
  sortType: SortType;
}

export const createResourceQueryParams = ({
  category,
  currentFolderSlug,
  libraryId,
  sorter,
  sortType,
}: CreateResourceQueryParamsOptions): ResourceQueryParams => ({
  category: libraryId ? undefined : category,
  libraryId,
  parentId: currentFolderSlug || null,
  showFilesInKnowledgeBase: false,
  sorter,
  sortType,
});

export const getResourceQueryKey = (params?: ResourceQueryParams | null) => {
  if (!params) return '';

  return JSON.stringify({
    category: params.category ?? null,
    libraryId: params.libraryId ?? null,
    parentId: params.parentId ?? null,
    q: params.q ?? null,
    showFilesInKnowledgeBase: params.showFilesInKnowledgeBase ?? false,
    sorter: params.sorter ?? null,
    sortType: params.sortType ?? null,
  });
};
