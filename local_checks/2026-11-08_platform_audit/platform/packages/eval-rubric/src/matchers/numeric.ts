import type { RubricConfig } from '@lobechat/types';

import type { MatchResult } from './types';

export const matchNumeric = (
  actual: string,
  expected: string | undefined,
  config: RubricConfig,
): MatchResult => {
  const cfg = config as { tolerance?: number; value: number };
  // Extract one complete number; deleting letters would turn "1e3" into "13"
  // and concatenate unrelated values such as "1 and 3".
  const numbers = actual.match(
    /[+-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g,
  );
  const actualNum = numbers?.length === 1 ? Number(numbers[0].replaceAll(',', '')) : Number.NaN;
  if (!Number.isFinite(actualNum)) {
    return { passed: false, reason: `Could not parse number from "${actual}"`, score: 0 };
  }
  const tolerance = cfg.tolerance ?? 0.01;
  const expectedNum = expected !== undefined ? Number.parseFloat(expected) : cfg.value;
  const passed = Math.abs(actualNum - expectedNum) <= tolerance;
  return { passed, score: passed ? 1 : 0 };
};
