import { type EmptyProps } from '@lobehub/ui';
import { Center, Empty } from '@lobehub/ui';
import { LibraryBig } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface KnowledgeBaseEmptyProps extends Omit<EmptyProps, 'icon'> {
  search?: boolean;
}

const KnowledgeBaseEmpty = memo<KnowledgeBaseEmptyProps>(({ search, ...rest }) => {
  const { t } = useTranslation('discover');

  return (
    <Center height="100%" style={{ minHeight: '50vh' }} width="100%">
      <Empty
        description={search ? t('knowledgeBaseEmpty.search') : t('knowledgeBaseEmpty.description')}
        descriptionProps={{ fontSize: 14 }}
        icon={LibraryBig}
        style={{ maxWidth: 400 }}
        title={search ? undefined : t('knowledgeBaseEmpty.title')}
        type={search ? 'default' : 'page'}
        {...rest}
      />
    </Center>
  );
});

KnowledgeBaseEmpty.displayName = 'KnowledgeBaseEmpty';

export default KnowledgeBaseEmpty;
