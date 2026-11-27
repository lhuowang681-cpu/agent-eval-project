import { describe, expect, it, vi } from 'vitest';

import { SkillStoreExecutionRuntime, type SkillStoreRuntimeService } from './index';

const createService = (
  overrides?: Partial<SkillStoreRuntimeService>,
): SkillStoreRuntimeService => ({
  importFromGitHub: vi.fn(),
  importFromUrl: vi.fn(),
  importFromZipUrl: vi.fn(),
  ...overrides,
});

describe('SkillStoreExecutionRuntime', () => {
  it('notifies the host when a skill import should refresh client state', async () => {
    const onSkillImported = vi.fn();
    const runtime = new SkillStoreExecutionRuntime({
      service: createService({ onSkillImported }),
    });

    await runtime.notifyImported();

    expect(onSkillImported).toHaveBeenCalledTimes(1);
  });
});
