import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileStore } from '@/store/file';
import { getResourceQueryKey } from '@/store/file/slices/resource/queryKey';
import { FilesTabs, SortType } from '@/types/files';
import type { ResourceQueryParams } from '@/types/resource';

import { useResourceManagerStore } from '.';

vi.mock('@/store/electron', () => ({
  getElectronStoreState: vi.fn(() => ({})),
  useElectronStore: vi.fn(),
}));

vi.mock('@ctrip/vampire-core', () => ({
  triplog: {
    custom: vi.fn(),
    setTraceContext: vi.fn(),
  },
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  message: {
    destroy: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

vi.mock('p-map', async () => {
  const realPMap = await vi.importActual('p-map');
  return { default: (realPMap as any).default };
});

const queryParams: ResourceQueryParams = {
  category: FilesTabs.All,
  parentId: null,
  showFilesInKnowledgeBase: false,
  sorter: 'createdAt',
  sortType: SortType.Desc,
};

beforeEach(() => {
  vi.clearAllMocks();

  useFileStore.setState(
    {
      activeResourceKey: undefined,
      hasMore: false,
      isLoadingMore: false,
      offset: 0,
      queryParams: undefined,
      resourceDataMap: {},
      resourceList: [],
      resourceMap: new Map(),
      total: 0,
    },
    false,
  );

  useResourceManagerStore.setState(
    {
      selectAllResourceQueryKey: null,
      selectedFileIds: [],
    },
    false,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ResourceManager store selection actions', () => {
  describe('syncSelectedFileIdsForResourceQuery', () => {
    it('adds newly loaded ids to selection when current query is continuously selected', () => {
      const queryKey = getResourceQueryKey(queryParams);

      useResourceManagerStore.setState(
        {
          selectAllResourceQueryKey: queryKey,
          selectedFileIds: ['resource-1', 'resource-2'],
        },
        false,
      );

      useResourceManagerStore
        .getState()
        .syncSelectedFileIdsForResourceQuery(queryKey, [
          'resource-1',
          'resource-2',
          'resource-3',
          'resource-4',
        ]);

      expect(useResourceManagerStore.getState().selectedFileIds).toEqual([
        'resource-1',
        'resource-2',
        'resource-3',
        'resource-4',
      ]);
    });

    it('keeps previously selected ids and merges newly loaded ids without duplicates', () => {
      const queryKey = getResourceQueryKey(queryParams);

      useResourceManagerStore.setState(
        {
          selectAllResourceQueryKey: queryKey,
          selectedFileIds: ['resource-1', 'resource-2'],
        },
        false,
      );

      useResourceManagerStore
        .getState()
        .syncSelectedFileIdsForResourceQuery(queryKey, ['resource-1', 'resource-2', 'resource-3']);

      const ids = useResourceManagerStore.getState().selectedFileIds;

      expect(ids).toHaveLength(3);
      expect(new Set(ids)).toEqual(new Set(['resource-1', 'resource-2', 'resource-3']));
    });

    it('does not change selection when the continuous select query does not match', () => {
      useResourceManagerStore.setState(
        {
          selectAllResourceQueryKey: 'another-query',
          selectedFileIds: ['resource-1', 'resource-2'],
        },
        false,
      );

      useResourceManagerStore
        .getState()
        .syncSelectedFileIdsForResourceQuery(getResourceQueryKey(queryParams), [
          'resource-1',
          'resource-2',
          'resource-3',
          'resource-4',
        ]);

      expect(useResourceManagerStore.getState().selectedFileIds).toEqual([
        'resource-1',
        'resource-2',
      ]);
    });
  });

  it('clears continuous select state after batch delete', async () => {
    useResourceManagerStore.setState(
      {
        selectAllResourceQueryKey: 'selected-query',
        selectedFileIds: ['resource-1', 'resource-2'],
      },
      false,
    );

    vi.spyOn(useFileStore.getState(), 'deleteResources').mockResolvedValue(undefined);

    await useResourceManagerStore.getState().onActionClick('delete');

    expect(useResourceManagerStore.getState().selectedFileIds).toEqual([]);
    expect(useResourceManagerStore.getState().selectAllResourceQueryKey).toBeNull();
  });
});
