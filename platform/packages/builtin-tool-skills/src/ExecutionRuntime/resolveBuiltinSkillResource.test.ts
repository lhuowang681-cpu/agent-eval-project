import type { BuiltinSkill } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import type { SkillRuntimeService } from './index';
import { SkillsExecutionRuntime } from './index';
import { resolveBuiltinSkillResource } from './resolveBuiltinSkillResource';

const createMockService = (): SkillRuntimeService => ({
  findAll: async () => ({ data: [], total: 0 }),
  findById: async () => undefined,
  findByName: async () => undefined,
  readResource: async () => {
    throw new Error('should not be called');
  },
});

const sampleResources = {
  'editing.md': { content: '# Editing', fileHash: '', size: 9 },
  'pptxgenjs.md': { content: '# PptxGenJS', fileHash: '', size: 11 },
};

describe('resolveBuiltinSkillResource', () => {
  it('should resolve exact path', () => {
    const result = resolveBuiltinSkillResource(sampleResources, 'pptxgenjs.md');
    expect(result?.resolvedPath).toBe('pptxgenjs.md');
    expect(result?.meta.content).toBe('# PptxGenJS');
  });

  it('should resolve path without .md extension', () => {
    const result = resolveBuiltinSkillResource(sampleResources, 'editing');
    expect(result?.resolvedPath).toBe('editing.md');
  });

  it('should resolve case-insensitive paths', () => {
    const resources = {
      'FORMS.md': { content: '# Forms', fileHash: '', size: 7 },
      'REFERENCE.md': { content: '# Reference', fileHash: '', size: 11 },
    };

    expect(resolveBuiltinSkillResource(resources, 'forms.md')?.resolvedPath).toBe('FORMS.md');
    expect(resolveBuiltinSkillResource(resources, 'reference')?.resolvedPath).toBe('REFERENCE.md');
  });

  it('should strip leading ./ from path', () => {
    const result = resolveBuiltinSkillResource(sampleResources, './pptxgenjs.md');
    expect(result?.resolvedPath).toBe('pptxgenjs.md');
  });
});

describe('SkillsExecutionRuntime readReference (builtin)', () => {
  const pptxSkill: BuiltinSkill = {
    content: '# PPTX',
    description: 'pptx skill',
    identifier: 'lobe-pptx',
    name: 'PPTX',
    resources: sampleResources,
    source: 'builtin',
  };

  it('should read builtin resource by filename from SKILL.md', async () => {
    const runtime = new SkillsExecutionRuntime({
      builtinSkills: [pptxSkill],
      service: createMockService(),
    });

    const result = await runtime.readReference({ id: 'PPTX', path: 'pptxgenjs.md' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('# PptxGenJS');
    expect(result.state).toMatchObject({ path: 'pptxgenjs.md' });
  });

  it('should read builtin resource when path omits .md extension', async () => {
    const runtime = new SkillsExecutionRuntime({
      builtinSkills: [pptxSkill],
      service: createMockService(),
    });

    const result = await runtime.readReference({ id: 'PPTX', path: 'editing' });

    expect(result.success).toBe(true);
    expect(result.content).toBe('# Editing');
    expect(result.state).toMatchObject({ path: 'editing.md' });
  });
});
