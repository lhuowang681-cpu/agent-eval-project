import { type FormItemProps } from '@lobehub/ui';

import { KeyVaultsConfigKey, LLMProviderPetaKeyIdKey } from '../../const';

export const TRIPFLOW_PETA_KEY_ID_PATTERN = /^(?:peta-)?\d+$/;

interface TripflowPetaKeyIdConfigItemText {
  desc: string;
  title: string;
}

export const getTripflowPetaKeyIdConfigItems = ({
  desc,
  title,
}: TripflowPetaKeyIdConfigItemText): FormItemProps[] => [
  {
    desc,
    label: title,
    name: [KeyVaultsConfigKey, LLMProviderPetaKeyIdKey],
    rules: [
      {
        required: true,
      },
      {
        pattern: TRIPFLOW_PETA_KEY_ID_PATTERN,
      },
    ],
  },
];
