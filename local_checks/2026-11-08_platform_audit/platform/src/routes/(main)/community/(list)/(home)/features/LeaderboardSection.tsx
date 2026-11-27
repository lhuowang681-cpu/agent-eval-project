'use client';

import { Avatar, Block } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import urlJoin from 'url-join';

import PluginAvatar from '@/components/Plugins/PluginAvatar';
import { DEFAULT_MCP_MARKET_ICON, DEFAULT_SKILL_MARKET_ICON } from '@/const/marketIcon';
import { useClientDataSWR } from '@/libs/swr';
import { communityApiService } from '@/services/marketApi';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

const RANK_COLORS = ['#FFB020', '#8C9BAB', '#E07B39'] as const;

const CATEGORY_DOT_COLORS = {
  agent: '#7B61FF',
  mcp: '#52C41A',
  skill: '#FA8C16',
} as const;

const styles = createStaticStyles(({ css }) => ({
  body: css`
    display: flex;
    flex-wrap: wrap;
    width: 100%;
  `,
  card: css`
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    gap: 16px;

    width: 100%;
    padding-block-end: 24px;
  `,
  column: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 12px;

    min-width: 220px;
    min-height: 160px;
    padding-block: 20px;
    padding-inline: 24px;

    &:not(:last-child) {
      border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  count: css`
    flex: none;
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;
  `,
  countValue: css`
    margin-inline-end: 2px;
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  dot: css`
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  `,
  empty: css`
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;

    min-height: 96px;

    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 20px 0;
    padding-inline: 24px;
  `,
  headerAccent: css`
    flex: none;

    width: 4px;
    height: 18px;
    border-radius: 2px;

    background: ${cssVar.colorPrimary};
  `,
  headerDate: css`
    font-size: 13px;
    color: ${cssVar.colorTextDescription};
  `,
  headerTitle: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  headerTitleWrap: css`
    display: flex;
    gap: 10px;
    align-items: center;
  `,
  itemLink: css`
    overflow: hidden;
    font-weight: 500;
    color: inherit;
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
  itemName: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  itemRow: css`
    display: flex;
    gap: 10px;
    align-items: center;
    padding-block: 10px;
  `,
  itemText: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;

    min-width: 0;
  `,
  publisher: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextDescription};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  rank: css`
    flex: none;

    width: 20px;

    font-size: 14px;
    font-weight: 600;
    text-align: center;
  `,
  sectionTitle: css`
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  sectionTitleWrap: css`
    display: flex;
    gap: 8px;
    align-items: center;
  `,
}));

type LeaderboardEntry = {
  icon?: string | null;
  identifier: string;
  name: string;
  publisherName: string;
  usageCount: number;
};

const formatUsageCount = (value: number) => {
  if (value >= 1000) return value.toLocaleString('zh-CN');
  return String(value);
};

const LeaderboardItemAvatar = memo<{
  icon?: string | null;
  name: string;
  type: 'agent' | 'skill' | 'mcp';
}>(({ type, icon, name }) => {
  if (type === 'mcp') {
    return <PluginAvatar avatar={icon || DEFAULT_MCP_MARKET_ICON} size={28} />;
  }

  const avatar = type === 'skill' ? icon || DEFAULT_SKILL_MARKET_ICON : icon || name;

  return <Avatar avatar={avatar} shape={'square'} size={28} style={{ flex: 'none' }} />;
});

const LeaderboardItem = memo<{
  basePath: string;
  index: number;
  item: LeaderboardEntry;
  showMarketStats: boolean;
  type: 'agent' | 'skill' | 'mcp';
  usageSuffix: string;
}>(({ item, index, basePath, type, usageSuffix, showMarketStats }) => {
  const rank = index + 1;
  const rankColor = rank <= 3 ? RANK_COLORS[rank - 1] : cssVar.colorTextDescription;

  return (
    <div className={styles.itemRow}>
      <span className={styles.rank} style={{ color: rankColor }}>
        {rank}
      </span>
      <LeaderboardItemAvatar icon={item.icon} name={item.name} type={type} />
      <div className={styles.itemText}>
        <Link className={styles.itemLink} title={item.name} to={urlJoin(basePath, item.identifier)}>
          <div className={styles.itemName}>{item.name}</div>
        </Link>
        <div className={styles.publisher} title={item.publisherName}>
          {item.publisherName}
        </div>
      </div>
      {showMarketStats && (
        <div className={styles.count}>
          <span className={styles.countValue}>{formatUsageCount(item.usageCount)}</span>
          {usageSuffix}
        </div>
      )}
    </div>
  );
});

const LeaderboardColumn = memo<{
  dotColor: string;
  items: LeaderboardEntry[];
  showMarketStats: boolean;
  title: string;
  type: 'agent' | 'skill' | 'mcp';
  usageSuffix: string;
}>(({ title, items, type, dotColor, usageSuffix, showMarketStats }) => {
  const { t } = useTranslation('discover');
  const basePath =
    type === 'agent'
      ? '/community/agent'
      : type === 'skill'
        ? '/community/skill'
        : '/community/mcp';

  return (
    <div className={styles.column}>
      <div className={styles.sectionTitleWrap}>
        <span className={styles.dot} style={{ background: dotColor }} />
        <h3 className={styles.sectionTitle}>{title}</h3>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>{t('home.leaderboard.empty')}</div>
      ) : (
        items.map((item, index) => (
          <LeaderboardItem
            basePath={basePath}
            index={index}
            item={item}
            key={item.identifier}
            showMarketStats={showMarketStats}
            type={type}
            usageSuffix={usageSuffix}
          />
        ))
      )}
    </div>
  );
});

const LeaderboardSection = memo(() => {
  const { t } = useTranslation('discover');
  const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);
  const { data } = useClientDataSWR('market-leaderboard', () =>
    communityApiService.getLeaderboard(),
  );

  const monthLabel = useMemo(() => {
    const now = new Date();
    return t('home.leaderboard.monthLabel', {
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    });
  }, [t]);

  const usageSuffix = t('home.leaderboard.usageCount');
  const agents = data?.agents ?? [];
  const mcps = data?.mcps ?? [];
  const skills = data?.skills ?? [];
  const shouldShowMarketStats = showMarketStats !== false;

  return (
    <Block
      className={styles.card}
      data-testid="market-leaderboard"
      variant={'outlined'}
      width={'100%'}
    >
      <div className={styles.header}>
        <div className={styles.headerTitleWrap}>
          <span className={styles.headerAccent} />
          <h2 className={styles.headerTitle}>{t('home.leaderboard.title')}</h2>
        </div>
        <span className={styles.headerDate}>{monthLabel}</span>
      </div>

      <div className={styles.body}>
        <LeaderboardColumn
          dotColor={CATEGORY_DOT_COLORS.agent}
          items={agents}
          showMarketStats={shouldShowMarketStats}
          title={t('home.leaderboard.agents')}
          type={'agent'}
          usageSuffix={usageSuffix}
        />
        <LeaderboardColumn
          dotColor={CATEGORY_DOT_COLORS.mcp}
          items={mcps}
          showMarketStats={shouldShowMarketStats}
          title={t('home.leaderboard.mcps')}
          type={'mcp'}
          usageSuffix={usageSuffix}
        />
        <LeaderboardColumn
          dotColor={CATEGORY_DOT_COLORS.skill}
          items={skills}
          showMarketStats={shouldShowMarketStats}
          title={t('home.leaderboard.skills')}
          type={'skill'}
          usageSuffix={usageSuffix}
        />
      </div>
    </Block>
  );
});

export default LeaderboardSection;
