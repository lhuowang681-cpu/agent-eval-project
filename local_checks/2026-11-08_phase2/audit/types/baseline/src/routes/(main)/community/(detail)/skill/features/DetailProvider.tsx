'use client';

import { createContext, memo, type ReactNode, use } from 'react';

import { type DiscoverSkillDetail } from '@/types/discover';

export type DetailContextConfig = Partial<DiscoverSkillDetail> & {
  /** SWR mutate function to refresh detail data after delist/relist */
  mutate?: () => Promise<any>;
};

export const DetailContext = createContext<DetailContextConfig>({});

export const DetailProvider = memo<{ children: ReactNode; config?: DetailContextConfig }>(
  ({ children, config = {} }) => {
    return <DetailContext value={config}>{children}</DetailContext>;
  },
);

export const useDetailContext = () => {
  return use(DetailContext);
};
