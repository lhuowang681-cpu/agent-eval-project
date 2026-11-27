import { Avatar, Block, Flexbox, Skeleton, Tag, Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useDiscoverStore } from '@/store/discover';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    clickable: css`
      cursor: pointer;

      &:hover {
        .knowledge-title {
          color: ${cssVar.colorLink};
        }
      }
    `,
    desc: css`
      flex: 1;
      margin: 0 !important;
      font-size: 14px !important;
      color: ${cssVar.colorTextSecondary};
    `,
    noLink: css`
      cursor: default;
    `,
    tag: css`
      flex-shrink: 0;
    `,
    title: css`
      margin: 0 !important;
      font-size: 14px !important;
      font-weight: 500 !important;
    `,
    titleRow: css`
      display: flex;
      gap: 8px;
      align-items: center;
    `,
  };
});

interface KnowledgeItemProps {
  identifier: string;
}

const KnowledgeItem = memo<KnowledgeItemProps>(({ identifier }) => {
  const { t } = useTranslation('discover');
  const useFetchKnowledgeBaseDetail = useDiscoverStore((s) => s.useFetchKnowledgeBaseDetail);
  const { data, isLoading } = useFetchKnowledgeBaseDetail({ identifier });

  if (isLoading) {
    return (
      <Block horizontal gap={12} padding={12} variant={'outlined'}>
        <Skeleton paragraph={{ rows: 1 }} title={false} />
      </Block>
    );
  }

  if (!data) return null;

  const isPublic = data.visibility === 'public';
  const title = data.name || identifier;
  const description = data.description || '';
  const avatar = data.avatar || identifier;

  const content = (
    <Block
      horizontal
      className={cx(isPublic ? styles.clickable : styles.noLink)}
      gap={12}
      padding={12}
      variant={'outlined'}
    >
      <Avatar avatar={avatar} shape={'square'} size={40} style={{ flex: 'none' }} />
      <Flexbox
        flex={1}
        gap={6}
        style={{
          overflow: 'hidden',
        }}
      >
        <div className={styles.titleRow}>
          <Text ellipsis as={'h2'} className={cx(styles.title, 'knowledge-title')}>
            {title}
          </Text>
          {!isPublic && (
            <Tag className={styles.tag} color="gold" size={'small'}>
              {t('knowledgeBases.bundledTag', { defaultValue: '内置' })}
            </Tag>
          )}
        </div>
        <Text
          as={'p'}
          className={styles.desc}
          ellipsis={{
            rows: 2,
          }}
        >
          {description}
        </Text>
      </Flexbox>
    </Block>
  );

  if (!isPublic) return content;

  return (
    <Link
      style={{ color: 'inherit', textDecoration: 'none' }}
      to={`/community/knowledge-base/${identifier}`}
    >
      {content}
    </Link>
  );
});

export default KnowledgeItem;
