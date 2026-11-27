import { DEFAULT_MODEL_PROVIDER_LIST } from 'model-bank/modelProviders';
import { describe, expect, it } from 'vitest';

import providers from '@/locales/default/providers';

import { getProviderDescription, getProviderDescriptionKey } from './providerI18n';

describe('providerI18n', () => {
  it('falls back to the provider description when the translation key is missing', () => {
    const description = getProviderDescription({
      description: 'Raw provider description',
      id: 'missing-provider',
      isCustom: false,
      t: (key) => key,
    });

    expect(description).toBe('Raw provider description');
  });

  it('keeps custom provider descriptions unchanged', () => {
    const description = getProviderDescription({
      description: 'Custom provider description',
      id: 'custom-provider',
      isCustom: true,
      t: () => 'Translated description',
    });

    expect(description).toBe('Custom provider description');
  });

  it('has localized descriptions for every built-in provider shown in settings', () => {
    for (const provider of DEFAULT_MODEL_PROVIDER_LIST) {
      const key = getProviderDescriptionKey(provider.id);

      expect(providers[key as keyof typeof providers], key).toBeTruthy();
    }
  });
});
