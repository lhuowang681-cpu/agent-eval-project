'use client';

import { Button, Flexbox, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { feishuTokenService } from '@/services/feishuToken';

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

interface FeishuAuthRequiredCardProps {
  authUrl: string;
}

const FeishuAuthRequiredCard = memo<FeishuAuthRequiredCardProps>(({ authUrl }) => {
  const { t } = useTranslation('feishuAuth');
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthorize = useCallback(async () => {
    setIsAuthorizing(true);
    setError(null);

    try {
      await feishuTokenService.fulfillUserAuthorization();
      // 保持 loading 直到 MCP 重试完成、父组件卸载本卡片
    } catch (err) {
      setIsAuthorizing(false);
      setError((err as Error).message || t('error'));
    }
  }, [t]);

  return (
    <Flexbox horizontal className={styles.container} gap={12} width="100%">
      <Text style={{ flex: 1, fontSize: 13 }} type="secondary">
        {error || (isAuthorizing ? t('authorizing') : t('card.description'))}
      </Text>
      <Button
        disabled={isAuthorizing}
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

FeishuAuthRequiredCard.displayName = 'FeishuAuthRequiredCard';

export default FeishuAuthRequiredCard;
