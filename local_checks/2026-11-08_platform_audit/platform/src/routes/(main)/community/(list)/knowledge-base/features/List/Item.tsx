'use client';

import { Avatar, Block, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon, FileTextIcon, FolderIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';

import MarketDelistedTag from '@/components/MarketDelistedTag';
import MarketMineTag from '@/components/MarketMineTag';
import PublishedTime from '@/components/PublishedTime';
import { useIsMarketPublisher } from '@/hooks/useIsMarketPublisher';
import { useQuery } from '@/hooks/useQuery';
import { type DiscoverKnowledgeBaseItem } from '@/types/discover';

import MetaInfo from '../../../skill/features/List/MetaInfo';

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`
    color: ${cssVar.colorTextDescription};
  `,
  desc: css`
    flex: 1;
    margin: 0 !important;
    color: ${cssVar.colorTextSecondary};
  `,
  footer: css`
    margin-block-start: 16px;
    border-block-start: 1px dashed ${cssVar.colorBorder};
    background: ${cssVar.colorBgContainer};
  `,
  secondaryDesc: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  title: css`
    margin: 0 !important;
    font-size: 16px !important;
    font-weight: 500 !important;

    &:hover {
      color: ${cssVar.colorLink};
    }
  `,
}));

const KnowledgeBaseItem = memo<DiscoverKnowledgeBaseItem>(
  ({
    name,
    avatar,
    author,
    description,
    identifier,
    updatedAt,
    installCount,
    fileCount = 0,
    documentCount = 0,
    publisherId,
    deletedAt,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const isMine = useIsMarketPublisher(publisherId);
    const { mine } = useQuery() as { mine?: string };
    const showDelistedTag = mine === 'true' && isMine && Boolean(deletedAt);
    const link = `/community/knowledge-base/${identifier}`;

    const handleClick = useCallback(() => {
      navigate(link);
    }, [link, navigate]);

    return (
      <Block
        clickable
        height={'100%'}
        style={{ overflow: 'hidden' }}
        variant={'outlined'}
        width={'100%'}
        onClick={handleClick}
      >
        <Flexbox horizontal align={'flex-start'} gap={16} justify={'space-between'} padding={16}>
          <Flexbox horizontal gap={12} style={{ overflow: 'hidden' }}>
            <Avatar
              avatar={avatar || <Icon icon={FolderIcon} />}
              size={40}
              style={{ flex: 'none' }}
            />
            <Flexbox flex={1} gap={6} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
                <Link style={{ color: 'inherit', overflow: 'hidden' }} to={link}>
                  <Text ellipsis as={'h2'} className={styles.title}>
                    {name}
                  </Text>
                </Link>
                {isMine && <MarketMineTag />}
                {showDelistedTag && <MarketDelistedTag />}
              </Flexbox>
              {author && <div className={styles.author}>{author}</div>}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <Text as={'p'} className={styles.desc} ellipsis={{ rows: 3 }}>
            {description || t('knowledgeBases.emptyDescription')}
          </Text>
          <Flexbox horizontal align={'center'} className={styles.secondaryDesc} gap={8}>
            <Tag icon={<Icon icon={FileTextIcon} />} size={'small'} variant={'filled'}>
              {documentCount}
            </Tag>
            <Tag icon={<Icon icon={FolderIcon} />} size={'small'} variant={'filled'}>
              {fileCount}
            </Tag>
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox horizontal align={'center'} gap={4}>
            <Icon className={styles.secondaryDesc} icon={ClockIcon} size={14} />
            <PublishedTime className={styles.secondaryDesc} date={updatedAt} />
          </Flexbox>
          <MetaInfo className={styles.secondaryDesc} installCount={installCount} />
        </Flexbox>
      </Block>
    );
  },
);

export default KnowledgeBaseItem;
