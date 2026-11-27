import { describe, expect, it } from 'vitest';

import { getActionPanelMaxHeight } from './getActionPanelMaxHeight';

describe('getActionPanelMaxHeight', () => {
  it('should use the default maximum height', () => {
    expect(getActionPanelMaxHeight()).toBe('min(500px, var(--available-height, 60dvh))');
  });

  it('should convert numeric heights to pixels', () => {
    expect(getActionPanelMaxHeight(320)).toBe('min(320px, var(--available-height, 60dvh))');
  });

  it('should preserve CSS height strings', () => {
    expect(getActionPanelMaxHeight('75vh')).toBe('min(75vh, var(--available-height, 60dvh))');
  });
});
