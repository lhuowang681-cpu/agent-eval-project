import { Button, DropdownMenu, Flexbox, Icon, stopPropagation } from '@lobehub/ui';
import { App, Space } from 'antd';
import { MoreHorizontalIcon, Send, Share2, Trash2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { McpPublishModal } from '@/features/MarketPublish/McpPublishModal';
import { ShareResultModal, useShare } from '@/features/PeerShare';
import PluginDetailModal from '@/features/PluginDetailModal';
import {
  invalidateMarketPublisherState,
  markPublisherResourceRelisted,
} from '@/helpers/invalidateMarketPublisherState';
import { isPublishableMcpPlugin } from '@/helpers/marketPublisherActionState';
import { useMarketPublisherState } from '@/hooks/useMarketPublisherState';
import { useShowMarket } from '@/hooks/useShowMarket';
import { communityApiService } from '@/services/marketApi';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { useServerConfigStore } from '@/store/serverConfig';
import { pluginHelpers, useToolStore } from '@/store/tool';
import { pluginSelectors, pluginStoreSelectors } from '@/store/tool/selectors';
import { type LobeToolType } from '@/types/tool/tool';

import EditCustomPlugin from './EditCustomPlugin';
import EditMcpPlugin from './EditMcpPlugin';

interface ActionsProps {
  identifier: string;
  isMCP?: boolean;
  type: LobeToolType;
}

const Actions = memo<ActionsProps>(({ identifier, type, isMCP }) => {
  const mobile = useServerConfigStore((s) => s.isMobile);
  const [installed, installing, installPlugin, unInstallPlugin, installMCPPlugin] = useToolStore(
    (s) => [
      pluginSelectors.isPluginInstalled(identifier)(s),
      pluginStoreSelectors.isPluginInstallLoading(identifier)(s),
      s.installPlugin,
      s.uninstallPlugin,
      s.installMCPPlugin,
    ],
  );

  const isCustomPlugin = type === 'customPlugin';
  const { t } = useTranslation('plugin');
  const { t: td } = useTranslation('discover');
  const { t: tShare } = useTranslation('share');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const plugin = useToolStore(pluginSelectors.getToolManifestById(identifier));
  const [togglePlugin, isPluginEnabledInAgent] = useAgentStore((s) => [
    s.togglePlugin,
    agentSelectors.currentAgentPlugins(s).includes(identifier),
  ]);
  const { modal, message } = App.useApp();
  const hasSettings = pluginHelpers.isSettingSchemaNonEmpty(plugin?.settings);
  const { share, result, resultUrl, closeModal, copyLink, loading: shareLoading } = useShare();

  const [showModal, setModal] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const installedPlugins = useToolStore(pluginSelectors.installedPlugins);
  const mcpTool = installedPlugins.find((p) => p.identifier === identifier);
  const isPublishableMcp = isPublishableMcpPlugin(mcpTool);
  const showMarket = useShowMarket();
  const showPublishMenu = installed && isPublishableMcp && showMarket;

  const publishState = useMarketPublisherState(
    {
      installedFromMarketIdentifier: mcpTool?.installedFromMarketIdentifier,
      isPublishable: isPublishableMcp,
      marketIdentifier: mcpTool?.marketIdentifier,
    },
    'mcp',
    showPublishMenu,
  );

  const mcpDisplayName = plugin?.meta?.title || identifier;
  const marketActionLoading = publishing || publishState.isRefreshing;

  const handlePublishMcp = () => {
    setPublishOpen(true);
  };

  const handleMarketAction = async () => {
    if (!mcpTool?.marketIdentifier) return;

    setPublishing(true);
    try {
      if (publishState.action === 'update') {
        await communityApiService.updateMcp(mcpTool.marketIdentifier);
        message.success(td('mcp.updateSuccess'));
      } else if (publishState.action === 'relist') {
        await communityApiService.relistMcpWithSync(mcpTool.marketIdentifier);
        await markPublisherResourceRelisted(mcpTool.marketIdentifier, 'mcp');
        message.success(td('mcp.relistSuccess'));
      }
      await invalidateMarketPublisherState();
    } catch (error) {
      console.error(error);
      message.error(
        publishState.action === 'relist' ? td('mcp.relistFailed') : td('mcp.publishFailed'),
      );
    } finally {
      setPublishing(false);
    }
  };

  const showConfigureButton = (isMCP && installed) || isCustomPlugin || hasSettings;

  const openConfigureModal = () => {
    if (isMCP && installed) {
      setModal(true);
      return;
    }
    if (isCustomPlugin) {
      setModal(true);
      return;
    }
    setSettingsOpen(true);
  };

  const configureButton = (
    <Button onClick={openConfigureModal}>{t('store.actions.configure')}</Button>
  );

  const menuItems = [
    ...(showPublishMenu
      ? [
          {
            disabled: marketActionLoading,
            icon: <Icon icon={Send} />,
            key: 'market-action',
            label: td(publishState.labelKey),
            onClick: publishState.action === 'publish' ? handlePublishMcp : handleMarketAction,
          },
          { type: 'divider' as const },
        ]
      : []),
    ...(isMCP
      ? [
          {
            disabled: shareLoading,
            icon: <Icon icon={Share2} />,
            key: 'share',
            label: tShare('button.share'),
            onClick: () => share('mcp', identifier),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      danger: true,
      icon: <Icon icon={Trash2} />,
      key: 'uninstall',
      label: t('store.actions.uninstall'),
      onClick: () => {
        modal.confirm({
          centered: true,
          okButtonProps: { danger: true },
          onOk: async () => {
            if (isPluginEnabledInAgent) {
              await togglePlugin(identifier, false);
            }
            await unInstallPlugin(identifier);
          },
          title: t('store.actions.confirmUninstall'),
          type: 'error',
        });
      },
    },
  ];

  const renderConfigureWrapper = () => {
    if (isMCP && installed) {
      return (
        <EditMcpPlugin identifier={identifier} open={showModal} onOpenChange={setModal}>
          {configureButton}
        </EditMcpPlugin>
      );
    }
    if (isCustomPlugin) {
      return (
        <EditCustomPlugin identifier={identifier} open={showModal} onOpenChange={setModal}>
          {configureButton}
        </EditCustomPlugin>
      );
    }
    return configureButton;
  };

  return (
    <>
      <Flexbox horizontal align={'center'} gap={8} onClick={stopPropagation}>
        {installed ? (
          <Space.Compact>
            {showConfigureButton && renderConfigureWrapper()}
            <DropdownMenu
              items={menuItems}
              key={`${identifier}-${publishState.action}`}
              placement="bottomRight"
            >
              <Button
                disabled={marketActionLoading}
                icon={MoreHorizontalIcon}
                loading={installing || marketActionLoading}
              />
            </DropdownMenu>
          </Space.Compact>
        ) : (
          <Button
            loading={installing}
            size={mobile ? 'small' : undefined}
            onClick={async () => {
              if (isMCP) {
                await installMCPPlugin(identifier);
                await togglePlugin(identifier);
              } else {
                await installPlugin(identifier);
                await togglePlugin(identifier);
              }
            }}
          >
            {t('store.actions.install')}
          </Button>
        )}
      </Flexbox>
      {!isMCP && (
        <PluginDetailModal
          id={identifier}
          open={settingsOpen}
          schema={plugin?.settings}
          tab="settings"
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
      {showPublishMenu && (
        <McpPublishModal
          customParams={(mcpTool?.customParams as Record<string, unknown>) ?? {}}
          displayName={mcpDisplayName}
          identifier={identifier}
          installedFromMarket={Boolean(mcpTool?.installedFromMarketIdentifier)}
          manifest={(plugin ?? {}) as unknown as Record<string, unknown>}
          open={publishOpen}
          marketSourceName={
            (
              mcpTool?.installedFromSnapshot as {
                manifest?: { meta?: { title?: string } };
              } | null
            )?.manifest?.meta?.title || mcpDisplayName
          }
          onClose={() => setPublishOpen(false)}
          onSuccess={async () => {
            await invalidateMarketPublisherState();
            await useToolStore.getState().refreshPlugins();
          }}
        />
      )}
      <ShareResultModal
        open={!!result?.open}
        url={resultUrl}
        onClose={closeModal}
        onCopy={copyLink}
      />
    </>
  );
});

export default Actions;
