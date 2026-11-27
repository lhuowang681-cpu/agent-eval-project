'use client';

import { ProviderIcon } from '@lobehub/icons';
import { Button } from '@lobehub/ui';
import { ModelProvider } from 'model-bank';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import urlJoin from 'url-join';

import BaseErrorForm from '@/features/Conversation/Error/BaseErrorForm';
import { useProviderName } from '@/hooks/useProviderName';
import { type GlobalLLMProviderKey } from '@/types/user/settings/modelProvider';

interface GenerationInvalidAPIKeyProps {
  onNavigate?: () => void;
  provider?: string;
  variant?: 'missing' | 'invalid';
}

const GenerationInvalidAPIKey = memo<GenerationInvalidAPIKeyProps>(
  ({ provider, onNavigate, variant = 'invalid' }) => {
    const { t } = useTranslation(['modelProvider', 'error']);
    const navigate = useNavigate();
    const providerName = useProviderName(provider as GlobalLLMProviderKey);
    const isInvalid = variant === 'invalid';

    const title = isInvalid
      ? t('unlock.apiKey.invalidTitle', { name: providerName, ns: 'error' })
      : t('unlock.apiKey.title', { name: providerName, ns: 'error' });

    const desc =
      provider === ModelProvider.Bedrock
        ? t('bedrock.unlock.description')
        : isInvalid
          ? t('unlock.apiKey.invalidDescription', { name: providerName, ns: 'error' })
          : t('unlock.apiKey.description', { name: providerName, ns: 'error' });

    return (
      <BaseErrorForm
        avatar={<ProviderIcon provider={provider} shape={'square'} size={40} />}
        desc={desc}
        title={title}
        action={
          <Button
            type={'primary'}
            onClick={() => {
              navigate(urlJoin('/settings/provider', provider || 'all'));
              onNavigate?.();
            }}
          >
            {t('unlock.goToSettings', { ns: 'error' })}
          </Button>
        }
      />
    );
  },
);

GenerationInvalidAPIKey.displayName = 'GenerationInvalidAPIKey';

export default GenerationInvalidAPIKey;
