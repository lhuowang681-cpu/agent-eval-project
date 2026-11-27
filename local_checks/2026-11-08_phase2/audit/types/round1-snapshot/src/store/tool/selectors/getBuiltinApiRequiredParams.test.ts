import { describe, expect, it } from 'vitest';

import { type ToolStoreState } from '../initialState';
import { initialState } from '../initialState';
import { toolSelectors } from './tool';

interface TestToolItem {
  identifier: string;
  manifest?: {
    api?: Array<{ name: string; parameters?: any }>;
    meta?: { avatar?: string; description?: string; title?: string };
  };
  type: string;
}

const createState = (tools: TestToolItem[] = []): ToolStoreState =>
  ({ ...initialState, builtinTools: tools }) as unknown as ToolStoreState;

const toolWith = (parameters: any): TestToolItem => ({
  identifier: 'test-tool',
  manifest: {
    api: [{ name: 'testApi', parameters }],
    meta: { title: 'Test' },
  },
  type: 'builtin',
});

describe('toolSelectors.getBuiltinApiRequiredParams', () => {
  it('returns the required params declared by the api manifest schema', () => {
    const state = createState([
      toolWith({ type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }),
    ]);

    expect(toolSelectors.getBuiltinApiRequiredParams('test-tool', 'testApi')(state)).toEqual([
      'command',
    ]);
  });

  it('returns an empty array when the api declares no required params', () => {
    const state = createState([
      toolWith({ type: 'object', properties: { command: { type: 'string' } } }),
    ]);

    expect(toolSelectors.getBuiltinApiRequiredParams('test-tool', 'testApi')(state)).toEqual([]);
  });

  it('returns an empty array for an unknown tool identifier', () => {
    const state = createState([toolWith({ required: ['command'] })]);

    expect(toolSelectors.getBuiltinApiRequiredParams('missing-tool', 'testApi')(state)).toEqual([]);
  });

  it('returns an empty array for an unknown api name on a known tool', () => {
    const state = createState([toolWith({ required: ['command'] })]);

    expect(toolSelectors.getBuiltinApiRequiredParams('test-tool', 'unknownApi')(state)).toEqual([]);
  });
});
