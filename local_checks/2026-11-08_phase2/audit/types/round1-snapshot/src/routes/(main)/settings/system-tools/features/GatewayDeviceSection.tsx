'use client';

import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';
import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { type FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Icon, Tag, Text } from '@lobehub/ui';
import { Switch } from 'antd';
import { CheckCircle2, Loader2Icon, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  gatewayConnectionService,
  type GatewayDeviceInfo,
} from '@/services/electron/gatewayConnection';

const GatewayDeviceSection = memo(() => {
  const { t } = useTranslation('setting');

  const [status, setStatus] = useState<GatewayConnectionStatus>('disconnected');
  const [info, setInfo] = useState<GatewayDeviceInfo>();
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, i] = await Promise.all([
        gatewayConnectionService.getConnectionStatus(),
        gatewayConnectionService.getDeviceInfo(),
      ]);
      setStatus(s);
      setInfo(i);
    } catch (error) {
      console.error('Failed to get gateway connection status:', error);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live status updates broadcast from the main process while (dis)connecting.
  useWatchBroadcast('gatewayConnectionStatusChanged', ({ status: next }) => {
    setStatus(next);
  });

  const enabled = status === 'connected' || status === 'connecting' || status === 'authenticating';

  const handleToggle = useCallback(
    async (checked: boolean) => {
      setPending(true);
      try {
        if (checked) await gatewayConnectionService.connect();
        else await gatewayConnectionService.disconnect();
      } catch (error) {
        console.error('Failed to toggle gateway connection:', error);
      } finally {
        setPending(false);
        refresh();
      }
    },
    [refresh],
  );

  const statusIndicator = (() => {
    if (status === 'connecting' || status === 'authenticating' || status === 'reconnecting') {
      return (
        <Flexbox horizontal align="center" gap={8} justify="flex-end">
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
          <Text type="secondary">{t('settingSystemTools.gatewayDevice.status.connecting')}</Text>
        </Flexbox>
      );
    }
    if (status === 'connected') {
      return (
        <Flexbox horizontal align="center" gap={8} justify="flex-end">
          <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
          <Text type="success">{t('settingSystemTools.gatewayDevice.status.connected')}</Text>
        </Flexbox>
      );
    }
    return (
      <Flexbox horizontal align="center" gap={8} justify="flex-end">
        <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
        <Text type="secondary">{t('settingSystemTools.gatewayDevice.status.disconnected')}</Text>
      </Flexbox>
    );
  })();

  const children: FormGroupItemType['children'] = [
    {
      children: <Switch checked={enabled} loading={pending} onChange={handleToggle} />,
      desc: t('settingSystemTools.gatewayDevice.enable.desc'),
      label: t('settingSystemTools.gatewayDevice.enable.label'),
      minWidth: undefined,
    },
    {
      children: statusIndicator,
      desc: t('settingSystemTools.gatewayDevice.status.desc'),
      label: t('settingSystemTools.gatewayDevice.status.label'),
      minWidth: undefined,
    },
    {
      children: info ? (
        <Flexbox align="flex-end" gap={4}>
          <Text type="secondary">{info.name}</Text>
          <Tag style={{ marginInlineStart: 0 }}>{info.deviceId}</Tag>
        </Flexbox>
      ) : (
        <Text type="secondary">-</Text>
      ),
      desc: t('settingSystemTools.gatewayDevice.device.desc'),
      label: t('settingSystemTools.gatewayDevice.device.label'),
      minWidth: undefined,
    },
  ];

  const formItems: FormGroupItemType[] = [
    {
      children,
      desc: t('settingSystemTools.gatewayDevice.desc'),
      title: t('settingSystemTools.gatewayDevice.title'),
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

export default GatewayDeviceSection;
