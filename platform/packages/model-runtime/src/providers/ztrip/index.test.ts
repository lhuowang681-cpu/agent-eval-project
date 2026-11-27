// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeZtripAI, params } from './index';

testProvider({
  Runtime: LobeZtripAI,
  provider: ModelProvider.Ztrip,
  defaultBaseURL: 'https://api.openai.com/v1',
  chatDebugEnv: 'DEBUG_ZTRIP_CHAT_COMPLETION',
  chatModel: 'gpt-4o-mini',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeZtripAI - params', () => {
  it('should have correct provider', () => {
    expect(params.provider).toBe(ModelProvider.Ztrip);
  });

  describe('models function', () => {
    it('should enrich models from LOBE_DEFAULT_MODEL_LIST', async () => {
      const mockClient = {
        models: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: 'gpt-4o-mini' }, { id: 'unknown-model' }],
          }),
        },
      };

      const models = await params.models!({ client: mockClient as any });

      expect(models.length).toBe(2);
      expect(models[0].id).toBe('gpt-4o-mini');
      // Builtin ztrip catalog is empty; enrichment only matches LOBE_DEFAULT_MODEL_LIST entries with providerId ztrip
      expect(models[0].enabled).toBe(false);
    });
  });
});
