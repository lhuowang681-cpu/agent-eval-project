import type { EvalConfig } from '@lobechat/types';

/** Keep complete configurations; judgePrompt is a legacy criteria alias, not a save switch. */
export function prepareEvalConfig(config?: EvalConfig | null): EvalConfig | undefined {
  if (!config || !Object.values(config).some((value) => value !== undefined && value !== ''))
    return;
  return {
    ...config,
    criteria: config.criteria?.trim() || config.judgePrompt?.trim() || undefined,
  };
}
