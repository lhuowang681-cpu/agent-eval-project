import useSWR from 'swr';

import {
  MARKET_PUBLISHER_STATES_KEY,
  type MarketPublisherStateRecord,
  type MarketPublisherStatesResponse,
} from '@/helpers/invalidateMarketPublisherState';
import {
  computeMarketPublisherActionState,
  type MarketPublisherResourceType,
  type MarketPublisherState,
  type MarketPublisherStateInput,
} from '@/helpers/marketPublisherActionState';
import { communityApiService } from '@/services/marketApi';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/slices/auth/selectors';

export type { MarketPublisherStateRecord, MarketPublisherStatesResponse };

export type MarketPublisherStateResult = MarketPublisherState & {
  isRefreshing: boolean;
};

const useMarketPublisherStates = () => {
  const isLogin = useUserStore(authSelectors.isLogin);

  return useSWR(isLogin ? MARKET_PUBLISHER_STATES_KEY : null, () =>
    communityApiService.getPublisherResourceStates(),
  );
};

export const useMarketPublisherState = (
  input: MarketPublisherStateInput,
  resourceType: MarketPublisherResourceType,
  enabled = true,
): MarketPublisherStateResult => {
  const { data, isValidating } = useMarketPublisherStates();

  const records =
    resourceType === 'agent'
      ? data?.agents
      : resourceType === 'skill'
        ? data?.skills
        : resourceType === 'mcp'
          ? data?.mcps
          : data?.knowledgeBases;

  const marketRecord = input.marketIdentifier
    ? records?.find((item) => item.identifier === input.marketIdentifier)
    : undefined;

  const shouldTrackRefresh = enabled && Boolean(input.marketIdentifier);
  const isRefreshing = shouldTrackRefresh && isValidating;

  const result = computeMarketPublisherActionState(
    {
      ...input,
      marketDeletedAt: marketRecord?.deletedAt,
    },
    resourceType,
  );

  return {
    ...result,
    isRefreshing,
  };
};

export const useMarketPublisherStateByIdentifier = (
  marketIdentifier: string | undefined,
  resourceType: MarketPublisherResourceType,
) => {
  const { data } = useMarketPublisherStates();

  const records =
    resourceType === 'agent'
      ? data?.agents
      : resourceType === 'skill'
        ? data?.skills
        : resourceType === 'mcp'
          ? data?.mcps
          : data?.knowledgeBases;

  return marketIdentifier
    ? records?.find((item) => item.identifier === marketIdentifier)
    : undefined;
};
