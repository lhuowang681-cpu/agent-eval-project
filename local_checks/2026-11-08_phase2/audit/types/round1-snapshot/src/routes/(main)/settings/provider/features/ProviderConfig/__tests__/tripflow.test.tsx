import { describe, expect, it } from 'vitest';

import { LLMProviderPetaKeyIdKey } from '../../../const';
import { getTripflowPetaKeyIdConfigItems } from '../tripflowPetaKeyId';

describe('TripFlow provider config fields', () => {
  it('uses only petaKeyId as the TripFlow credential input', () => {
    const items = getTripflowPetaKeyIdConfigItems({
      desc: 'providerModels.config.petaKeyId.desc',
      title: 'providerModels.config.petaKeyId.title',
    });

    expect(items).toHaveLength(1);
    expect(items[0].name).toEqual(['keyVaults', LLMProviderPetaKeyIdKey]);
    expect(items[0].label).toBe('providerModels.config.petaKeyId.title');
  });
});
