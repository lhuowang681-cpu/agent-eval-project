import { afterEach, describe, expect, it, vi } from 'vitest';

import { initialState } from '@/store/tool/initialState';
import { useToolStore } from '@/store/tool/store';

import { createSkillEngine } from './skillEngineering';

vi.mock('@lobechat/const', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    isDesktop: false,
  };
});

afterEach(() => {
  useToolStore.setState(initialState, true);
});

describe('createSkillEngine', () => {
  it('excludes DB skills that have not passed the web safety scan in web', () => {
    useToolStore.setState({
      agentSkills: [
        {
          description: 'Only uploaded through desktop',
          identifier: 'frontend-design',
          name: 'frontend-design',
          webSafeScanPassed: false,
        },
        {
          description: 'Safe web skill',
          identifier: 'playwright-cli-2',
          name: 'playwright-cli-2',
          webSafeScanPassed: true,
        },
      ],
      builtinSkills: [],
    } as any);

    const skills = createSkillEngine().getAllSkills();

    expect(skills.map((skill) => skill.identifier)).toEqual(['playwright-cli-2']);
  });
});
