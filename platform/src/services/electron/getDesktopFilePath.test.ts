import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDesktopFilePath } from './getDesktopFilePath';

describe('getDesktopFilePath', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return path from electronAPI when available', () => {
    const file = new File(['content'], 'report.pdf');
    vi.stubGlobal('window', {
      electronAPI: {
        getPathForFile: vi.fn().mockReturnValue('/Users/me/Downloads/report.pdf'),
      },
    });

    expect(getDesktopFilePath(file)).toBe('/Users/me/Downloads/report.pdf');
  });

  it('should return undefined when electronAPI is unavailable', () => {
    const file = new File(['content'], 'report.pdf');
    vi.stubGlobal('window', {});

    expect(getDesktopFilePath(file)).toBeUndefined();
  });
});
