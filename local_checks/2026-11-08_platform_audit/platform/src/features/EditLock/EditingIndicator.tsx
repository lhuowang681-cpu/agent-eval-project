'use client';

import { Flexbox, Icon, Text, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Loader2Icon, PencilIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

interface EditingIndicatorProps {
  holderId?: string | null;
  pending?: boolean;
}

const EditingIndicator = memo<EditingIndicatorProps>(({ holderId, pending }) => {
  const { t } = useTranslation('chat');

  if (!holderId) {
    if (!pending) return null;

    const checkingLabel = t('taskDetail.editLock.checking');
    return (
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon spin icon={Loader2Icon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 200 }}>
          {checkingLabel}
        </Text>
      </Flexbox>
    );
  }

  const label = t('taskDetail.editLock.lockedBySomeone');

  return (
    <Tooltip title={label}>
      <Flexbox horizontal align={'center'} gap={4} style={{ color: cssVar.colorTextTertiary }}>
        <Icon icon={PencilIcon} size={14} />
        <Text ellipsis style={{ color: 'inherit', fontSize: 12, maxWidth: 200 }}>
          {label}
        </Text>
      </Flexbox>
    </Tooltip>
  );
});

EditingIndicator.displayName = 'EditingIndicator';

export default EditingIndicator;
