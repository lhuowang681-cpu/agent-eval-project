'use client';

import { Alert, Button, Flexbox, Text } from '@lobehub/ui';
import { Result, Spin } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';

import { communityApiService } from '@/services/marketApi';

type ItemType = 'skill' | 'mcp' | 'agent';

/**
 * 按 itemType 选既有 install 方法——与市场 detail 页同一调用，
 * 安装逻辑零改动。导出供单测。
 */
export const resolveInstaller = (itemType: ItemType, marketIdentifier: string) => {
  switch (itemType) {
    case 'skill': {
      return () => communityApiService.installSkill(marketIdentifier);
    }
    case 'mcp': {
      return () => communityApiService.installMcp(marketIdentifier);
    }
    case 'agent': {
      return () => communityApiService.installAgent(marketIdentifier);
    }
  }
};

const isTRPCCode = (err: unknown, code: string) => {
  const e = err as { data?: { code?: string }; code?: string };
  return e?.data?.code === code || e?.code === code;
};

export type ShareLoadError = 'notFound' | 'expired' | 'unauthorized' | 'error';

/**
 * 将 getByToken/install 抛出的错误归类为面向用户的错误态。导出供单测。
 * - CONFLICT: 分享链接已失效/撤销 → expired
 * - NOT_FOUND: 链接不存在 → notFound
 * - UNAUTHORIZED: install 为 authedProcedure，未登录接收方点击安装会 401 → unauthorized
 * - 其他（网络/500/超时/已装静默成功等）→ error
 */
export const classifyShareError = (err: unknown): ShareLoadError => {
  if (isTRPCCode(err, 'CONFLICT')) return 'expired';
  if (isTRPCCode(err, 'NOT_FOUND')) return 'notFound';
  if (isTRPCCode(err, 'UNAUTHORIZED')) return 'unauthorized';
  return 'error';
};

const ShareInstallPage = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('share');

  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [data, setData] = useState<{
    itemType: ItemType;
    marketIdentifier: string;
    name: string | null;
  } | null>(null);
  const [error, setError] = useState<ShareLoadError | null>(null);
  const [installError, setInstallError] = useState<ShareLoadError | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    communityApiService
      .getShareByToken(token)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(classifyShareError(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, retryNonce]);

  const handleInstall = async () => {
    if (!data) return;
    setInstalling(true);
    setInstallError(null);
    try {
      await resolveInstaller(data.itemType, data.marketIdentifier)();
      await communityApiService.recordShareInstall(token).catch(() => undefined);
      setInstalled(true);
    } catch (err) {
      setInstallError(classifyShareError(err));
    } finally {
      setInstalling(false);
    }
  };

  if (loading) {
    return (
      <Flexbox align={'center'} justify={'center'} style={{ height: '60vh' }}>
        <Spin />
      </Flexbox>
    );
  }

  if (error || installError) {
    const err = (error ?? installError)!;
    const status =
      err === 'expired'
        ? 'warning'
        : err === 'notFound'
          ? '404'
          : err === 'unauthorized'
            ? '403'
            : 'error';
    const title =
      err === 'expired'
        ? t('install.expired')
        : err === 'notFound'
          ? t('install.notFound')
          : err === 'unauthorized'
            ? t('install.unauthorized')
            : t('install.installFailed');
    return (
      <Flexbox align={'center'} gap={16} justify={'center'} style={{ height: '60vh', padding: 24 }}>
        <Result
          status={status}
          subTitle={<Text type={'secondary'}>{title}</Text>}
          title={title}
          extra={
            err === 'unauthorized' ? (
              <Button type={'primary'} onClick={() => navigate('/signin')}>
                {t('install.signIn')}
              </Button>
            ) : err === 'error' ? (
              <Button onClick={() => (error ? setRetryNonce((n) => n + 1) : setInstallError(null))}>
                {t('install.retry')}
              </Button>
            ) : null
          }
        />
      </Flexbox>
    );
  }

  if (installed) {
    return (
      <Flexbox align={'center'} gap={16} justify={'center'} style={{ height: '60vh', padding: 24 }}>
        <Result
          status="success"
          subTitle={<Text type={'secondary'}>{t('install.installSuccess')}</Text>}
        />
        <Button onClick={() => navigate('/')}>{t('button.done')}</Button>
      </Flexbox>
    );
  }

  const itemType = data!.itemType;
  const titleKey =
    itemType === 'skill'
      ? 'install.titleSkill'
      : itemType === 'mcp'
        ? 'install.titleMcp'
        : 'install.titleAgent';

  return (
    <Flexbox align={'center'} gap={16} justify={'center'} style={{ height: '60vh', padding: 24 }}>
      <Text fontSize={24} weight={'bold'}>
        {t(titleKey)}
      </Text>
      <Alert
        message={`${t('install.descPrefix')} ${data!.name ?? data!.marketIdentifier}`}
        type={'info'}
      />
      <Button loading={installing} type={'primary'} onClick={handleInstall}>
        {t('button.install')}
      </Button>
    </Flexbox>
  );
};

export default ShareInstallPage;
