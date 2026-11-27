// @vitest-environment node
import { ModelProvider } from 'model-bank';
import { describe, expect, it } from 'vitest';

import { AiProviderModel } from '../aiProvider';

describe('AiProviderModel guards', () => {
  it('should reject provider lookup when userId is empty before touching database', async () => {
    const db = {
      select: () => {
        throw new Error('database should not be touched');
      },
    };
    const emptyUserProviderModel = new AiProviderModel(db as any, '');

    await expect(
      emptyUserProviderModel.getAiProviderById(ModelProvider.OpenAI, (text) =>
        JSON.parse(text as string),
      ),
    ).rejects.toThrow('userId is required');
  });
});
