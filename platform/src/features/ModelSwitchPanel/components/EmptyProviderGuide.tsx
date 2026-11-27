import { Block, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { LucideArrowRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { styles } from '../styles';

export const EmptyProviderGuide = memo(() => {
  const { t } = useTranslation('components');
  const navigate = useNavigate();

  return (
    <Block
      clickable
      horizontal
      className={styles.menuItem}
      gap={8}
      style={{ color: cssVar.colorTextTertiary }}
      variant={'borderless'}
      onClick={() => navigate('/settings/provider/all')}
    >
      {t('ModelSwitchPanel.emptyProvider')}
      <Icon icon={LucideArrowRight} />
    </Block>
  );
});

EmptyProviderGuide.displayName = 'EmptyProviderGuide';
