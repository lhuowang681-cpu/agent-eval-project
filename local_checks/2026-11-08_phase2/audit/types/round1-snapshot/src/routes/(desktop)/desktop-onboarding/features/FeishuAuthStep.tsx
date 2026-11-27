'use client';

import { useWatchBroadcast } from '@lobechat/electron-client-ipc';
import { Block, Button, Center, Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2, ExternalLink, Loader2Icon, LogIn, Undo2Icon, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FeishuCliAuthStatus,
  feishuCliService,
  type FeishuCliStartLoginResult,
  type FeishuCliStatus,
} from '@/services/electron/feishuCli';

import LobeMessage from '../components/LobeMessage';

type LoginPhase = 'idle' | 'starting' | 'waiting';

interface FeishuAuthStepProps {
  onBack: () => void;
  onNext: () => void;
}

const FeishuAuthStep = memo<FeishuAuthStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');

  const [status, setStatus] = useState<FeishuCliStatus>();
  const [auth, setAuth] = useState<FeishuCliAuthStatus>();
  const [phase, setPhase] = useState<LoginPhase>('idle');
  const [pending, setPending] = useState<FeishuCliStartLoginResult>();
  const [resultText, setResultText] = useState<string>();
  const [initialLoaded, setInitialLoaded] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        feishuCliService.getStatus(),
        feishuCliService.getAuthStatus(),
      ]);
      setStatus(s);
      setAuth(a);
    } catch (error) {
      console.error('[FeishuAuthStep] Failed to get Feishu CLI status:', error);
    } finally {
      setInitialLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // The verification page is opened in the external browser; re-check on focus.
  useWatchBroadcast('windowFocused', () => {
    fetchStatus();
  });

  const handleStartLogin = useCallback(async () => {
    setResultText(undefined);
    setPhase('starting');

    let res: FeishuCliStartLoginResult;
    try {
      res = await feishuCliService.startLogin();
    } catch (error) {
      console.error('[FeishuAuthStep] startLogin failed:', error);
      setResultText(t('screen6.auth.failed'));
      setPhase('idle');
      return;
    }
    if (res.error || !res.deviceCode) {
      setResultText(res.error || t('screen6.auth.failed'));
      setPhase('idle');
      return;
    }

    // Show the verification code, then wait. lark-cli blocks-polls Feishu until
    // the user approves in the opened browser page, so there is no manual
    // "I've authorized" step — just await completeLogin and let it resolve.
    setPending(res);
    setPhase('waiting');
    try {
      const done = await feishuCliService.completeLogin(res.deviceCode, res.expiresIn);
      setResultText(
        done.success ? t('screen6.auth.success') : done.error || t('screen6.auth.failed'),
      );
    } catch (error) {
      console.error('[FeishuAuthStep] completeLogin failed:', error);
      setResultText(t('screen6.auth.failed'));
    } finally {
      setPending(undefined);
      setPhase('idle');
      fetchStatus();
    }
  }, [t, fetchStatus]);

  const isLoggedIn = !!auth?.loggedIn;
  const isBusy = phase !== 'idle';
  const isDetecting = !initialLoaded;

  const statusControl = (() => {
    if (isDetecting) {
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
          <Text type={'secondary'}>{t('screen6.status.detecting')}</Text>
        </Flexbox>
      );
    }

    if (phase === 'waiting') {
      return (
        <Flexbox align={'flex-end'} gap={8}>
          {pending?.userCode && (
            <Tag color={'processing'} icon={<Icon icon={ExternalLink} />}>
              {t('screen6.auth.userCode', { code: pending.userCode })}
            </Tag>
          )}
          <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
            <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            <Text style={{ maxWidth: 280, textAlign: 'right' }} type={'secondary'}>
              {t('screen6.auth.waiting')}
            </Text>
          </Flexbox>
        </Flexbox>
      );
    }

    if (phase === 'starting') {
      return <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />;
    }

    if (isLoggedIn) {
      return (
        <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon color={cssVar.colorSuccess} icon={CheckCircle2} size={16} />
            <Text type={'success'}>{t('screen6.status.loggedIn')}</Text>
          </Flexbox>
          <Button icon={<Icon icon={LogIn} />} size={'small'} onClick={handleStartLogin}>
            {t('screen6.actions.reauthorize')}
          </Button>
        </Flexbox>
      );
    }

    return (
      <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorError} icon={XCircle} size={16} />
          <Text type={'secondary'}>
            {status?.installed === false
              ? t('screen6.status.notInstalled')
              : t('screen6.status.loggedOut')}
          </Text>
        </Flexbox>
        <Button
          disabled={status?.installed === false}
          icon={<Icon icon={LogIn} />}
          type={'primary'}
          onClick={handleStartLogin}
        >
          {t('screen6.actions.authorize')}
        </Button>
      </Flexbox>
    );
  })();

  return (
    <Center gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox style={{ width: '100%' }}>
        <LobeMessage sentences={[t('screen6.title'), t('screen6.title2'), t('screen6.title3')]} />
        <Text as={'p'}>{t('screen6.description')}</Text>
      </Flexbox>
      <Block gap={12} padding={4} style={{ width: '100%' }} variant={'outlined'}>
        <Block
          horizontal
          align={'center'}
          gap={16}
          paddingBlock={8}
          paddingInline={'12px 12px'}
          variant={'borderless'}
          style={{
            background: isLoggedIn ? cssVar.colorFillSecondary : undefined,
            borderColor: isLoggedIn ? cssVar.colorSuccess : undefined,
          }}
        >
          <Block align={'center'} height={40} justify={'center'} variant={'outlined'} width={40}>
            <Icon color={cssVar.colorTextDescription} icon={ExternalLink} size={20} />
          </Block>
          <Flexbox gap={2} style={{ flex: 1 }}>
            <Text weight={500}>{t('screen6.status.label')}</Text>
            <Text color={cssVar.colorTextSecondary} fontSize={12}>
              {t('screen6.status.desc')}
            </Text>
          </Flexbox>
        </Block>
        <Flexbox align={'flex-end'} gap={4} paddingBlock={'0 8px'} paddingInline={'12px 12px'}>
          {statusControl}
          {resultText && (
            <Text fontSize={12} type={'secondary'}>
              {resultText}
            </Text>
          )}
        </Flexbox>
      </Block>
      {!isLoggedIn && !isDetecting && (
        <Text color={cssVar.colorTextDescription} fontSize={12}>
          {t('screen6.required')}
        </Text>
      )}
      <Flexbox horizontal align={'center'} justify={'space-between'} style={{ width: '100%' }}>
        <Button
          icon={Undo2Icon}
          style={{ color: cssVar.colorTextDescription }}
          type={'text'}
          onClick={onBack}
        >
          {t('back')}
        </Button>
        <Button disabled={!isLoggedIn || isBusy || isDetecting} type={'primary'} onClick={onNext}>
          {t('next')}
        </Button>
      </Flexbox>
    </Center>
  );
});

FeishuAuthStep.displayName = 'FeishuAuthStep';

export default FeishuAuthStep;
