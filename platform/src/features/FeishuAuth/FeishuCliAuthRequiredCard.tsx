'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  feishuCliService,
  onFeishuCliAuthComplete,
  onFeishuCliAuthFailed,
} from '@/services/electron/feishuCli';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    align-items: center;
    justify-content: space-between;

    padding-block: 6px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,
}));

interface FeishuCliAuthRequiredCardProps {
  /**
   * 报错点名的缺失 scope。缺 scope 触发时按需补授只请求这几个（lark-cli 并入基线集合）；
   * 抽不到时为空，startLogin 回退全量基线授权。
   */
  scopes?: string[];
}

/**
 * Desktop 版飞书授权卡片：当 lark-cli（经 execScript 跑）报鉴权/缺 scope 错误时，
 * 在聊天里就地触发桌面端的 device-flow 重新授权（token 进 OS keychain），
 * 授权完后自动发一条消息让 agent 继续。
 */
const FeishuCliAuthRequiredCard = memo<FeishuCliAuthRequiredCardProps>(({ scopes }) => {
  const { t } = useTranslation('feishuAuth');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = useCallback(async () => {
    setIsAuthorizing(true);
    setError(null);

    try {
      const res = await feishuCliService.startLogin(scopes);
      if (res.error || !res.deviceCode) {
        throw new Error(res.error || t('error'));
      }
      // lark-cli 会阻塞轮询直到用户在打开的浏览器页完成授权
      const result = await feishuCliService.completeLogin(res.deviceCode, res.expiresIn);
      if (!result.success) {
        throw new Error(result.error || t('error'));
      }
      setDone(true);

      // 授权成功,resolve gate,让挂起的 tool 执行继续(自动重试)
      onFeishuCliAuthComplete();
    } catch (err) {
      const error = err as Error;
      setError(error.message || t('error'));
      // 授权失败,reject gate
      onFeishuCliAuthFailed(error);
    } finally {
      setIsAuthorizing(false);
    }
  }, [t, scopes]);

  return (
    <Flexbox horizontal className={styles.container} gap={12} width="100%">
      <Text style={{ flex: 1, fontSize: 13 }} type="secondary">
        {error ||
          (done ? t('cli.success') : isAuthorizing ? t('authorizing') : t('cli.description'))}
      </Text>
      <Button
        disabled={isAuthorizing || done}
        loading={isAuthorizing}
        size="small"
        type="primary"
        onClick={handleAuthorize}
      >
        {isAuthorizing ? t('authorizing') : t('authorize')}
      </Button>
    </Flexbox>
  );
});

FeishuCliAuthRequiredCard.displayName = 'FeishuCliAuthRequiredCard';

export default FeishuCliAuthRequiredCard;
