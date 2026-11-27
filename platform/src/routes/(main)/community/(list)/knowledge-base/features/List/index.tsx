'use client';

import { Grid } from '@lobehub/ui';
import { memo } from 'react';

import { type DiscoverKnowledgeBaseItem } from '@/types/discover';

import KnowledgeBaseEmpty from '../../../../features/KnowledgeBaseEmpty';
import Item from './Item';

interface ListProps {
  data?: DiscoverKnowledgeBaseItem[];
  rows?: number;
}

const List = memo<ListProps>(({ data = [], rows = 3 }) => {
  if (data.length === 0) return <KnowledgeBaseEmpty />;

  return (
    <Grid rows={rows} width={'100%'}>
      {data.map((item) => (
        <Item key={item.identifier} {...item} />
      ))}
    </Grid>
  );
});

export default List;
