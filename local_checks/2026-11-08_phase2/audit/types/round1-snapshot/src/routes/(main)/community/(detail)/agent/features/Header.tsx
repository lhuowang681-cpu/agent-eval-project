'use client';

import { MCP } from '@lobehub/icons';
import { Avatar, Button, Flexbox, Icon, Tag, Text, Tooltip, TooltipGroup } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { ActivityIcon, BookTextIcon, CoinsIcon, DotIcon, DownloadIcon } from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import MarketMineTag from '@/components/MarketMineTag';
import PublishedTime from '@/components/PublishedTime';
import { useIsMarketPublisher } from '@/hooks/useIsMarketPublisher';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { formatIntergerNumber } from '@/utils/format';

import { useCategory } from '../../../(list)/agent/features/Category/useCategory';
import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css, cssVar }) => ({
  time: css`
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
}));

const Header = memo<{ mobile?: boolean }>(({ mobile: isMobile }) => {
  const { t } = useTranslation('discover');
  const {
    author,
    identifier,
    createdAt,
    category,
    avatar,
    title,
    tokenUsage,
    knowledgeCount,
    installCount,
    usageCount,
    config,
    publisherId,
  } = useDetailContext();

  const isMine = useIsMarketPublisher(publisherId);
  const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);

  // Use plugins.length as the source of truth for pluginCount
  const pluginCount = config?.plugins?.length || 0;
  const { mobile = isMobile } = useResponsive();

  const categories = useCategory();
  const cate = categories.find((c) => c.key === category);

  const cateButton = (
    <Link
      to={qs.stringifyUrl({
        query: { category: cate?.key },
        url: '/community/agent',
      })}
    >
      <Button icon={cate?.icon} size={'middle'} variant={'outlined'}>
        {cate?.label}
      </Button>
    </Link>
  );

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <Avatar avatar={avatar} shape={'square'} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox horizontal align={'center'} gap={8} style={{ overflow: 'hidden' }}>
            <Text
              ellipsis
              as={'h1'}
              style={{ fontSize: mobile ? 18 : 24, margin: 0 }}
              title={identifier}
            >
              {title}
            </Text>
            {isMine && <MarketMineTag />}
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
            {author}
            <Icon icon={DotIcon} />
            <PublishedTime className={styles.time} date={createdAt as string} />
            {showMarketStats !== false && (
              <>
                <Tag bordered={false} color="default" icon={<Icon icon={DownloadIcon} />}>
                  {installCount ?? 0} {t('assistants.installCount')}
                </Tag>
                <Tag bordered={false} color="default" icon={<Icon icon={ActivityIcon} />}>
                  {usageCount ?? 0} {t('home.leaderboard.usageCount')}
                </Tag>
              </>
            )}
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <TooltipGroup>
        <Flexbox
          horizontal
          align={'center'}
          gap={mobile ? 12 : 24}
          style={{
            color: cssVar.colorTextSecondary,
          }}
        >
          {!mobile && cate ? cateButton : null}
          {Boolean(tokenUsage) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.tokenUsage')}
            >
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon icon={CoinsIcon} />
                {formatIntergerNumber(tokenUsage)}
              </Flexbox>
            </Tooltip>
          )}
          {Boolean(pluginCount) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.withPlugin')}
            >
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon fill={cssVar.colorTextSecondary} icon={MCP} />
                {pluginCount}
              </Flexbox>
            </Tooltip>
          )}
          {Boolean(knowledgeCount) && (
            <Tooltip
              styles={{ root: { pointerEvents: 'none' } }}
              title={t('assistants.withKnowledge')}
            >
              <Flexbox horizontal align={'center'} gap={6}>
                <Icon icon={BookTextIcon} />
                {knowledgeCount}
              </Flexbox>
            </Tooltip>
          )}
        </Flexbox>
      </TooltipGroup>
    </Flexbox>
  );
});

export default Header;
