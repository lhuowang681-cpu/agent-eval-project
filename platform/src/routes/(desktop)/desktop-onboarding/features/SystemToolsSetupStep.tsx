'use client';

import {
  type InstallPhase,
  type InstallProgressEvent,
  type RuntimeName,
  type ToolStatus,
  useWatchBroadcast,
} from '@lobechat/electron-client-ipc';
import { Block, Button, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { CheckCircle2, Loader2Icon, PackageOpen, Undo2Icon, XCircle } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toolDetectorService } from '@/services/electron/toolDetector';

import LobeMessage from '../components/LobeMessage';

interface SystemToolsSetupStepProps {
  onBack: () => void;
  onNext: () => void;
}

const PORTABLE_TOOLS: readonly RuntimeName[] = ['node', 'python', 'bun', 'uv', 'rg', 'fd'];

type LocalPhase = InstallPhase | 'pending' | 'succeeded' | 'failed';

interface ToolTaskState {
  error?: string;
  message?: string;
  percent?: number;
  phase: LocalPhase;
}

type StepPhase = 'detecting' | 'idle' | 'installing' | 'finished';

const phaseKey = {
  done: 'screen8.phase.done',
  download: 'screen8.phase.download',
  error: 'screen8.phase.error',
  extract: 'screen8.phase.extract',
  switch: 'screen8.phase.switch',
  verify: 'screen8.phase.verify',
} as const satisfies Record<InstallPhase, string>;

const toolDescKey = {
  bun: 'screen8.tools.bun.desc',
  fd: 'screen8.tools.fd.desc',
  node: 'screen8.tools.node.desc',
  python: 'screen8.tools.python.desc',
  rg: 'screen8.tools.rg.desc',
  uv: 'screen8.tools.uv.desc',
} as const satisfies Record<RuntimeName, string>;

