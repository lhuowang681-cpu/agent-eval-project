import { CalculatorIdentifier } from '@lobechat/builtin-tool-calculator';
import { LobeAgentIdentifier } from '@lobechat/builtin-tool-lobe-agent';
import { NotebookIdentifier } from '@lobechat/builtin-tool-notebook';
import { describe, expect, it } from 'vitest';

import { alwaysOnToolIds, builtinTools, defaultUninstalledBuiltinTools } from './index';

describe('defaultUninstalledBuiltinTools', () => {
  it('defaults Calculator to uninstalled since it is not in RECOMMENDED_SKILLS', () => {
    expect(defaultUninstalledBuiltinTools).toContain(CalculatorIdentifier);
  });

  it('excludes hidden tools like LobeAgent (always-on, not user-installable); Notebook is deprecated and no longer in the registry', () => {
    expect(defaultUninstalledBuiltinTools).not.toContain(NotebookIdentifier);
    expect(defaultUninstalledBuiltinTools).not.toContain(LobeAgentIdentifier);
  });
});

describe('lobe-agent registration', () => {
  it('is hidden from the normal skill list, matching lobehub (never a togglable tool card)', () => {
    const entry = builtinTools.find((t) => t.identifier === LobeAgentIdentifier);
    expect(entry?.hidden).toBe(true);
  });

  it('is force-enabled via alwaysOnToolIds so it still runs despite being hidden', () => {
    expect(alwaysOnToolIds).toContain(LobeAgentIdentifier);
  });
});
