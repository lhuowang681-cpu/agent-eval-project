import type { RubricConfig } from '@lobechat/types';

import type { MatchResult } from './types';

export const matchRegex = (actual: string, config: RubricConfig): MatchResult => {
  const cfg = config as { pattern: string };
  if (typeof cfg.pattern !== 'string') {
    throw new Error('Invalid regex rubric pattern: expected a string');
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(cfg.pattern, 'i');
  } catch {
    throw new Error('Invalid regex rubric pattern: could not compile regular expression');
  }
  const passed = pattern.test(actual);
  return { passed, score: passed ? 1 : 0 };
};
