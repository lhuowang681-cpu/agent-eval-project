'use client';

import type { BuiltinSkill, SkillListItem } from '@lobechat/types';
import type { DropdownMenuProps } from '@lobehub/ui';
import {
  Avatar,
  Button,
  DropdownMenu,
  Flexbox,
  Icon,
  Modal,
  stopPropagation,
  Tag,
} from '@lobehub/ui';
import { Alert, App, Space, Spin, Typography } from 'antd';
import {
  CloudUpload,
  DownloadIcon,
  MoreHorizontalIcon,
  Plus,
  PuzzleIcon,
  Send,
  Share2,
  Trash2,
} from 'lucide-react';
import { lazy, memo, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PublishedToMarketTag from '@/components/PublishedToMarketTag';
import SkillSourceTag from '@/components/SkillSourceTag';
import { SkillPublishModal } from '@/features/MarketPublish/SkillPublishModal';
import { ShareResultModal, useShare } from '@/features/PeerShare';
import { createBuiltinAgentSkillDetailModal } from '@/features/SkillStore/SkillDetail';
import { translateSkillImportError } from '@/features/SkillStore/SkillList/skillImportError';
import {
  invalidateMarketPublisherState,
  markPublisherResourceRelisted,
} from '@/helpers/invalidateMarketPublisherState';
import { useMarketPublisherState } from '@/hooks/useMarketPublisherState';
import { useShowMarket } from '@/hooks/useShowMarket';
import { communityApiService } from '@/services/marketApi';
import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';
import { downloadFile } from '@/utils/client/downloadFile';

import { styles } from './style';

const AgentSkillDetail = lazy(() => import('@/features/AgentSkillDetail'));
const AgentSkillEdit = lazy(() => import('@/features/AgentSkillEdit'));

const isBuiltinSkill = (skill: BuiltinSkill | SkillListItem): skill is BuiltinSkill =>
  !('id' in skill);

interface AgentSkillItemProps {
  skill: BuiltinSkill | SkillListItem;
}

const AgentSkillItem = memo<AgentSkillItemProps>(({ skill }) => {
  const { t } = useTranslation('setting');
  const { t: tc } = useTranslation('common');
  const { t: tp } = useTranslation('plugin');
  const { t: td } = useTranslation('discover');
  const { modal, message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncMode, setSyncMode] = useState<'syncToWeb' | 'publishUpdate'>('syncToWeb');
  const [marketActionLoading, setMarketActionLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const { share, result, resultUrl, closeModal, copyLink, loading: shareLoading } = useShare();

  const isBuiltin = isBuiltinSkill(skill);

  const deleteAgentSkill = useToolStore((s) => s.deleteAgentSkill);
  const syncAgentSkillToWeb = useToolStore((s) => s.syncAgentSkillToWeb);
  const [installBuiltinTool, uninstallBuiltinTool, isBuiltinInstalled] = useToolStore((s) => [
    s.installBuiltinTool,
    s.uninstallBuiltinTool,
    isBuiltin ? builtinToolSelectors.isBuiltinToolInstalled(skill.identifier)(s) : true,
  ]);

  const isSkillPublishable = !isBuiltin && 'id' in skill;
  const isDesktopOnly = !isBuiltin && skill.webSafeScanPassed === false;
  const skillMarketIdentifier = isSkillPublishable ? skill.marketIdentifier : undefined;

  const publishState = useMarketPublisherState(
    {
      installedFromMarketIdentifier: isSkillPublishable
        ? skill.installedFromMarketIdentifier
        : undefined,
      marketIdentifier: skillMarketIdentifier,
    },
    'skill',
    isSkillPublishable,
  );

  const showMarket = useShowMarket();
  const showSkillPublish = isSkillPublishable && showMarket;

  const title = isBuiltin
    ? t(`tools.builtins.${skill.identifier}.title`, { defaultValue: skill.name })
    : skill.name;

  const manifestMeta = isBuiltin
    ? undefined
    : (skill.manifest as { avatar?: string; backgroundColor?: string; icon?: string } | null);

  const avatar = isBuiltin ? skill.avatar : manifestMeta?.icon || manifestMeta?.avatar || '🧩';
  const avatarBackground = isBuiltin ? undefined : manifestMeta?.backgroundColor;

  const handleDownload = async () => {
    if (isBuiltin || !skill.zipFileHash) return;
    setLoading(true);
    try {
      const result = await agentSkillService.getZipUrl(skill.id);
      if (result.url) {
        await downloadFile(result.url, `${result.name || skill.name}.zip`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = () => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: async () => {
        if (isBuiltin) {
          await uninstallBuiltinTool(skill.identifier);
        } else {
          setLoading(true);
          try {
            await deleteAgentSkill(skill.id);
          } finally {
            setLoading(false);
          }
        }
      },
      title: tp('store.actions.confirmUninstall'),
      type: 'error',
    });
  };

  const handlePublishSkill = () => {
    if (!isSkillPublishable) return;
    setPublishOpen(true);
  };

  const handleMarketAction = async () => {
    if (!skillMarketIdentifier) return;

    // 后端可能因为本地 skill 未通过扫描而触发同步阻塞扫描，弹 loading 保持与 syncToWeb 一致
    setSyncError(null);
    setSyncMode('publishUpdate');
    setSyncModalOpen(true);
    setSyncLoading(true);
    setMarketActionLoading(true);
    try {
      if (publishState.action === 'update') {
        await communityApiService.updateSkill(skillMarketIdentifier);
        message.success(td('skills.updateSuccess'));
      } else if (publishState.action === 'relist') {
        await communityApiService.relistSkillWithSync(skillMarketIdentifier);
        await markPublisherResourceRelisted(skillMarketIdentifier, 'skill');
        message.success(td('skills.relistSuccess'));
      }
      await invalidateMarketPublisherState();
      setSyncModalOpen(false);
    } catch (error) {
      console.error(error);
      setSyncError(translateSkillImportError(t, error));
    } finally {
      setMarketActionLoading(false);
      setSyncLoading(false);
    }
  };

  const handleSyncToWeb = async () => {
    if (isBuiltin) return;

    setSyncError(null);
    setSyncMode('syncToWeb');
    setSyncModalOpen(true);
    setSyncLoading(true);
    try {
      await syncAgentSkillToWeb(skill.id);
      setSyncModalOpen(false);
      message.success(t('agentSkillItem.syncToWeb.success'));
    } catch (error) {
      console.error(error);
      setSyncError(translateSkillImportError(t, error));
    } finally {
      setSyncLoading(false);
    }
  };

  const dropdownLoading =
    loading || syncLoading || marketActionLoading || publishState.isRefreshing || shareLoading;

  const renderStatus = () => {
    if (!isBuiltin) return null;
    if (isBuiltinInstalled) {
      return <span className={styles.connected}>{t('tools.builtins.installed')}</span>;
    }
    return <span className={styles.disconnected}>{t('tools.builtins.uninstalled')}</span>;
  };

  const renderActions = () => {
    if (isBuiltin) {
      if (isBuiltinInstalled) {
        return (
          <DropdownMenu
            placement="bottomRight"
            items={[
              {
                danger: true,
                icon: <Icon icon={Trash2} />,
                key: 'uninstall',
                label: tp('store.actions.uninstall'),
                onClick: handleUninstall,
              },
            ]}
          >
            <Button icon={MoreHorizontalIcon} />
          </DropdownMenu>
        );
      }
      return (
        <Button icon={Plus} onClick={() => installBuiltinTool(skill.identifier)}>
          {tp('store.actions.install')}
        </Button>
      );
    }

    const dropdownItems: DropdownMenuProps['items'] = [];

    if (showSkillPublish) {
      dropdownItems.push(
        {
          disabled: dropdownLoading,
          icon: <Icon icon={Send} />,
          key: 'market-action',
          label: td(publishState.labelKey, { defaultValue: publishState.labelKey }),
          onClick: publishState.action === 'publish' ? handlePublishSkill : handleMarketAction,
        },
        { type: 'divider' },
      );
    }

    if (skill.zipFileHash && isSkillPublishable) {
      dropdownItems.push(
        {
          icon: <DownloadIcon size={16} />,
          key: 'download',
          label: tc('download'),
          onClick: handleDownload,
        },
        { type: 'divider' },
      );
    }

    if (isDesktopOnly) {
      dropdownItems.push(
        {
          disabled: dropdownLoading,
          icon: <Icon icon={CloudUpload} />,
          key: 'sync-to-web',
          label: t('agentSkillItem.syncToWeb'),
          onClick: handleSyncToWeb,
        },
        { type: 'divider' },
      );
    }

    dropdownItems.push(
      {
        disabled: dropdownLoading,
        icon: <Icon icon={Share2} />,
        key: 'share',
        label: t('button.share', { ns: 'share' }),
        onClick: () => share('skill', skill.identifier),
      },
      { type: 'divider' },
      {
        danger: true,
        icon: <Trash2 size={16} />,
        key: 'uninstall',
        label: tp('store.actions.uninstall'),
        onClick: handleUninstall,
      },
    );

    return (
      <Space.Compact>
        <Button onClick={() => setEditOpen(true)}>{tp('store.actions.configure')}</Button>
        <DropdownMenu
          items={dropdownItems}
          key={`${skillMarketIdentifier}-${publishState.action}`}
          placement="bottomRight"
        >
          <Button disabled={dropdownLoading} icon={MoreHorizontalIcon} loading={dropdownLoading} />
        </DropdownMenu>
      </Space.Compact>
    );
  };

  const handleOpenDetail = () => {
    if (isBuiltin) {
      createBuiltinAgentSkillDetailModal({ identifier: skill.identifier });
    } else {
      setDetailOpen(true);
    }
  };

  const renderDetailModal = () => {
    if (isBuiltin) return null;
    return (
      <>
        <Modal
          destroyOnHidden
          footer={null}
          open={detailOpen}
          styles={{ body: { height: 'calc(100dvh - 200px)', overflow: 'hidden', padding: 0 } }}
          title={tp('dev.title.skillDetails')}
          width={960}
          onCancel={() => setDetailOpen(false)}
        >
          <Suspense fallback={<div style={{ height: '100%' }} />}>
            <AgentSkillDetail skillId={skill.id} />
          </Suspense>
        </Modal>
        <Suspense>
          <AgentSkillEdit open={editOpen} skillId={skill.id} onClose={() => setEditOpen(false)} />
        </Suspense>
      </>
    );
  };

  const renderSyncToWebModal = () => {
    if (isBuiltin) return null;

    const titleKey =
      syncMode === 'publishUpdate'
        ? syncError
          ? 'agentSkillItem.publishScan.failedTitle'
          : 'agentSkillItem.publishScan.title'
        : syncError
          ? 'agentSkillItem.syncToWeb.failedTitle'
          : 'agentSkillItem.syncToWeb.title';
    const loadingKey =
      syncMode === 'publishUpdate'
        ? 'agentSkillItem.publishScan.loading'
        : 'agentSkillItem.syncToWeb.loading';
    const loadingDescKey =
      syncMode === 'publishUpdate'
        ? 'agentSkillItem.publishScan.loadingDesc'
        : 'agentSkillItem.syncToWeb.loadingDesc';
    const failedDescKey =
      syncMode === 'publishUpdate'
        ? 'agentSkillItem.publishScan.failedDesc'
        : 'agentSkillItem.syncToWeb.failedDesc';
    const retryHandler = syncMode === 'publishUpdate' ? handleMarketAction : handleSyncToWeb;

    return (
      <Modal
        centered
        closable={!syncLoading}
        keyboard={!syncLoading}
        maskClosable={!syncLoading}
        open={syncModalOpen}
        width={520}
        footer={
          syncLoading
            ? null
            : [
                <Button key="close" onClick={() => setSyncModalOpen(false)}>
                  {tc('close')}
                </Button>,
                <Button key="retry" type="primary" onClick={retryHandler}>
                  {tc('retry')}
                </Button>,
              ]
        }
        title={t(titleKey, {
          defaultValue: t(
            syncError ? 'agentSkillItem.syncToWeb.failedTitle' : 'agentSkillItem.syncToWeb.title',
          ) as unknown as string,
        })}
        onCancel={() => {
          if (!syncLoading) setSyncModalOpen(false);
        }}
      >
        <Flexbox gap={16}>
          {syncLoading ? (
            <Flexbox horizontal align="flex-start" gap={12}>
              <Spin />
              <Flexbox gap={4}>
                <Typography.Text>
                  {t(loadingKey, {
                    defaultValue: t('agentSkillItem.syncToWeb.loading') as unknown as string,
                  })}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t(loadingDescKey, {
                    defaultValue: t('agentSkillItem.syncToWeb.loadingDesc') as unknown as string,
                  })}
                </Typography.Text>
              </Flexbox>
            </Flexbox>
          ) : syncError ? (
            <Alert
              showIcon
              description={syncError}
              type="error"
              message={t(failedDescKey, {
                defaultValue: t('agentSkillItem.syncToWeb.failedDesc') as unknown as string,
              })}
            />
          ) : null}
        </Flexbox>
      </Modal>
    );
  };

  const showDisconnected = isBuiltin && !isBuiltinInstalled;

  return (
    <>
      <Flexbox
        horizontal
        align="center"
        className={styles.container}
        gap={16}
        justify="space-between"
      >
        <Flexbox horizontal align="center" gap={16} style={{ flex: 1, overflow: 'hidden' }}>
          <Flexbox
            horizontal
            align="center"
            gap={16}
            style={{ cursor: 'pointer' }}
            onClick={handleOpenDetail}
          >
            <div className={`${styles.icon} ${showDisconnected ? styles.disconnectedIcon : ''}`}>
              <Avatar avatar={avatar} background={avatarBackground} size={32} />
            </div>
            <Flexbox gap={4} style={{ overflow: 'hidden' }}>
              <Flexbox horizontal align="center" gap={8}>
                <span
                  className={`${styles.title} ${showDisconnected ? styles.disconnectedTitle : ''}`}
                >
                  {title}
                </span>
                {!isBuiltin && <Tag icon={<Icon icon={PuzzleIcon} />} size={'small'} />}
                {!isBuiltin && publishState.showPublishedTag && <PublishedToMarketTag />}
                <SkillSourceTag source={skill.source} />
                {isDesktopOnly && <Tag size={'small'}>{t('agentSkillItem.desktopOnly')}</Tag>}
              </Flexbox>
              {showDisconnected && renderStatus()}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={12} onClick={stopPropagation}>
          {isBuiltin && isBuiltinInstalled && renderStatus()}
          {renderActions()}
        </Flexbox>
      </Flexbox>
      {renderDetailModal()}
      {renderSyncToWebModal()}
      <ShareResultModal
        open={!!result?.open}
        url={resultUrl}
        onClose={closeModal}
        onCopy={copyLink}
      />
      {!isBuiltin && showSkillPublish && (
        <SkillPublishModal
          installedFromMarket={Boolean(skill.installedFromMarketIdentifier)}
          open={publishOpen}
          skillId={skill.id}
          skillName={skill.name}
          marketSourceName={
            (skill.installedFromSnapshot as { name?: string } | null)?.name || skill.name
          }
          onClose={() => setPublishOpen(false)}
          onSuccess={async () => {
            await invalidateMarketPublisherState();
            await useToolStore.getState().refreshAgentSkills();
          }}
        />
      )}
    </>
  );
});

AgentSkillItem.displayName = 'AgentSkillItem';

export default AgentSkillItem;
