import { describe, expect, it, vi } from 'vitest';

import type { SkillStoreExecutionRuntime } from '../ExecutionRuntime';
import { SkillStoreApiName } from '../types';
import { SkillStoreExecutor } from './index';

const createExecutor = () => {
  const runtime = {
    importFromMarket: vi.fn(),
    importSkill: vi.fn(),
    notifyImported: vi.fn(),
    searchSkill: vi.fn(),
  } as unknown as SkillStoreExecutionRuntime;

  return { executor: new SkillStoreExecutor(runtime), runtime };
};

const createAfterCallContext = (apiName: string, success: boolean) =>
  ({
    apiName,
    result: { success },
  }) as any;

describe('SkillStoreExecutor', () => {
  it('refreshes skills after a successful market import', async () => {
    const { executor, runtime } = createExecutor();

    await executor.onAfterCall(createAfterCallContext(SkillStoreApiName.importFromMarket, true));

    expect(runtime.notifyImported).toHaveBeenCalledTimes(1);
  });

  it('does not refresh skills after search', async () => {
    const { executor, runtime } = createExecutor();

    await executor.onAfterCall(createAfterCallContext(SkillStoreApiName.searchSkill, true));

    expect(runtime.notifyImported).not.toHaveBeenCalled();
  });

  it('does not refresh skills after a failed import', async () => {
    const { executor, runtime } = createExecutor();

    await executor.onAfterCall(createAfterCallContext(SkillStoreApiName.importSkill, false));

    expect(runtime.notifyImported).not.toHaveBeenCalled();
  });
});
