'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ClockIcon } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import MarketDelistedTag from '@/components/MarketDelistedTag';
import MarketMineTag from '@/components/MarketMineTag';
import InstallationIcon from '@/components/MCPDepsIcon';
import PluginAvatar from '@/components/Plugins/PluginAvatar';
import PublishedTime from '@/components/PublishedTime';
import { DEFAULT_MCP_MARKET_ICON } from '@/const/marketIcon';
import { useIsMarketPublisher } from '@/hooks/useIsMarketPublisher';
import { useQuery } from '@/hooks/useQuery';
import { discoverService } from '@/services/discover';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { type DiscoverMcpItem } from '@/types/discover';

import ConnectionTypeTag from './ConnectionTypeTag';
import MetaInfo from './MetaInfo';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    author: css`
      color: ${cssVar.colorTextDescription};
    `,
    code: css`
      font-family: ${cssVar.fontFamilyCode};
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
  };
});

const McpItem = memo<DiscoverMcpItem>(
  ({
    name,
    icon,
    author,
    description,
    identifier,
    category,
    toolsCount: _toolsCount,
    updatedAt,
    installationMethods,
    promptsCount: _promptsCount,
    resourcesCount: _resourcesCount,
    connectionType,
    installCount,
    usageCount,
    publisherId,
    deletedAt,
  }) => {
    const { t } = useTranslation('discover');
    const navigate = useNavigate();
    const isMine = useIsMarketPublisher(publisherId);
    const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);
    const { mine } = useQuery() as { mine?: string };
    const showDelistedTag = mine === 'true' && isMine && Boolean(deletedAt);
    const shouldShowMarketStats = showMarketStats !== false;
    const link = urlJoin('/community/mcp', identifier);

    const handleClick = useCallback(() => {
      discoverService
        .reportMcpEvent({
          event: 'click',
          identifier,
          source: location.pathname,
        })
        .catch(() => {});

      navigate(link);
    }, [identifier, link, navigate]);

    return (
      <Block
        clickable
        data-testid="mcp-item"
        height={'100%'}
        variant={'outlined'}
        width={'100%'}
        style={{
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={handleClick}
      >
        <Flexbox
          horizontal
          align={'flex-start'}
          gap={16}
          justify={'space-between'}
          padding={16}
          width={'100%'}
        >
          <Flexbox
            horizontal
            gap={12}
            title={identifier}
            style={{
              overflow: 'hidden',
            }}
          >
            <PluginAvatar avatar={icon || DEFAULT_MCP_MARKET_ICON} size={40} />
            <Flexbox
              flex={1}
              gap={2}
              style={{
                overflow: 'hidden',
              }}
            >
              <Flexbox
                horizontal
                align={'center'}
                flex={1}
                gap={8}
                style={{
                  overflow: 'hidden',
                }}
              >
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
          {installationMethods && <InstallationIcon type={installationMethods} />}
        </Flexbox>
        <Flexbox flex={1} gap={12} paddingInline={16}>
          <Text
            as={'p'}
            className={styles.desc}
            ellipsis={{
              rows: 3,
            }}
          >
            {description}
          </Text>
          <Flexbox horizontal align={'center'} className={styles.secondaryDesc}>
            <ConnectionTypeTag type={connectionType} />
          </Flexbox>
        </Flexbox>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.footer}
          justify={'space-between'}
          padding={16}
        >
          <Flexbox horizontal align={'center'} className={styles.secondaryDesc} gap={8}>
            <Flexbox horizontal align={'center'} gap={4}>
              <Icon icon={ClockIcon} size={14} />
              <PublishedTime className={styles.secondaryDesc} date={updatedAt} />
            </Flexbox>
            {category && (
              <Flexbox horizontal align={'center'} gap={8}>
                {t(`mcp.categories.${category}.name` as any)}
              </Flexbox>
            )}
          </Flexbox>
          {shouldShowMarketStats && (
            <MetaInfo
              className={styles.secondaryDesc}
              installCount={installCount}
              usageCount={usageCount}
            />
          )}
        </Flexbox>
      </Block>
    );
  },
);

export default McpItem;
