'use client';

import { Avatar, Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar, useResponsive } from 'antd-style';
import { ActivityIcon, DotIcon, DownloadIcon } from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import MarketMineTag from '@/components/MarketMineTag';
import { getRecommendedDeployment } from '@/features/MCP/utils';
import { useIsMarketPublisher } from '@/hooks/useIsMarketPublisher';
import { useCategory } from '@/hooks/useMCPCategory';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import InstallationIcon from '../../components/MCPDepsIcon';
import PublishedTime from '../../components/PublishedTime';
import { useDetailContext } from './DetailProvider';

const styles = createStaticStyles(({ css }) => {
  return {
    time: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
    version: css`
      font-family: ${cssVar.fontFamilyCode};
      font-size: 13px;
    `,
  };
});

const Header = memo<{ inModal?: boolean; mobile?: boolean }>(({ mobile: isMobile, inModal }) => {
  const { t } = useTranslation('discover');
  const {
    name,
    author,
    version,
    identifier,
    icon,
    updatedAt,
    createdAt,
    deploymentOptions = [],
    category,
    installCount,
    usageCount,
    publisherId,
  } = useDetailContext();
  const { mobile = isMobile } = useResponsive();

  const isMine = useIsMarketPublisher(publisherId);
  const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);

  const recommendedDeployment = getRecommendedDeployment(deploymentOptions);
  const categories = useCategory();
  const cate = categories.find((c) => c.key === category);
  const authorName = typeof author === 'string' ? author : author?.name;

  const cateButton = cate ? (
    <Link
      to={qs.stringifyUrl({
        query: { category: cate?.key },
        url: '/community/mcp',
      })}
    >
      <Button icon={cate?.icon} size={'middle'} variant={'outlined'}>
        {cate?.label}
      </Button>
    </Link>
  ) : null;

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'flex-start'} gap={16} width={'100%'}>
        <Avatar avatar={icon || name} shape={'square'} size={mobile ? 48 : 64} />
        <Flexbox
          flex={1}
          gap={4}
          style={{
            overflow: 'hidden',
          }}
        >
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
            <Flexbox horizontal align={'center'} flex={1} gap={12} style={{ overflow: 'hidden' }}>
              <Text
                ellipsis
                as={'h1'}
                style={{ fontSize: inModal ? 20 : mobile ? 18 : 24, margin: 0 }}
                title={identifier}
              >
                {name}
              </Text>
              {isMine && <MarketMineTag />}
              {recommendedDeployment?.installationMethod && (
                <InstallationIcon type={recommendedDeployment.installationMethod} />
              )}
            </Flexbox>
          </Flexbox>
          <Flexbox horizontal align={'center'} gap={4}>
            <div className={styles.version}>{version}</div>
            <Icon icon={DotIcon} />
            {authorName && <span>{authorName}</span>}
            <Icon icon={DotIcon} />
            <PublishedTime className={styles.time} date={(updatedAt || createdAt) as string} />
          </Flexbox>
        </Flexbox>
      </Flexbox>
      <Flexbox
        horizontal
        align={'center'}
        gap={mobile ? 12 : 24}
        wrap={'wrap'}
        style={{
          color: cssVar.colorTextSecondary,
        }}
      >
        {!mobile && cateButton}
        {showMarketStats !== false && (
          <>
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={DownloadIcon} size={14} />
              {installCount ?? 0} {t('assistants.installCount')}
            </Flexbox>
            <Flexbox horizontal align={'center'} gap={6}>
              <Icon icon={ActivityIcon} size={14} />
              {usageCount ?? 0} {t('home.leaderboard.usageCount')}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default Header;
