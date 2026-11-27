/**
 * @vitest-environment happy-dom
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NavPanel, { NavPanelPortal, resetNavPanel } from './index';

vi.mock('@lobehub/ui', () => ({
  DraggablePanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Freeze: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('./components/NavPanelDraggable', () => ({
  NavPanelDraggable: ({ activeContent }: { activeContent: { node: ReactNode } }) => (
    <div data-testid="nav-panel-content">{activeContent.node}</div>
  ),
}));

vi.mock('@/routes/(main)/home/_layout/SidebarContent', () => ({
  default: () => <div data-testid="home-sidebar-content">Home Sidebar</div>,
}));

describe('NavPanel', () => {
  beforeEach(() => {
    resetNavPanel();
  });

  it('shows home sidebar fallback after resetNavPanel clears portal content', async () => {
    render(
      <>
        <NavPanel />
        <NavPanelPortal navKey="agent">
          <div data-testid="agent-sidebar-content">Agent Sidebar</div>
        </NavPanelPortal>
      </>,
    );

    expect(screen.getByTestId('agent-sidebar-content')).toBeInTheDocument();

    await act(async () => {
      resetNavPanel();
    });

    expect(screen.getByTestId('home-sidebar-content')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-sidebar-content')).not.toBeInTheDocument();
  });
});
