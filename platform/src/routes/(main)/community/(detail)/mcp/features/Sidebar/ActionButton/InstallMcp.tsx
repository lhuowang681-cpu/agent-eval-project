'use client';

import { Button } from '@lobehub/ui';
import { App, Modal } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import MCPInstallProgress from '@/features/MCP/MCPInstallProgress';
import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';
import { invalidateMarketPublisherState } from '@/helpers/invalidateMarketPublisherState';
import {
  computeMarketInstallButtonState,
  type MarketInstallButtonState,
} from '@/helpers/marketInstallButtonState';
import { communityApiService } from '@/services/marketApi';
import { useDiscoverStore } from '@/store/discover';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/slices/plugin/selectors';
import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    width: 100%;
  `,
}));

const getMcpCustomParamType = (customParams?: Record<string, unknown>) => {
  const mcpParams = customParams?.mcp;

  if (mcpParams && typeof mcpParams === 'object') {
    const { command, type, url } = mcpParams as {
      command?: unknown;
      type?: unknown;
      url?: unknown;
    };

    if (typeof type === 'string') return type;
    if (typeof command === 'string') return 'stdio';
    if (typeof url === 'string') return 'http';
  }

  const mcpServers = customParams?.mcpServers;
  if (!mcpServers || typeof mcpServers !== 'object') return;

  const firstServer = Object.values(mcpServers as Record<string, Record<string, unknown>>).find(
    (server) => server && typeof server === 'object',
  );
  if (!firstServer) return;

  if (typeof firstServer.type === 'string') return firstServer.type;
  if (typeof firstServer.command === 'string') return 'stdio';
  if (typeof firstServer.url === 'string') return 'http';
};

const InstallMcp = memo(() => {
  const { identifier, name, customParams, connectionType, deletedAt, publisherId, mutate } =
    useDetailContext();
  const [isLoading, setIsLoading] = useState(false);
  const installMcp = useDiscoverStore((s) => s.installMcp);
  const updateInstalledMcp = useDiscoverStore((s) => s.updateInstalledMcp);
  const installMCPPlugin = useToolStore((s) => s.installMCPPlugin);
  const refreshPlugins = useToolStore((s) => s.refreshPlugins);
  const useFetchPluginStore = useToolStore((s) => s.useFetchPluginStore);
  const installedPlugins = useToolStore(pluginSelectors.installedPlugins);
  const { message } = App.useApp();
  const { t } = useTranslation('discover');
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  useFetchPluginStore();

  // Determine if current user is the publisher
  const isPublisher = isLogin && currentUserId === publisherId;

  // Check if the MCP is delisted (deletedAt exists means it was delisted)
  const isDelisted = Boolean(deletedAt);
  const customParamType = getMcpCustomParamType(customParams);
  const isStdioMcp = customParamType ? customParamType === 'stdio' : connectionType === 'stdio';

  const installedPlugin = useMemo(() => {
    return installedPlugins.find(
      (plugin) =>
        plugin.installedFromMarketIdentifier === identifier ||
        plugin.identifier === identifier ||
        plugin.marketIdentifier === identifier,
    );
  }, [identifier, installedPlugins]);

  const localPublishedPlugin = useMemo(() => {
    return installedPlugins.find((plugin) => plugin.marketIdentifier === identifier);
  }, [identifier, installedPlugins]);

  // For publisher: show delist/relist buttons
  // For non-publisher: show install/update buttons (but not for delisted items)
  const buttonState = useMemo(() => {
    // Publisher view: restore the market-linked local copy first if it was deleted.
    if (isPublisher) {
      if (!localPublishedPlugin) {
        return {
          disabled: false,
          label: t('mcp.restoreToLocal'),
          type: 'restore' as const,
        };
      }
      if (isDelisted) {
        return {
          disabled: false,
          label: t('mcp.relist'),
          type: 'relist' as const,
        };
      }
      return {
        disabled: false,
        label: t('mcp.delist'),
        type: 'delist' as const,
      };
    }

    return computeMarketInstallButtonState({
      deletedAt,
      installed: installedPlugin
        ? {
            currentSnapshot: {
              customParams: installedPlugin.customParams,
              manifest: installedPlugin.manifest,
            },
            installedFromSnapshot: installedPlugin.installedFromSnapshot,
            marketIdentifier:
              installedPlugin.installedFromMarketIdentifier === identifier
                ? null
                : installedPlugin.marketIdentifier,
          }
        : null,
      labels: {
        delistWarning: t('assistants.delistWarning'),
        install: t('mcp.installMcp'),
        update: t('mcp.updateInstalled'),
      },
    });
  }, [deletedAt, installedPlugin, isDelisted, isPublisher, localPublishedPlugin, t]);

  const handleAction = async () => {
    if (!identifier || buttonState.disabled) return;

    // Publisher actions: delist or relist
    if (isPublisher) {
      if (buttonState.type === 'delist') {
        Modal.confirm({
          content: t('mcp.delistConfirm'),
          onOk: async () => {
            setIsLoading(true);
            try {
              await communityApiService.delistMcp(identifier);
              message.success(t('mcp.delistSuccess'));
              await mutate?.();
              await invalidateMarketPublisherState();
            } catch (error) {
              console.error('Delist MCP failed:', error);
              message.error(t('mcp.delistFailed'));
            } finally {
              setIsLoading(false);
            }
          },
          title: name || identifier,
        });
        return;
      }

      if (buttonState.type === 'relist') {
        setIsLoading(true);
        try {
          await communityApiService.relistMcpWithSync(identifier);
          message.success(t('mcp.relistSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
        } catch (error) {
          console.error('Relist MCP failed:', error);
          message.error(t('mcp.relistFailed'));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      if (buttonState.type === 'restore') {
        setIsLoading(true);
        try {
          await communityApiService.restoreMcpToLocal(identifier);
          await refreshPlugins();
          message.success(t('mcp.restoreSuccess'));
          await mutate?.();
          await invalidateMarketPublisherState();
        } catch (error) {
          console.error('Restore MCP to local failed:', error);
          message.error(t('mcp.restoreFailed'));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      return;
    }

    const runInstall = async () => {
      setIsLoading(true);
      try {
        if (isStdioMcp) {
          const result = await installMCPPlugin(identifier!);
          if (result !== true) return;
        } else {
          await installMcp(identifier!);
        }
        await refreshPlugins();
        message.success(t('mcp.installSuccess'));
      } catch (error) {
        console.error('Install MCP failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    const runUpdate = async () => {
      setIsLoading(true);
      try {
        if (isStdioMcp) {
          const result = await installMCPPlugin(identifier!);
          if (result !== true) return;
        } else {
          await updateInstalledMcp(identifier!);
        }
        await refreshPlugins();
        message.success(t('mcp.updateSuccess'));
      } catch (error) {
        console.error('Update MCP failed:', error);
        message.error(t('fork.failed'));
      } finally {
        setIsLoading(false);
      }
    };

    if (buttonState.type === 'update') {
      if (buttonState.withWarning) {
        Modal.confirm({
          content: t('mcp.updateWarning'),
          onOk: runUpdate,
          title: name || identifier,
        });
        return;
      }
      await runUpdate();
      return;
    }

    await runInstall();
  };

  // Not logged in — show disabled install button
  if (!isLogin) {
    return (
      <Button block disabled className={styles.button} size={'large'} type={'primary'}>
        {t('mcp.installMcp')}
      </Button>
    );
  }

  return (
    <>
      <Button
        block
        className={styles.button}
        danger={isPublisher && buttonState.type === 'delist'}
        disabled={buttonState.disabled}
        loading={isLoading}
        size={'large'}
        title={(buttonState as MarketInstallButtonState)?.reason}
        type={'primary'}
        onClick={handleAction}
      >
        {buttonState.label}
      </Button>
      {identifier && <MCPInstallProgress identifier={identifier} />}
    </>
  );
});

export default InstallMcp;
