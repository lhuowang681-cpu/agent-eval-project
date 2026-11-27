import { describe, expect, it } from 'vitest';

import { extractLegacyPetaKeyIdFromBaseURL } from './extractLegacyPetaKeyId';

describe('extractLegacyPetaKeyIdFromBaseURL', () => {
  it('extracts trailing digits from the canonical /llm/<id> baseURL', () => {
    expect(extractLegacyPetaKeyIdFromBaseURL('http://aigw.fx.ctripcorp.com/llm/100000533')).toBe(
      '100000533',
    );
  });

  it('extracts when the baseURL has a trailing slash', () => {
    expect(extractLegacyPetaKeyIdFromBaseURL('https://aigw.fx.ctripcorp.com/llm/100002448/')).toBe(
      '100002448',
    );
  });

  it('extracts when additional path segments follow the id', () => {
    expect(
      extractLegacyPetaKeyIdFromBaseURL(
        'http://aigw.fx.ctripcorp.com/llm/100000533/v1/chat/completions',
      ),
    ).toBe('100000533');
  });

  it('returns undefined when baseURL is missing', () => {
    expect(extractLegacyPetaKeyIdFromBaseURL(undefined)).toBeUndefined();
    expect(extractLegacyPetaKeyIdFromBaseURL('')).toBeUndefined();
  });

  it('returns undefined when /llm/ segment is absent', () => {
    expect(extractLegacyPetaKeyIdFromBaseURL('http://aigw.fx.ctripcorp.com/api/100000533')).toBe(
      undefined,
    );
  });

  it('returns undefined when the segment after /llm/ is not purely numeric', () => {
    expect(
      extractLegacyPetaKeyIdFromBaseURL('http://aigw.fx.ctripcorp.com/llm/peta-100000533'),
    ).toBeUndefined();
    expect(
      extractLegacyPetaKeyIdFromBaseURL('http://aigw.fx.ctripcorp.com/llm/abc123'),
    ).toBeUndefined();
  });
});
