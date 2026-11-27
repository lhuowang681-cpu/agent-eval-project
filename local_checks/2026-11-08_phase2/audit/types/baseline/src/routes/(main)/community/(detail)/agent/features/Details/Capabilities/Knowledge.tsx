import { Block, Empty, Flexbox } from '@lobehub/ui';
import { BookOpen } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useDetailContext } from '../../DetailProvider';
import KnowledgeItem from './KnowledgeItem';

const Knowledge = memo(() => {
  const { t } = useTranslation('discover');
  const { config } = useDetailContext();

  const knowledgeBaseIdentifiers = useMemo(
    () =>
      (config?.knowledgeBases || [])
        .map((item) => (typeof item === 'string' ? item : item.id))
        .filter(Boolean),
    [config?.knowledgeBases],
  );

  if (!knowledgeBaseIdentifiers.length)
    return (
      <Block variant={'outlined'}>
        <Empty
          description={t('assistants.details.capabilities.knowledge.desc')}
          descriptionProps={{ fontSize: 14 }}
          icon={BookOpen}
        />
      </Block>
    );

  return (
    <Flexbox gap={8}>
      {knowledgeBaseIdentifiers.map((identifier) => (
        <KnowledgeItem identifier={identifier} key={identifier} />
      ))}
    </Flexbox>
  );
});

export default Knowledge;
