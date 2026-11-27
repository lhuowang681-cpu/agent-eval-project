import { describe, expect, it } from 'vitest';

import {
  decodeSkillImportMessage,
  encodeSkillImportMessage,
  formatSkillMdParseDetail,
  inferLegacySkillImportCode,
  parseErrorToPayload,
  translateSkillImportMessage,
} from './skillImportMessage';

describe('skillImportMessage', () => {
  it('encode/decode roundtrip with params', () => {
    const encoded = encodeSkillImportMessage('CONFLICT_NAME', { name: 'demo' });
    expect(encoded).toBe('SKILL_IMPORT::CONFLICT_NAME::{"name":"demo"}');
    expect(decodeSkillImportMessage(encoded)).toEqual({
      code: 'CONFLICT_NAME',
      params: { name: 'demo' },
    });
  });

  it('inferLegacySkillImportCode should map parse errors', () => {
    expect(inferLegacySkillImportCode('SKILL.md not found in zip package')).toEqual({
      code: 'SKILL_MD_NOT_FOUND',
      params: {},
    });
  });

  it('formatSkillMdParseDetail should extract YAML line and reason', () => {
    const detail = formatSkillMdParseDetail({
      mark: { column: 0, line: 6 },
      reason: 'can not read a block mapping entry',
    });

    expect(detail).toBe('line 7, column 1: can not read a block mapping entry');
  });

  it('parseErrorToPayload should include SKILL.md YAML detail', () => {
    expect(
      parseErrorToPayload({
        code: 'FAILED_PARSE_SKILL_MD',
        message: 'Failed to parse SKILL.md: line 7: invalid yaml',
      }),
    ).toEqual({ detail: 'line 7: invalid yaml' });
  });

  it('translateSkillImportMessage should use detail key for YAML parse errors', () => {
    const t = (key: string, options?: { defaultValue?: string; detail?: string }) => {
      if (key === 'agentSkillModal.import.errors.FAILED_PARSE_SKILL_MD_DETAIL') {
        return `无法解析 SKILL.md（${options?.detail}）`;
      }

      return options?.defaultValue ?? key;
    };

    expect(
      translateSkillImportMessage(
        t,
        encodeSkillImportMessage('FAILED_PARSE_SKILL_MD', { detail: 'line 7: bad yaml' }),
      ),
    ).toBe('无法解析 SKILL.md（line 7: bad yaml）');
  });

  it('translateSkillImportMessage should use i18n key for encoded message', () => {
    const t = (key: string, options?: { defaultValue?: string; name?: string }) => {
      if (key === 'agentSkillModal.import.errors.SKILL_MD_NOT_FOUND') {
        return 'ZIP 压缩包中未找到 SKILL.md';
      }

      return options?.defaultValue ?? key;
    };

    expect(translateSkillImportMessage(t, 'SKILL_IMPORT::SKILL_MD_NOT_FOUND')).toBe(
      'ZIP 压缩包中未找到 SKILL.md',
    );
  });
});
