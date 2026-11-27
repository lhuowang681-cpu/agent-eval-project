// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it, vi } from 'vitest';

import { testProvider } from '../../providerTestUtils';
import { LobeTripflowAI, params } from './index';

testProvider({
  Runtime: LobeTripflowAI,
  provider: ModelProvider.Tripflow,
  defaultBaseURL: 'https://api.openai.com/v1',
  chatDebugEnv: 'DEBUG_TRIPFLOW_CHAT_COMPLETION',
  chatModel: 'gpt-4o-mini',
  invalidErrorType: 'InvalidProviderAPIKey',
  bizErrorType: 'ProviderBizError',
  test: {
    skipAPICall: true,
    skipErrorHandle: true,
  },
});

describe('LobeTripflowAI - params', () => {
  it('should have correct provider', () => {
    expect(params.provider).toBe(ModelProvider.Tripflow);
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
      expect(models[0].enabled).toBe(false);
    });
  });
});
