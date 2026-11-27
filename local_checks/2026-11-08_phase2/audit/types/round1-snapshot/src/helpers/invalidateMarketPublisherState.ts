import type { MarketPublisherResourceType } from '@/helpers/marketPublisherActionState';
import { mutate } from '@/libs/swr';
import { communityApiService } from '@/services/marketApi';
import { useKnowledgeBaseStore } from '@/store/library';
import { useToolStore } from '@/store/tool';

export const MARKET_PUBLISHER_STATES_KEY = 'market-publisher-states';

export interface MarketPublisherStatesResponse {
  agents: MarketPublisherStateRecord[];
  knowledgeBases: MarketPublisherStateRecord[];
  mcps: MarketPublisherStateRecord[];
  skills: MarketPublisherStateRecord[];
}

export interface MarketPublisherStateRecord {
  category: string | null;
  deletedAt: Date | string | null;
  identifier: string;
  status: string;
}

const listKeyMap = {
  agent: 'agents',
  knowledgeBase: 'knowledgeBases',
  mcp: 'mcps',
  skill: 'skills',
} as const satisfies Record<MarketPublisherResourceType, keyof MarketPublisherStatesResponse>;

export const refreshMarketPublisherState = async () => {
  const data = await communityApiService.getPublisherResourceStates();
  await mutate(MARKET_PUBLISHER_STATES_KEY, data, { revalidate: false });
  return data;
};

export const markPublisherResourceRelisted = async (
  marketIdentifier: string,
  resourceType: MarketPublisherResourceType,
) => {
  const current = await mutate<MarketPublisherStatesResponse>(MARKET_PUBLISHER_STATES_KEY);

  if (!current) return;

  const listKey = listKeyMap[resourceType];
  const next: MarketPublisherStatesResponse = {
    ...current,
    [listKey]: current[listKey].map((item) =>
      item.identifier === marketIdentifier
        ? { ...item, deletedAt: null, status: 'published' }
        : item,
    ),
  };

  await mutate(MARKET_PUBLISHER_STATES_KEY, next, { revalidate: false });
};

export const markPublisherResourceDelisted = async (
  marketIdentifier: string,
  resourceType: MarketPublisherResourceType,
) => {
  const current = await mutate<MarketPublisherStatesResponse>(MARKET_PUBLISHER_STATES_KEY);

  if (!current) return;

  const listKey = listKeyMap[resourceType];
  const next: MarketPublisherStatesResponse = {
    ...current,
    [listKey]: current[listKey].map((item) =>
      item.identifier === marketIdentifier
        ? { ...item, deletedAt: new Date().toISOString(), status: 'unpublished' }
        : item,
    ),
  };

  await mutate(MARKET_PUBLISHER_STATES_KEY, next, { revalidate: false });
};

export const invalidateMarketPublisherState = async () => {
  await Promise.all([
    refreshMarketPublisherState(),
    useToolStore.getState().refreshPlugins(),
    useToolStore.getState().refreshAgentSkills(),
    useKnowledgeBaseStore.getState().refreshKnowledgeBaseList(),
  ]);
};
