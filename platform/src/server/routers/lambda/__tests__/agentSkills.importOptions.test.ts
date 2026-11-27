import { describe, expect, it } from 'vitest';

import { CLIENT_PLATFORM_DESKTOP } from '@/const/clientPlatform';

import { normalizeImportOptions } from '../agentSkills';

describe('agentSkills import options', () => {
  it('should preserve skipSecurityScan for desktop clients', () => {
    const result = normalizeImportOptions(
      { skipSecurityScan: true },
      { clientPlatform: CLIENT_PLATFORM_DESKTOP },
    );

    expect(result).toEqual({
      scanId: undefined,
      skipSecurityScan: true,
    });
  });

  it('should ignore skipSecurityScan for non-desktop clients', () => {
    const result = normalizeImportOptions({ skipSecurityScan: true }, {});

    expect(result).toEqual({
      scanId: undefined,
      skipSecurityScan: false,
    });
  });
});