const SystemToolsSetupStep = memo<SystemToolsSetupStepProps>(({ onBack, onNext }) => {
  const { t } = useTranslation('desktop-onboarding');

  const [statuses, setStatuses] = useState<Record<string, ToolStatus>>({});
  const [progress, setProgress] = useState<Partial<Record<RuntimeName, ToolTaskState>>>({});
  const [stepPhase, setStepPhase] = useState<StepPhase>('detecting');

  // Tools we actually offer: portable + supported on the current platform.
  const visibleTools = useMemo(() => {
    return PORTABLE_TOOLS.filter((name) => {
      const s = statuses[name];
      return !s || s.supportedOnCurrentPlatform !== false;
    });
  }, [statuses]);

  // First entry: detect current state and mark already-available tools as succeeded.
  // Only `available === true` is required — some paths (system PATH, cache) may not
  // set `managedBy=app` yet, but the tool is already usable for onboarding purposes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const s = await toolDetectorService.detectAllTools(true);
        if (cancelled) return;
        setStatuses(s);
        const initial: Partial<Record<RuntimeName, ToolTaskState>> = {};
        for (const name of PORTABLE_TOOLS) {
          if (s[name]?.available) {
            initial[name] = { phase: 'succeeded', percent: 100 };
          }
        }
        setProgress(initial);
      } catch (error) {
        console.error('[SystemToolsSetupStep] detectAllTools failed:', error);
      } finally {
        if (!cancelled) setStepPhase('idle');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useWatchBroadcast('toolInstallProgress', (event: InstallProgressEvent) => {
    setProgress((prev) => {
      const current = prev[event.toolName];
      // Never overwrite a terminal success with a later progress event.
      if (current?.phase === 'succeeded') return prev;
      return {
        ...prev,
        [event.toolName]: {
          error: event.error,
          message: event.message,
          percent: event.percent,
          phase: event.phase,
        },
      };
    });
  });

  const installOne = useCallback(async (name: RuntimeName) => {
    setProgress((prev) => ({
      ...prev,
      [name]: { percent: 0, phase: 'download' },
    }));
    try {
      const r = await toolDetectorService.installTool(name);
      setProgress((prev) => ({
        ...prev,
        [name]: r.success
          ? { percent: 100, phase: 'succeeded' }
          : { error: r.error, phase: 'failed' },
      }));
    } catch (error) {
      setProgress((prev) => ({
        ...prev,
        [name]: { error: (error as Error).message, phase: 'failed' },
      }));
    }
  }, []);

  const pendingTools = useMemo(
    () => visibleTools.filter((name) => progress[name]?.phase !== 'succeeded'),
    [progress, visibleTools],
  );

  const handleInstallAll = useCallback(async () => {
    setStepPhase('installing');
    // Install in parallel — the main process handles per-tool download/verify/extract
    // independently and the progress broadcast keys by toolName, so the UI happily
    // fans out to multiple progress bars at once.
    await Promise.all(pendingTools.map((name) => installOne(name)));
    setStepPhase('finished');
    // Refresh detection so future re-entries pick up the newly installed tools.
    try {
      const s = await toolDetectorService.detectAllTools(true);
      setStatuses(s);
    } catch (error) {
      console.error('[SystemToolsSetupStep] post-install detect failed:', error);
    }
  }, [installOne, pendingTools]);

  const handleRetry = useCallback(
    (name: RuntimeName) => {
      void installOne(name);
    },
    [installOne],
  );

  const hasFailure = useMemo(
    () => Object.values(progress).some((p) => p?.phase === 'failed'),
    [progress],
  );
  const isDetecting = stepPhase === 'detecting';
  const allDone = !isDetecting && pendingTools.length === 0;
  const isInstalling = stepPhase === 'installing';
  const isFinished = stepPhase === 'finished';

  const renderRight = (name: RuntimeName) => {
    if (isDetecting) {
      return (
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />
          <Text fontSize={12} type={'secondary'}>
            {t('screen8.status.detecting')}
          </Text>
        </Flexbox>
      );
    }
    const p = progress[name];
    if (!p || p.phase === 'pending') {
      return (
        <Text fontSize={12} type={'secondary'}>
          {t('screen8.status.pending')}
        </Text>
      );
    }
    if (p.phase === 'succeeded') {
      return (
        <Flexbox horizontal align={'center'} gap={6}>
          <Icon color={cssVar.colorSuccess} icon={CheckCircle2} size={16} />
          <Text type={'success'}>{t('screen8.status.installed')}</Text>
        </Flexbox>
      );
    }
    if (p.phase === 'failed') {
      return (
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorError} icon={XCircle} size={16} />
          <Text fontSize={12} type={'secondary'}>
            {t('screen8.status.failed')}
          </Text>
          <Button disabled={isInstalling} size={'small'} onClick={() => handleRetry(name)}>
            {t('screen8.actions.retry')}
          </Button>
        </Flexbox>
      );
    }
    // In-flight install phase.
    const labelKey = phaseKey[p.phase as InstallPhase] ?? 'screen8.phase.download';
    return (
      <Flexbox align={'flex-end'} gap={4} style={{ minWidth: 180 }}>
        <Text fontSize={12} type={'secondary'}>
          {t(labelKey)}
        </Text>
        <Progress
          percent={Math.min(100, Math.round(p.percent ?? 0))}
          size={'small'}
          style={{ margin: 0, width: 180 }}
        />
      </Flexbox>
    );
  };

  const primaryButton = (() => {
    if (isDetecting) {
      return (
        <Button disabled loading icon={<Icon icon={Loader2Icon} />} type={'primary'}>
          {t('screen8.actions.detecting')}
        </Button>
      );
    }
    if (isInstalling) {
      return (
        <Button disabled loading icon={<Icon icon={Loader2Icon} />} type={'primary'}>
          {t('screen8.actions.installing')}
        </Button>
      );
    }
    if (isFinished || allDone) {
      return (
        <Button type={'primary'} onClick={onNext}>
          {t('next')}
        </Button>
      );
    }
    return (
      <Button icon={<Icon icon={PackageOpen} />} type={'primary'} onClick={handleInstallAll}>
        {t('screen8.actions.installAll')}
      </Button>
    );
  })();

  return (
    <Center gap={16} style={{ height: '100%', minHeight: '100%' }}>
      <Flexbox style={{ width: '100%' }}>
        <LobeMessage sentences={[t('screen8.title'), t('screen8.title2'), t('screen8.title3')]} />
        <Text as={'p'}>{t('screen8.description')}</Text>
      </Flexbox>
      <Block gap={0} padding={4} style={{ width: '100%' }} variant={'outlined'}>
        {visibleTools.map((name) => (
          <Block
            horizontal
            align={'center'}
            gap={16}
            key={name}
            paddingBlock={8}
            paddingInline={'12px 12px'}
            variant={'borderless'}
          >
            <Flexbox gap={2} style={{ flex: 1 }}>
              <Text weight={500}>{name}</Text>
              <Text color={cssVar.colorTextSecondary} fontSize={12}>
                {t(toolDescKey[name])}
              </Text>
            </Flexbox>
            <Flexbox align={'flex-end'} style={{ minWidth: 200 }}>
              {renderRight(name)}
            </Flexbox>
          </Block>
        ))}
      </Block>
      {isFinished && hasFailure && (
        <Text color={cssVar.colorTextDescription} fontSize={12}>
          {t('screen8.partialFailureHint')}
        </Text>
      )}
      <Flexbox horizontal align={'center'} justify={'space-between'} style={{ width: '100%' }}>
        <Button
          disabled={isInstalling || isDetecting}
          icon={Undo2Icon}
          style={{ color: cssVar.colorTextDescription }}
          type={'text'}
          onClick={onBack}
        >
          {t('back')}
        </Button>
        <Flexbox horizontal align={'center'} gap={8}>
          {!isFinished && !allDone && !isDetecting && (
            <Button
              size={'small'}
              style={{ color: cssVar.colorTextDescription }}
              type={'text'}
              onClick={onNext}
            >
              {t('screen8.actions.skip')}
            </Button>
          )}
          {primaryButton}
        </Flexbox>
      </Flexbox>
    </Center>
  );
});

SystemToolsSetupStep.displayName = 'SystemToolsSetupStep';

export default SystemToolsSetupStep;
