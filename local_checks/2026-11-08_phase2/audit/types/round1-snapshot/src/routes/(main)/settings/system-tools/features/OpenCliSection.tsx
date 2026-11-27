'use client';

import { OpenCliIdentifier } from '@lobechat/builtin-skills';
import { type FormGroupItemType } from '@lobehub/ui';
import { Button, Flexbox, Form, Icon, Tag, Text, Tooltip } from '@lobehub/ui';
import { Switch } from 'antd';
import { CheckCircle2, Chrome, Loader2Icon, Stethoscope, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  type OpenCliDoctorResult,
  openCliService,
  type OpenCliStatus,
} from '@/services/electron/openCli';
import { useToolStore } from '@/store/tool';
import { builtinToolSelectors } from '@/store/tool/selectors';

// OpenCLI's local bridge daemon default port (OPENCLI_DAEMON_PORT).
const DAEMON_PORT = 19_825;

const OpenCliSection = memo(() => {
  const { t } = useTranslation('setting');

  // The toggle gates whether the OpenCLI skill is advertised to the agent. It
  // reuses the builtin-tool uninstall mechanism: when "off", `lobe-opencli` is
  // added to `uninstalledBuiltinTools` in user preferences, so aiAgent's
  // advertise filter (and the client store) drop it — the agent never sees the
  // skill and cannot invoke it. Toggling back on removes it from the list.
  const uninstalledBuiltinTools = useToolStore(builtinToolSelectors.uninstalledBuiltinTools);
  const installBuiltinTool = useToolStore((s) => s.installBuiltinTool);
  const uninstallBuiltinTool = useToolStore((s) => s.uninstallBuiltinTool);
  const enabled = !uninstalledBuiltinTools.includes(OpenCliIdentifier);

  const [status, setStatus] = useState<OpenCliStatus>();
  const [doctor, setDoctor] = useState<OpenCliDoctorResult>();
  const [checking, setChecking] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await openCliService.getStatus());
    } catch (error) {
      console.error('Failed to get OpenCLI status:', error);
    }
  }, []);

  useEffect(() => {
    if (enabled) fetchStatus();
  }, [enabled, fetchStatus]);

  const handleToggle = useCallback(
    (next: boolean) => {
      if (next) {
        void installBuiltinTool(OpenCliIdentifier);
      } else {
        void uninstallBuiltinTool(OpenCliIdentifier);
      }
    },
    [installBuiltinTool, uninstallBuiltinTool],
  );

  const handleInstallExtension = useCallback(async () => {
    try {
      await openCliService.openExtensionPage();
    } catch (error) {
      console.error('Failed to open OpenCLI extension page:', error);
    }
  }, []);

  const handleRunDoctor = useCallback(async () => {
    setChecking(true);
    try {
      setDoctor(await openCliService.runDoctor());
    } catch (error) {
      console.error('Failed to run opencli doctor:', error);
    } finally {
      setChecking(false);
    }
  }, []);

  const versionChildren = status?.installed ? (
    <Flexbox horizontal align="center" gap={8} justify="flex-end">
      <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
      <Text type="success">{t('settingSystemTools.status.available')}</Text>
      {status.version && (
        <Tag color="processing" style={{ marginInlineStart: 0 }}>
          {status.version}
        </Tag>
      )}
    </Flexbox>
  ) : (
    <Tooltip title={status?.error || undefined}>
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
        <Text type="secondary">{t('settingSystemTools.openCli.notInstalled')}</Text>
      </Flexbox>
    </Tooltip>
  );

  const doctorResult = (() => {
    if (checking) {
      return (
        <Flexbox horizontal align="center" gap={8}>
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
          <Text type="secondary">{t('settingSystemTools.openCli.checking')}</Text>
        </Flexbox>
      );
    }
    if (!doctor) return null;
    return doctor.connected ? (
      <Flexbox horizontal align="center" gap={8}>
        <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
        <Text type="success">{t('settingSystemTools.openCli.connected')}</Text>
      </Flexbox>
    ) : (
      <Tooltip title={doctor.stderr || doctor.stdout || undefined}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
          <Text type="secondary">{t('settingSystemTools.openCli.disconnected')}</Text>
        </Flexbox>
      </Tooltip>
    );
  })();

  const children: FormGroupItemType['children'] = [
    {
      children: <Switch checked={enabled} onChange={handleToggle} />,
      desc: t('settingSystemTools.openCli.enableDesc'),
      label: t('settingSystemTools.openCli.enable'),
      minWidth: undefined,
    },
  ];

  if (enabled) {
    children.push(
      {
        children: versionChildren,
        desc: t('settingSystemTools.openCli.versionDesc', { port: DAEMON_PORT }),
        label: t('settingSystemTools.openCli.versionLabel'),
        minWidth: undefined,
      },
      {
        children: (
          <Button icon={<Icon icon={Chrome} />} onClick={handleInstallExtension}>
            {t('settingSystemTools.openCli.step1.action')}
          </Button>
        ),
        desc: t('settingSystemTools.openCli.step1.desc'),
        label: t('settingSystemTools.openCli.step1.title'),
        minWidth: undefined,
      },
      {
        children: (
          <Flexbox horizontal align="center" gap={12} justify="flex-end">
            {doctorResult}
            <Button icon={<Icon icon={Stethoscope} />} loading={checking} onClick={handleRunDoctor}>
              {t('settingSystemTools.openCli.step2.action')}
            </Button>
          </Flexbox>
        ),
        desc: t('settingSystemTools.openCli.step2.desc'),
        label: t('settingSystemTools.openCli.step2.title'),
        minWidth: undefined,
      },
    );
  }

  const formItems: FormGroupItemType[] = [
    {
      children,
      desc: t('settingSystemTools.openCli.desc'),
      title: t('settingSystemTools.openCli.title'),
    },
  ];

  return (
    <Form
      collapsible={false}
      items={formItems}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default OpenCliSection;
