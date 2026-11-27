import type { AssistantContentBlock } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { getIncompleteBannerState } from './incompleteBannerState';

describe('getIncompleteBannerState', () => {
  it('hides banner when no incomplete metadata', () => {
    const blocks: AssistantContentBlock[] = [
      { content: 'Hello', id: 'block-1' },
      { content: 'World', id: 'block-2' },
    ];

    expect(getIncompleteBannerState(blocks)).toEqual({ blockId: 'block-2', show: false });
  });

  it('shows banner at group end for single incomplete block', () => {
    const blocks: AssistantContentBlock[] = [
      { content: 'Partial', id: 'block-1', metadata: { isIncomplete: true } },
    ];

    expect(getIncompleteBannerState(blocks, true)).toEqual({ blockId: 'block-1', show: true });
  });

  it('hides stale incomplete flag on first block after later block has content', () => {
    const blocks: AssistantContentBlock[] = [
      { content: 'Tool turn', id: 'block-1', metadata: { isIncomplete: true } },
      { content: 'Continued analysis', id: 'block-2' },
    ];

    expect(getIncompleteBannerState(blocks, true)).toEqual({ blockId: 'block-2', show: false });
  });

  it('shows banner when last block is incomplete', () => {
    const blocks: AssistantContentBlock[] = [
      { content: 'Tool turn', id: 'block-1' },
      { content: 'Partial analysis', id: 'block-2', metadata: { isIncomplete: true } },
    ];

    expect(getIncompleteBannerState(blocks, true)).toEqual({ blockId: 'block-2', show: true });
  });
});
