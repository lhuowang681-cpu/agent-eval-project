'use client';

import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { useTranslation } from 'react-i18next';

import { getProviderDescription } from '../../utils/providerI18n';
import ClientMode from './ClientMode';
import ProviderDetail from './index';

const ProviderDetialPage = (props: { id?: string | null }) => {
  const { id } = props;
  const { t } = useTranslation('providers');

  const builtinProviderCard = DEFAULT_MODEL_PROVIDER_LIST.find((v) => v.id === id);
  // if builtin provider
  if (!!builtinProviderCard)
    return (
      <ProviderDetail
        source={'builtin'}
        {...builtinProviderCard}
        description={getProviderDescription({
          description: builtinProviderCard.description,
          id: builtinProviderCard.id,
          isCustom: false,
          t,
        })}
      />
    );

  if (id) {
    return <ClientMode id={id} />;
  }
  return null;
};

export default ProviderDetialPage;
