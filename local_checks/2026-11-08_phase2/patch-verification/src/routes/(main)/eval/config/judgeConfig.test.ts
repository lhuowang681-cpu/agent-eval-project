import { describe, expect, it } from 'vitest';
import { prepareEvalConfig } from './judgeConfig';

describe('Judge form configuration preservation', () => {
  it('keeps model and criteria without an unused judgePrompt', () => {
    expect(
      prepareEvalConfig({ model: 'selected', provider: 'openai', criteria: 'explicit' }),
    ).toEqual({ model: 'selected', provider: 'openai', criteria: 'explicit' });
  });
  it('uses legacy prompt only when explicit criteria is empty', () => {
    expect(prepareEvalConfig({ judgePrompt: 'legacy' })?.criteria).toBe('legacy');
    expect(prepareEvalConfig({ judgePrompt: 'legacy', criteria: 'new' })?.criteria).toBe('new');
  });
  it('preserves other rule configuration and removes an entirely empty config', () => {
    expect(prepareEvalConfig({ tolerance: 0.1 })?.tolerance).toBe(0.1);
    expect(prepareEvalConfig({})).toBeUndefined();
  });
});
