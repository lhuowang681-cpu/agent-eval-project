import { type ScopedMutator } from 'swr/_internal';

import { type BatchPublishResourceType } from '@/features/MarketPublish/types';
import { mutate as scopedMutate } from '@/libs/swr';

const LIST_PREFIXES: Record<BatchPublishResourceType, string[]> = {
  agent: ['assistant-list', 'my-assistant-list'],
  mcp: ['mcp-list', 'my-mcp-list'],
  skill: ['skill-list', 'my-skill-list'],
};

const isMarketListKey = (key: unknown, resourceType: BatchPublishResourceType) =>
  typeof key === 'string' && LIST_PREFIXES[resourceType].some((prefix) => key.startsWith(prefix));

export const refreshMarketListCache = async (
  resourceType: BatchPublishResourceType,
  mutateFn: ScopedMutator = scopedMutate,
) => {
  await Promise.all([
    mutateFn((key) => isMarketListKey(key, resourceType), undefined, { revalidate: true }),
    mutateFn('market-leaderboard', undefined, { revalidate: true }),
  ]);
};
