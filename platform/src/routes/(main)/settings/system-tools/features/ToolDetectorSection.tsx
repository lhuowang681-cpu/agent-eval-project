'use client';

import {
  type InstallPhase,
  type InstallProgressEvent,
  type ToolStatus,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import {
  Button,
  CopyButton,
  Dropdown,
  Flexbox,
  Form,
  Icon,
  Skeleton,
  Tag,
  Text,
  Tooltip,
} from '@lobehub/ui';
import { App, Progress } from 'antd';
import { CheckCircle2, ChevronDown, Loader2Icon, RefreshCw, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { toolDetectorService } from '@/services/electron/toolDetector';

const PORTABLE_TOOLS = new Set(['node', 'npm', 'python', 'bun', 'bunx', 'pnpm', 'uv', 'rg', 'fd']);

// App-managed built-ins: shipped with the desktop app, not user-installable via
// the portable installer. We render status only (no install/uninstall button).
const NON_INSTALLABLE_TOOLS = new Set(['tripyoyo']);

/**
 * Predefined tool configurations by category
 * This allows us to always show all tools even if not detected
 */
const TOOL_CATEGORIES = {
  'runtime-environment': {
    descKey: 'settingSystemTools.category.runtimeEnvironment.desc',
    titleKey: 'settingSystemTools.category.runtimeEnvironment',
    tools: [
      { descKey: 'settingSystemTools.tools.tripyoyo.desc', name: 'tripyoyo' },
      { descKey: 'settingSystemTools.tools.node.desc', name: 'node' },
      { descKey: 'settingSystemTools.tools.python.desc', name: 'python' },
      { descKey: 'settingSystemTools.tools.npm.desc', name: 'npm' },
      { descKey: 'settingSystemTools.tools.bun.desc', name: 'bun' },
      { descKey: 'settingSystemTools.tools.bunx.desc', name: 'bunx' },
      { descKey: 'settingSystemTools.tools.pnpm.desc', name: 'pnpm' },
      { descKey: 'settingSystemTools.tools.uv.desc', name: 'uv' },
    ],
  },

  'content-search': {
    descKey: 'settingSystemTools.category.contentSearch.desc',
    titleKey: 'settingSystemTools.category.contentSearch',
    tools: [
      { descKey: 'settingSystemTools.tools.rg.desc', name: 'rg' },
      { descKey: 'settingSystemTools.tools.grep.desc', name: 'grep' },
    ],
  },
  'file-search': {
    descKey: 'settingSystemTools.category.fileSearch.desc',
    titleKey: 'settingSystemTools.category.fileSearch',
    tools: [
      { descKey: 'settingSystemTools.tools.mdfind.desc', name: 'mdfind' },
      { descKey: 'settingSystemTools.tools.fd.desc', name: 'fd' },
      { descKey: 'settingSystemTools.tools.find.desc', name: 'find' },
    ],
  },
} as const;

const TOOL_INSTALL_LABELS: Record<string, { darwin?: string; win32?: string }> = {};

const getInstallCommandLabel = (toolName: string) => {
  const platform = window.lobeEnv?.platform;
  if (platform !== 'darwin' && platform !== 'win32') return;

  return TOOL_INSTALL_LABELS[toolName]?.[platform];
};

interface ToolStatusDisplayProps {
  isDetecting?: boolean;
  status?: ToolStatus;
}

const ToolStatusDisplay = memo<ToolStatusDisplayProps>(({ status, isDetecting }) => {
  const { t } = useTranslation('setting');

  if (isDetecting) {
    return (
      <Flexbox horizontal align="center" gap={8}>
        <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
        <Text type="secondary">{t('settingSystemTools.detecting')}</Text>
      </Flexbox>
    );
  }

  if (!status) {
    return (
      <Flexbox horizontal align="center" gap={8}>
        <Icon color="var(--ant-color-text-quaternary)" icon={XCircle} size={16} />
        <Text type="secondary">{t('settingSystemTools.status.notDetected')}</Text>
      </Flexbox>
    );
  }

  if (!status.available) {
    if (status.supportedOnCurrentPlatform === false) {
      return (
        <Flexbox horizontal align="center" gap={8} justify="center">
          <Icon color="var(--ant-color-text-quaternary)" icon={XCircle} size={16} />
          <Text type="secondary">{t('settingSystemTools.install.notSupportedOnPlatform')}</Text>
        </Flexbox>
      );
    }
    return (
      <Flexbox horizontal align="center" gap={8} justify="center">
        <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
        <Text type="secondary">{t('settingSystemTools.status.unavailable')}</Text>
      </Flexbox>
    );
  }

  return (
    <Flexbox align="flex-end" gap={4}>
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
        <Text type="success">{t('settingSystemTools.status.available')}</Text>
        {status.managedBy === 'app' && (
          <Tag color="processing" style={{ marginInlineStart: 0 }}>
            {t('settingSystemTools.install.managedByApp')}
          </Tag>
        )}
      </Flexbox>
      {status.path && (
        <Tooltip title={status.path}>
          <Flexbox horizontal align="center" gap={4} justify="flex-end" style={{ maxWidth: 280 }}>
            <Text ellipsis style={{ fontSize: 12 }} type="secondary">
              {status.path}
            </Text>
            <CopyButton content={status.path} size="small" />
          </Flexbox>
        </Tooltip>
      )}
    </Flexbox>
  );
});

interface InstallProgress {
  message?: string;
  percent?: number;
  phase: InstallPhase;
}

const phaseKey = {
  done: 'settingSystemTools.install.phase.switch',
  download: 'settingSystemTools.install.phase.download',
  error: 'settingSystemTools.install.failed',
  extract: 'settingSystemTools.install.phase.extract',
  switch: 'settingSystemTools.install.phase.switch',
  verify: 'settingSystemTools.install.phase.verify',
} as const satisfies Record<InstallPhase, string>;

const ToolDetectorSection = memo(() => {
  const { t } = useTranslation('setting');
  const { t: tCommon } = useTranslation('common');
  const { message, modal } = App.useApp();
  const [toolStatuses, setToolStatuses] = useState<Record<string, ToolStatus>>({});
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  /**
   * 正在进行中的操作: key = toolName, value = 当前动作。
   * 用 map 而不是单值状态,支持同时安装多个工具而不互相覆盖进度条。
   */
  const [busyActions, setBusyActions] = useState<
    Record<string, 'install' | 'reinstall' | 'uninstall'>
  >({});
  const [progressMap, setProgressMap] = useState<Record<string, InstallProgress>>({});

  const detectTools = useCallback(async (force = false) => {
    try {
      if (force) {
        setDetecting(true);
      }
      const statuses = await toolDetectorService.detectAllTools(force);
      setToolStatuses(statuses);
    } catch (error) {
      console.error('Failed to detect tools:', error);
    } finally {
      setLoading(false);
      setDetecting(false);
    }
  }, []);

  useEffect(() => {
    detectTools(true);
  }, [detectTools]);

  useWatchBroadcast('toolInstallProgress', (event: InstallProgressEvent) => {
    setProgressMap((prev) => ({
      ...prev,
      [event.toolName]: {
        message: event.message,
        percent: event.percent,
        phase: event.phase,
      },
    }));
  });

  const handleRedetect = useCallback(() => {
    detectTools(true);
  }, [detectTools]);

  const runInstall = useCallback(
    async (toolName: string, action: 'install' | 'reinstall' | 'uninstall') => {
      setBusyActions((prev) => ({ ...prev, [toolName]: action }));
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[toolName];
        return next;
      });
      try {
        const svc = toolDetectorService;
        const result =
          action === 'install'
            ? await svc.installTool(toolName)
            : action === 'reinstall'
              ? await svc.reinstallTool(toolName)
              : await svc.uninstallTool(toolName);

        if (!result.success) {
          message.error(result.error || t('settingSystemTools.install.failed'));
          return;
        }

        const successKey =
          action === 'install'
            ? ('settingSystemTools.install.success' as const)
            : action === 'reinstall'
              ? ('settingSystemTools.install.reinstallSuccess' as const)
              : ('settingSystemTools.install.uninstallSuccess' as const);
        message.success(t(successKey, { name: toolName }));
        await detectTools(true);
      } catch (error) {
        message.error((error as Error).message || t('settingSystemTools.install.failed'));
      } finally {
        setBusyActions((prev) => {
          if (!(toolName in prev)) return prev;
          const { [toolName]: _dropped, ...rest } = prev;
          return rest;
        });
        setProgressMap((prev) => {
          const next = { ...prev };
          delete next[toolName];
          return next;
        });
      }
    },
    [detectTools, message, t],
  );

  const handleInstall = useCallback(
    (toolName: string) => {
      const isPortable = PORTABLE_TOOLS.has(toolName);
      const desc = isPortable
        ? t('settingSystemTools.install.portableConfirmDesc', { name: toolName })
        : t('settingSystemTools.install.confirmDesc', {
            command:
              getInstallCommandLabel(toolName) ||
              t('settingSystemTools.install.unsupportedCommand'),
            name: toolName,
          });

      modal.confirm({
        cancelText: tCommon('cancel'),
        content: desc,
        okText: t('settingSystemTools.install.confirmOk'),
        onOk: () => {
          void runInstall(toolName, 'install');
        },
        title: t('settingSystemTools.install.confirmTitle', { name: toolName }),
      });
    },
    [modal, runInstall, t, tCommon],
  );

  const handleReinstall = useCallback(
    (toolName: string) => {
      modal.confirm({
        cancelText: tCommon('cancel'),
        content: t('settingSystemTools.install.reinstallConfirmDesc', { name: toolName }),
        okText: t('settingSystemTools.install.reinstallConfirmOk'),
        onOk: () => {
          void runInstall(toolName, 'reinstall');
        },
        title: t('settingSystemTools.install.reinstallConfirmTitle', { name: toolName }),
      });
    },
    [modal, runInstall, t, tCommon],
  );

  const handleUninstall = useCallback(
    (toolName: string) => {
      modal.confirm({
        cancelText: tCommon('cancel'),
        content: t('settingSystemTools.install.uninstallConfirmDesc', { name: toolName }),
        okText: t('settingSystemTools.install.uninstallConfirmOk'),
        okType: 'danger',
        onOk: () => {
          void runInstall(toolName, 'uninstall');
        },
        title: t('settingSystemTools.install.uninstallConfirmTitle', { name: toolName }),
      });
    },
    [modal, runInstall, t, tCommon],
  );

  const renderActionArea = useCallback(
    (toolName: string, status?: ToolStatus) => {
      // App-managed built-ins (e.g. tripyoyo CLI) ship with the app and are not
      // installed/uninstalled here — render status only, no action button.
      if (NON_INSTALLABLE_TOOLS.has(toolName)) return null;

      const currentAction = busyActions[toolName];
      const isBusy = !!currentAction;
      const isPortable = PORTABLE_TOOLS.has(toolName);
      const isManaged = status?.managedBy === 'app';
      const isAvailable = !!status?.available;
      const progress = progressMap[toolName];

      if (isBusy && progress) {
        const rawLabel = t(phaseKey[progress.phase] ?? 'settingSystemTools.install.phase.download');
        const label = typeof rawLabel === 'string' ? rawLabel : String(rawLabel);
        return (
          <Flexbox align="flex-end" gap={4} style={{ minWidth: 160 }}>
            <Text type="secondary">{label}</Text>
            {progress.percent !== undefined && (
              <Progress
                percent={Math.min(100, Math.round(progress.percent))}
                size="small"
                style={{ margin: 0, width: 160 }}
              />
            )}
          </Flexbox>
        );
      }

      if (!isAvailable) {
        if (status?.supportedOnCurrentPlatform === false) {
          // 左侧 ToolStatusDisplay 已经渲染「当前平台不支持」,右侧不再重复
          return null;
        }
        return (
          <Button
            loading={currentAction === 'install'}
            size="small"
            onClick={() => handleInstall(toolName)}
          >
            {t('settingSystemTools.install.action')}
          </Button>
        );
      }

      if (isPortable && isManaged) {
        return (
          <Dropdown
            menu={{
              items: [
                {
                  key: 'reinstall',
                  label: t('settingSystemTools.install.reinstall'),
                  onClick: () => handleReinstall(toolName),
                },
                {
                  danger: true,
                  key: 'uninstall',
                  label: t('settingSystemTools.install.uninstall'),
                  onClick: () => handleUninstall(toolName),
                },
              ],
            }}
          >
            <Button loading={isBusy} size="small">
              <Flexbox horizontal align="center" gap={4}>
                {t('settingSystemTools.install.installed')}
                <Icon icon={ChevronDown} size={12} />
              </Flexbox>
            </Button>
          </Dropdown>
        );
      }

      return (
        <Button disabled size="small">
          {t('settingSystemTools.install.installed')}
        </Button>
      );
    },
    [busyActions, handleInstall, handleReinstall, handleUninstall, progressMap, t],
  );

  const formItems = useMemo<FormGroupItemType[]>(
    () =>
      Object.entries(TOOL_CATEGORIES).map(([, categoryConfig]) => ({
        children: categoryConfig.tools.map((tool) => {
          const status = toolStatuses[tool.name];
          const label = (
            <Flexbox horizontal align="center" gap={8}>
              <Text>{tool.name}</Text>
              {status?.version && (
                <Tag color="processing" style={{ marginInlineStart: 0 }}>
                  {status.version}
                </Tag>
              )}
            </Flexbox>
          );
          return {
            children: (
              <Flexbox horizontal align="center" gap={12} justify="flex-end">
                <ToolStatusDisplay isDetecting={detecting} status={status} />
                {renderActionArea(tool.name, status)}
              </Flexbox>
            ),
            desc: t(tool.descKey),
            label,
            minWidth: undefined,
          };
        }),
        desc: t(categoryConfig.descKey),
        title: t(categoryConfig.titleKey),
      })),
    [detecting, renderActionArea, t, toolStatuses],
  );

  if (loading) {
    return <Skeleton active paragraph={{ rows: 8 }} title={false} />;
  }

  return (
    <Form
      collapsible={false}
      items={formItems}
      itemsType={'group'}
      variant={'filled'}
      footer={
        <Flexbox
          horizontal
          align="center"
          gap={16}
          justify="flex-end"
          style={{ marginBlockStart: 8 }}
        >
          <Text type="secondary">{t('settingSystemTools.autoSelectDesc')}</Text>
          <Button
            icon={<Icon icon={RefreshCw} spin={detecting} />}
            loading={detecting}
            onClick={handleRedetect}
          >
            {t('settingSystemTools.redetect')}
          </Button>
        </Flexbox>
      }
      {...FORM_STYLE}
    />
  );
});

export default ToolDetectorSection;
