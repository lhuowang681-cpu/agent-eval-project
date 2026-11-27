/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MCPRunnerGuide from './MCPRunnerGuide';

const mocks = vi.hoisted(() => ({
  installMCPPlugin: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    href,
    onClick,
    target,
    type,
  }: {
    children: ReactNode;
    href?: string;
    onClick?: () => void;
    target?: string;
    type?: string;
  }) =>
    href ? (
      <a data-type={type} href={href} target={target}>
        {children}
      </a>
    ) : (
      <button data-type={type} onClick={onClick}>
        {children}
      </button>
    ),
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'mcpInstall.runnerGuide.download': 'Download',
        'mcpInstall.runnerGuide.node.description':
          'This MCP server uses Node.js or npx. Install Node.js, then retry.',
        'mcpInstall.runnerGuide.node.title': 'Install Node.js',
        'mcpInstall.runnerGuide.recheck': 'Recheck and continue',
      })[key] || key,
  }),
}));

describe('MCPRunnerGuide', () => {
  beforeEach(() => {
    mocks.installMCPPlugin.mockReset();
  });

  it('shows Node.js guide and retry action for missing npx runner', async () => {
    const user = userEvent.setup();

    render(<MCPRunnerGuide command="npx" identifier="stdio-mcp" />);

    expect(screen.getByText('Install Node.js')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      'https://nodejs.org/',
    );

    await user.click(screen.getByRole('button', { name: /recheck/i }));

    expect(mocks.installMCPPlugin).toHaveBeenCalledWith('stdio-mcp');
  });
});
