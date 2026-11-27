'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Button, Flexbox, Form, Icon, Tag, Text } from '@lobehub/ui';
import {
  CheckCircle2,
  ExternalLink,
  Loader2Icon,
  LogIn,
  LogOut,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import {
  type FeishuCliAuthStatus,
  feishuCliService,
  type FeishuCliStartLoginResult,
  type FeishuCliStatus,
} from '@/services/electron/feishuCli';

type LoginPhase = 'idle' | 'starting' | 'waiting';

const FeishuCliSection = memo(() => {
  const { t } = useTranslation('setting');

  const [status, setStatus] = useState<FeishuCliStatus>();
  const [auth, setAuth] = useState<FeishuCliAuthStatus>();
  const [phase, setPhase] = useState<LoginPhase>('idle');
  const [pending, setPending] = useState<FeishuCliStartLoginResult>();
  const [resultText, setResultText] = useState<string>();

  const fetchStatus = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        feishuCliService.getStatus(),
        feishuCliService.getAuthStatus(),
      ]);
      setStatus(s);
      setAuth(a);
    } catch (error) {
      console.error('Failed to get Feishu CLI status:', error);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleStartLogin = useCallback(async () => {
    setResultText(undefined);
    setPhase('starting');

    let res: FeishuCliStartLoginResult;
    try {
      res = await feishuCliService.startLogin();
    } catch (error) {
      console.error('Feishu startLogin failed:', error);
      setResultText(t('settingSystemTools.feishuCli.auth.failed'));
      setPhase('idle');
      return;
    }
    if (res.error || !res.deviceCode) {
      setResultText(res.error || t('settingSystemTools.feishuCli.auth.failed'));
      setPhase('idle');
      return;
    }

    // Show the verification code, then wait. lark-cli blocks-polls Feishu until
    // the user approves in the opened browser page, so there is no manual "I've
    // authorized" step — just await completeLogin and let it resolve.
    setPending(res);
    setPhase('waiting');
    try {
      const done = await feishuCliService.completeLogin(res.deviceCode, res.expiresIn);
      setResultText(
        done.success
          ? t('settingSystemTools.feishuCli.auth.success')
          : done.error || t('settingSystemTools.feishuCli.auth.failed'),
      );
    } catch (error) {
      console.error('Feishu completeLogin failed:', error);
      setResultText(t('settingSystemTools.feishuCli.auth.failed'));
    } finally {
      setPending(undefined);
      setPhase('idle');
      fetchStatus();
    }
  }, [t, fetchStatus]);

  const handleLogout = useCallback(async () => {
    setResultText(undefined);
    try {
      await feishuCliService.logout();
    } catch (error) {
      console.error('Feishu logout failed:', error);
    } finally {
      fetchStatus();
    }
  }, [fetchStatus]);

  const handleOpenDetail = useCallback(() => {
    feishuCliService.openAuthDetail();
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
    <Flexbox horizontal align="center" gap={8} justify="flex-end">
      <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
      <Text type="secondary">{t('settingSystemTools.feishuCli.notInstalled')}</Text>
    </Flexbox>
  );

  const authControl = (() => {
    if (phase === 'waiting') {
      return (
        <Flexbox align="flex-end" gap={8}>
          {pending?.userCode && (
            <Tag color="processing" icon={<Icon icon={ExternalLink} />}>
              {t('settingSystemTools.feishuCli.auth.userCode', { code: pending.userCode })}
            </Tag>
          )}
          <Flexbox horizontal align="center" gap={8} justify="flex-end">
            <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            <Text style={{ maxWidth: 320, textAlign: 'right' }} type="secondary">
              {t('settingSystemTools.feishuCli.auth.waiting')}
            </Text>
          </Flexbox>
        </Flexbox>
      );
    }

    if (phase === 'starting') {
      return <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />;
    }

    if (auth?.loggedIn) {
      return (
        <Flexbox horizontal align="center" gap={12} justify="flex-end">
          <Flexbox horizontal align="center" gap={8}>
            <Icon color="var(--ant-color-success)" icon={CheckCircle2} size={16} />
            <Text type="success">{t('settingSystemTools.feishuCli.auth.loggedIn')}</Text>
          </Flexbox>
          <Button icon={<Icon icon={LogIn} />} onClick={handleStartLogin}>
            {t('settingSystemTools.feishuCli.auth.reauthorize')}
          </Button>
          <Button icon={<Icon icon={LogOut} />} type="text" onClick={handleLogout}>
            {t('settingSystemTools.feishuCli.auth.logout')}
          </Button>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align="center" gap={12} justify="flex-end">
        <Flexbox horizontal align="center" gap={8}>
          <Icon color="var(--ant-color-error)" icon={XCircle} size={16} />
          <Text type="secondary">{t('settingSystemTools.feishuCli.auth.loggedOut')}</Text>
        </Flexbox>
        <Button
          disabled={!status?.installed}
          icon={<Icon icon={LogIn} />}
          type="primary"
          onClick={handleStartLogin}
        >
          {t('settingSystemTools.feishuCli.auth.authorize')}
        </Button>
      </Flexbox>
    );
  })();

  const children: FormGroupItemType['children'] = [
    {
      children: versionChildren,
      desc: t('settingSystemTools.feishuCli.versionDesc'),
      label: t('settingSystemTools.feishuCli.versionLabel'),
      minWidth: undefined,
    },
    {
      children: (
        <Flexbox align="flex-end" gap={4}>
          {authControl}
          {resultText && <Text type="secondary">{resultText}</Text>}
        </Flexbox>
      ),
      desc: t('settingSystemTools.feishuCli.auth.desc'),
      label: t('settingSystemTools.feishuCli.auth.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Button icon={<Icon icon={ShieldCheck} />} onClick={handleOpenDetail}>
          {t('settingSystemTools.feishuCli.detail.action')}
        </Button>
      ),
      desc: t('settingSystemTools.feishuCli.detail.desc'),
      label: t('settingSystemTools.feishuCli.detail.title'),
      minWidth: undefined,
    },
  ];

  const formItems: FormGroupItemType[] = [
    {
      children,
      desc: t('settingSystemTools.feishuCli.desc'),
      title: t('settingSystemTools.feishuCli.title'),
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

export default FeishuCliSection;
