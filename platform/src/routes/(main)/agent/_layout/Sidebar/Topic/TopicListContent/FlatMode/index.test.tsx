import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FlatMode from './index';

const navigateMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'loadMore' ? '更多' : key),
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...(actual as Record<string, unknown>),
    useNavigate: () => navigateMock,
  };
});

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (s: { activeAgentId: string }) => unknown) =>
    selector({ activeAgentId: 'agent-1' }),
}));

vi.mock('@/store/chat/selectors', () => ({
  topicSelectors: {
    displayTopicsForSidebar: () => () => [{ id: 'topic-1', title: 'Topic 1', favorite: false }],
    hasMoreTopicsForSidebar: () => true,
    isExpandingPageSize: () => false,
  },
}));

vi.mock('@/store/chat', () => ({
  useChatStore: (selector: unknown) => {
    if (typeof selector === 'function') {
      return (selector as (s: Record<string, unknown>) => unknown)({
        activeTopicId: null,
        activeThreadId: null,
      });
    }
    return selector;
  },
}));
vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (s: { status: { topicPageSize: number } }) => unknown) =>
    selector({ status: { topicPageSize: 20 } }),
  systemStatusSelectors: {
    topicPageSize: (s: { status: { topicPageSize: number } }) => s.status.topicPageSize,
  },
}));

vi.mock('@/features/NavPanel/components/NavItem', () => ({
  default: ({ title, onClick }: { onClick?: () => void; title: string }) => (
    <button type="button" onClick={onClick}>
      {title}
    </button>
  ),
}));

vi.mock('../../List/Item', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('FlatMode', () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it('navigates to agent topics page when clicking load more', () => {
    render(<FlatMode />);

    fireEvent.click(screen.getByText('更多'));

    expect(navigateMock).toHaveBeenCalledWith('/agent/agent-1/topics');
  });
});
