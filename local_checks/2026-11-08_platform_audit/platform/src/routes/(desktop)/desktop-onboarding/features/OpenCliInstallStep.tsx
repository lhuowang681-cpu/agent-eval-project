'use client';

import { Block, Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CheckCircle2, Loader2Icon, Puzzle, RefreshCw, Undo2Icon, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { openCliService, type OpenCliStatus } from '@/services/electron/openCli';

import LobeMessage from '../components/LobeMessage';

type OpenCliPhase = 'detecting' | 'idle' | 'opening' | 'polling' | 'connected' | 'error';

interface OpenCliInstallStepProps {
  onBack: () => void;
  onNext: () => void;
}

const POLL_INTERVAL = 2000;

const OpenCliInstallStep = memo<OpenCliInstallStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');

  const [status, setStatus] = useState<OpenCliStatus>();
  const [phase, setPhase] = useState<OpenCliPhase>('detecting');
  const [checking, setChecking] = useState(false);
  const cancelledRef = useRef(false);

  const runDoctor = useCallback(async (): Promise<boolean> => {
    try {
      const r = await openCliService.runDoctor();
      return r.connected;
    } catch (error) {
      console.error('[OpenCliInstallStep] runDoctor failed:', error);
      return false;
    }
  }, []);

  // First entry: probe status + doctor; jump straight to connected if already good.
  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      let s: OpenCliStatus | undefined;
      try {
        s = await openCliService.getStatus();
      } catch (error) {
        console.error('[OpenCliInstallStep] getStatus failed:', error);
      }
      if (cancelledRef.current) return;
      setStatus(s);

      if (!s || s.installed === false) {
        setPhase('error');
        return;
      }
      const connected = await runDoctor();
      if (cancelledRef.current) return;
      setPhase(connected ? 'connected' : 'idle');
    })();

    return () => {
      cancelledRef.current = true;
    };
  }, [runDoctor]);

  // Poll doctor every 2s once the user has opened the store page.
  useEffect(() => {
    if (phase !== 'polling') return;
    let cancelled = false;

    const tick = async () => {
      const connected = await runDoctor();
      if (cancelled) return;
      if (connected) setPhase('connected');
    };

    void tick();
    const id = setInterval(tick, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, runDoctor]);

  const handleOpenChrome = useCallback(async () => {
    setPhase('opening');
    try {
      await openCliService.openExtensionPage();
    } catch (error) {
      console.error('[OpenCliInstallStep] openExtensionPage failed:', error);
    } finally {
      setPhase('polling');
    }
  }, []);

  const handleRecheck = useCallback(async () => {
    setChecking(true);
    try {
      const connected = await runDoctor();
      if (connected) setPhase('connected');
    } finally {
      setChecking(false);
    }
  }, [runDoctor]);

  const isConnected = phase === 'connected';
  const isError = phase === 'error';
  const isPolling = phase === 'polling';
  const isOpening = phase === 'opening';
  const isDetecting = phase === 'detecting';

  const statusControl = (() => {
    if (isDetecting) {
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
          <Text type={'secondary'}>{t('screen7.status.detecting')}</Text>
        </Flexbox>
      );
    }

    if (isConnected) {
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Icon color={cssVar.colorSuccess} icon={CheckCircle2} size={16} />
          <Text type={'success'}>{t('screen7.status.connected')}</Text>
        </Flexbox>
      );
    }

    if (isError) {
      return (
        <Flexbox horizontal align={'center'} gap={8} justify={'flex-end'}>
          <Icon color={cssVar.colorError} icon={XCircle} size={16} />
          <Text type={'secondary'}>{t('screen7.errors.notInstalled')}</Text>
        </Flexbox>
      );
    }

    if (isPolling) {
      return (
        <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
            <Text type={'secondary'}>{t('screen7.waiting')}</Text>
          </Flexbox>
          <Button
            icon={<Icon icon={RefreshCw} />}
            loading={checking}
            size={'small'}
            onClick={handleRecheck}
          >
            {t('screen7.actions.recheck')}
          </Button>
        </Flexbox>
      );
    }

    // idle
    return (
      <Flexbox horizontal align={'center'} gap={12} justify={'flex-end'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorError} icon={XCircle} size={16} />
          <Text type={'secondary'}>{t('screen7.status.disconnected')}</Text>
        </Flexbox>
        <Button
          icon={<Icon icon={Puzzle} />}
          loading={isOpening}
          type={'primary'}
          onClick={handleOpenChrome}
        >
          {t('screen7.actions.openChrome')}
        </Button>
      </Flexbox>
    );
  })();

  return (
    <Center gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox style={{ width: '100%' }}>
        <LobeMessage sentences={[t('screen7.title'), t('screen7.title2'), t('screen7.title3')]} />
        <Text as={'p'}>{t('screen7.description')}</Text>
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
            background: isConnected ? cssVar.colorFillSecondary : undefined,
            borderColor: isConnected ? cssVar.colorSuccess : undefined,
          }}
        >
          <Block align={'center'} height={40} justify={'center'} variant={'outlined'} width={40}>
            <Icon color={cssVar.colorTextDescription} icon={Puzzle} size={20} />
          </Block>
          <Flexbox gap={2} style={{ flex: 1 }}>
            <Text weight={500}>{t('screen7.status.label')}</Text>
            <Text color={cssVar.colorTextSecondary} fontSize={12}>
              {t('screen7.status.desc')}
            </Text>
          </Flexbox>
        </Block>
        <Flexbox align={'flex-end'} gap={4} paddingBlock={'0 8px'} paddingInline={'12px 12px'}>
          {statusControl}
          {isError && status?.error && (
            <Text fontSize={12} type={'secondary'}>
              {status.error}
            </Text>
          )}
        </Flexbox>
      </Block>
      <Flexbox horizontal align={'center'} justify={'space-between'} style={{ width: '100%' }}>
        <Button
          icon={Undo2Icon}
          style={{ color: cssVar.colorTextDescription }}
          type={'text'}
          onClick={onBack}
        >
          {t('back')}
        </Button>
        <Flexbox horizontal align={'center'} gap={8}>
          {!isConnected && !isDetecting && (
            <Button
              size={'small'}
              style={{ color: cssVar.colorTextDescription }}
              type={'text'}
              onClick={onNext}
            >
              {t('screen7.actions.skip')}
            </Button>
          )}
          <Button disabled={!isConnected} type={'primary'} onClick={onNext}>
            {t('next')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Center>
  );
});

OpenCliInstallStep.displayName = 'OpenCliInstallStep';

export default OpenCliInstallStep;
