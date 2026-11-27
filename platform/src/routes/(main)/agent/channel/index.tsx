'use client';

import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import Loading from '@/components/Loading/BrandTextLoading';
import NavHeader from '@/features/NavHeader';
import { useAgentStore } from '@/store/agent';
import { BOT_RUNTIME_STATUSES, type BotRuntimeStatus } from '@/types/botRuntimeStatus';

import { type ChannelPlatformDefinition, COMING_SOON_PLATFORMS } from './const';
import PlatformDetail from './detail';
import ComingSoonDetail from './detail/ComingSoon';
import PlatformList from './list';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    overflow: hidden;
    display: flex;
    flex: 1;

    width: 100%;
    height: 100%;
  `,
}));

const ChannelPage = memo(() => {
  const { aid } = useParams<{ aid?: string }>();
  const [activeProviderId, setActiveProviderId] = useState<string>('');

  const { data: platforms, isLoading: platformsLoading } = useAgentStore((s) =>
    s.useFetchPlatformDefinitions(),
  );
  const { data: providers, isLoading: providersLoading } = useAgentStore((s) =>
    s.useFetchBotProviders(aid),
  );
  const triggerRefreshAllBotStatuses = useAgentStore((s) => s.triggerRefreshAllBotStatuses);

  // Fire-and-forget a live gateway status refresh on entry. The list renders
  // from cached statuses immediately; SWR revalidates once Redis is updated.
  useEffect(() => {
    if (!aid) return;
    triggerRefreshAllBotStatuses(aid);
  }, [aid, triggerRefreshAllBotStatuses]);

  const isLoading = platformsLoading || providersLoading;

  // Merge server-side platforms with frontend-only coming-soon entries.
  // `lark`(海外版 larksuite.com)入口暂时隐藏:当前部署面向飞书(feishu.cn),
  // lark 凭证域名不匹配、连不上。平台仍在后端注册,仅从选择列表中过滤。
  const allPlatforms = useMemo<ChannelPlatformDefinition[]>(() => {
    const comingSoonIds = new Set(COMING_SOON_PLATFORMS.map((p) => p.id));
    const HIDDEN_PLATFORM_IDS = new Set(['lark']);
    return [
      ...(platforms ?? []).filter(
        (p) => !comingSoonIds.has(p.id) && !HIDDEN_PLATFORM_IDS.has(p.id),
      ),
      ...COMING_SOON_PLATFORMS,
    ];
  }, [platforms]);

  // Default to first platform once loaded
  const effectiveActiveId = activeProviderId || allPlatforms[0]?.id || '';

  const platformRuntimeStatuses = useMemo(
    () =>
      new Map<string, BotRuntimeStatus>(
        (providers ?? [])
          .filter((provider) => provider.enabled)
          .map((provider) => [
            provider.platform,
            ((provider as any).runtimeStatus as BotRuntimeStatus) ??
              BOT_RUNTIME_STATUSES.disconnected,
          ]),
      ),
    [providers],
  );

  const activePlatformDef = useMemo(
    () => allPlatforms.find((p) => p.id === effectiveActiveId) || allPlatforms[0],
    [allPlatforms, effectiveActiveId],
  );

  const currentConfig = useMemo(
    () => providers?.find((p) => p.platform === effectiveActiveId),
    [providers, effectiveActiveId],
  );

  if (!aid) return null;

  return (
    <Flexbox flex={1} height={'100%'}>
      <NavHeader />
      <Flexbox flex={1} style={{ overflowY: 'auto' }}>
        {isLoading && <Loading debugId="ChannelPage" />}

        {!isLoading && allPlatforms.length > 0 && activePlatformDef && (
          <div className={styles.container}>
            {/* 只有一个平台(feishu)时无需选择,隐藏左侧平台列表,默认直接进 feishu */}
            {allPlatforms.length > 1 && (
              <PlatformList
                activeId={effectiveActiveId}
                agentId={aid}
                platforms={allPlatforms}
                providers={providers}
                runtimeStatuses={platformRuntimeStatuses}
                onSelect={setActiveProviderId}
              />
            )}
            {activePlatformDef.comingSoon ? (
              <ComingSoonDetail platformDef={activePlatformDef} />
            ) : (
              <PlatformDetail
                agentId={aid}
                currentConfig={currentConfig}
                platformDef={activePlatformDef}
                runtimeStatus={platformRuntimeStatuses.get(activePlatformDef.id)}
              />
            )}
          </div>
        )}
      </Flexbox>
    </Flexbox>
  );
});

export default ChannelPage;
