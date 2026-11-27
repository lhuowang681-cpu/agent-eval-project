import { describe, expect, it } from 'vitest';

import { CLIENT_PLATFORM_DESKTOP, LOBE_CLIENT_PLATFORM_HEADER } from '@/const/clientPlatform';

import { resolveClientPlatform } from './context';

describe('resolveClientPlatform', () => {
  it('should resolve desktop client platform from request headers', () => {
    const headers = new Headers({ [LOBE_CLIENT_PLATFORM_HEADER]: CLIENT_PLATFORM_DESKTOP });

    expect(resolveClientPlatform(headers)).toBe(CLIENT_PLATFORM_DESKTOP);
  });

  it('should ignore unknown client platform values', () => {
    const headers = new Headers({ [LOBE_CLIENT_PLATFORM_HEADER]: 'web' });

    expect(resolveClientPlatform(headers)).toBeUndefined();
  });
});
