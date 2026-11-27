import { TRPCClientError } from '@trpc/client';
import { describe, expect, it } from 'vitest';

import { getSkillImportErrorMessage, translateSkillImportError } from './skillImportError';

const mockT = (key: string, options?: { defaultValue?: string }) => {
  const map: Record<string, string> = {
    'agentSkillModal.import.errors.SKILL_MD_NOT_FOUND': 'ZIP 压缩包中未找到 SKILL.md',
  };

  return map[key] ?? options?.defaultValue ?? key;
};

describe('skillImportError', () => {
  it('getSkillImportErrorMessage should return TRPCClientError message', () => {
    const err = new TRPCClientError('SKILL_IMPORT::SKILL_MD_NOT_FOUND', {
      result: {
        error: {
          data: { code: 'BAD_REQUEST', httpStatus: 400 },
          message: 'SKILL_IMPORT::SKILL_MD_NOT_FOUND',
        },
      },
    } as any);

    expect(getSkillImportErrorMessage(err)).toBe('SKILL_IMPORT::SKILL_MD_NOT_FOUND');
  });

  it('translateSkillImportError should map encoded TRPC errors to Chinese', () => {
    const err = new TRPCClientError('SKILL_IMPORT::SKILL_MD_NOT_FOUND', {
      result: {
        error: {
          data: { code: 'BAD_REQUEST', httpStatus: 400 },
          message: 'SKILL_IMPORT::SKILL_MD_NOT_FOUND',
        },
      },
    } as any);

    expect(translateSkillImportError(mockT as any, err)).toBe('ZIP 压缩包中未找到 SKILL.md');
  });

  it('getSkillImportErrorMessage should return Error message', () => {
    expect(getSkillImportErrorMessage(new Error('network'))).toBe('network');
  });
});
