import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { DownloadIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { formatIntergerNumber } from '@/utils/format';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    token: css`
      border-radius: 4px;

      font-family: ${cssVar.fontFamilyCode};
      font-size: 11px;
      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
    `,
    usageText: css`
      font-size: 12px;
      color: ${cssVar.colorTextDescription};
    `,
  };
});

interface TokenTagProps {
  installCount?: number;
  placement?: 'top' | 'right';
  usageCount?: number;
}

const TokenTag = memo<TokenTagProps>(({ installCount, usageCount, placement = 'right' }) => {
  const { t } = useTranslation('discover');
  const { showMarketStats } = useServerConfigStore(featureFlagsSelectors);

  if (showMarketStats === false) return null;

  return (
    <Flexbox horizontal align={'center'} gap={4}>
      <Tooltip
        placement={placement}
        styles={{ root: { pointerEvents: 'none' } }}
        title={t('assistants.installCount')}
      >
        <Tag className={styles.token} icon={<Icon icon={DownloadIcon} />}>
          {formatIntergerNumber(installCount || 0)}
        </Tag>
      </Tooltip>
      <span className={styles.usageText}>
        {t('assistants.usageCount')} {formatIntergerNumber(usageCount || 0)}
      </span>
    </Flexbox>
  );
});

export default TokenTag;
