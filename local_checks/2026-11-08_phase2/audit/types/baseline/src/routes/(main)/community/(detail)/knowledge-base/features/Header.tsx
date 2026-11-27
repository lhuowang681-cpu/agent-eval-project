'use client';

import { Avatar, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { DotIcon, DownloadIcon, FileTextIcon, FolderIcon } from 'lucide-react';
import { memo } from 'react';

import MarketMineTag from '@/components/MarketMineTag';
import PublishedTime from '@/components/PublishedTime';
import { useIsMarketPublisher } from '@/hooks/useIsMarketPublisher';

import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  author: css`
    color: ${cssVar.colorTextDescription};
  `,
  stat: css`
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
  time: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const formatCompactNumber = (num?: number): string => {
  if (!num) return '0';
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}k`;
  return `${(num / 1000000).toFixed(1)}M`;
};

const Header = memo<{ mobile?: boolean }>(({ mobile }) => {
  const {
    name,
    author,
    identifier,
    updatedAt,
    createdAt,
    installCount,
    avatar,
    publisherId,
    fileCount,
    documentCount,
    chunkCount,
  } = useDetailContext();

  const isMine = useIsMarketPublisher(publisherId);

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <Avatar avatar={avatar || name} size={mobile ? 48 : 64} />
        <Flexbox flex={1} gap={4} style={{ overflow: 'hidden' }}>
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <Text
              ellipsis
              as={'h1'}
              style={{ fontSize: mobile ? 18 : 24, margin: 0 }}
              title={identifier}
            >
              {name}
            </Text>
            {isMine && <MarketMineTag />}
          </Flexbox>
          <Flexbox horizontal align={'center'} className={styles.author} gap={4}>
            {author && <span>{author}</span>}
            <Icon icon={DotIcon} />
            <PublishedTime
              className={styles.time}
              date={(updatedAt || createdAt) as string}
              template={'MMM DD, YYYY'}
            />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={mobile ? 12 : 24}
        style={{ color: cssVar.colorTextSecondary }}
        wrap={'wrap'}
      >
        <Flexbox horizontal align={'center'} className={styles.stat} gap={6}>
          <Icon icon={DownloadIcon} size={14} />
          {formatCompactNumber(installCount ?? 0)}
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.stat} gap={6}>
          <Icon icon={FolderIcon} size={14} />
          {fileCount ?? 0}
        </Flexbox>
        <Flexbox horizontal align={'center'} className={styles.stat} gap={6}>
          <Icon icon={FileTextIcon} size={14} />
          {documentCount ?? 0}
        </Flexbox>
        {Boolean(chunkCount) && (
          <Flexbox horizontal align={'center'} className={styles.stat} gap={6}>
            {chunkCount} chunks
          </Flexbox>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
