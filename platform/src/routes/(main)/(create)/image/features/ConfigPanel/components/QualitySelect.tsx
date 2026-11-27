import { Select } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import { getQualityLabelKey } from './qualityOptions';

const QualitySelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam('quality');

  const options =
    enumValues?.map((quality) => ({
      label: t(getQualityLabelKey(quality), { defaultValue: quality }),
      value: quality,
    })) ?? [];

  return <Select options={options} style={{ width: '100%' }} value={value} onChange={setValue} />;
});

export default QualitySelect;
