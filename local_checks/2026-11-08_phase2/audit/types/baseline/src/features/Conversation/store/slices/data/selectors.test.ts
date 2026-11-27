import { type UIChatMessage } from '@lobechat/types';
import { describe, expect, it, vi } from 'vitest';

import { initialState, type State } from '../../initialState';
import { dataSelectors } from './selectors';

vi.mock('@/store/chat', () => ({
  useChatStore: {
    getState: vi.fn(),
  },
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    currentActiveTopicSummary: vi.fn(),
  },
}));

describe('dataSelectors', () => {
  describe('findLastMessageId', () => {
    it('should resolve agentCouncil to the last real member id', () => {
      const agentCouncilMessage = {
        createdAt: Date.now(),
        extra: { parentMessageId: 'msg_parent' },
        id: 'agentCouncil-msg_parent-msg_a-msg_b',
        members: [
          { id: 'msg_a', role: 'assistant' },
          { id: 'msg_b', role: 'assistant' },
        ],
        role: 'agentCouncil',
        updatedAt: Date.now(),
      } as unknown as UIChatMessage;

      const state: State = {
        ...initialState,
        displayMessages: [agentCouncilMessage],
      };

      const result = dataSelectors.findLastMessageId('agentCouncil-msg_parent-msg_a-msg_b')(state);
      expect(result).toBe('msg_b');
    });
  });
});
