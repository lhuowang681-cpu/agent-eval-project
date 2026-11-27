/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MCPInstallProgressMap } from '@/types/plugins';
import { MCPInstallStep } from '@/types/plugins';

import MCPInstallProgress from './index';

const mocks = vi.hoisted(() => ({
  state: {
    mcpInstallProgress: {} as MCPInstallProgressMap,
  },
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('antd', () => ({
  Progress: () => <div data-testid="install-progress" />,
}));

vi.mock('antd-style', () => ({
  cssVar: {
    blue: '#1677ff',
    geekblue: '#2f54eb',
  },
}));

vi.mock('motion/react-m', () => ({
  div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('./InstallError', () => ({
  default: () => <div data-testid="install-error" />,
}));

vi.mock('./MCPConfigForm', () => ({
  default: () => <div data-testid="config-form" />,
}));

vi.mock('./MCPDependenciesGuide', () => ({
  default: ({ systemDependencies }: { systemDependencies: Array<{ name: string }> }) => (
    <div data-testid="dependencies-guide">
      {systemDependencies.map((dep) => dep.name).join(',')}
    </div>
  ),
}));

vi.mock('./MCPRunnerGuide', () => ({
  default: ({ command }: { command: string }) => <div data-testid="runner-guide">{command}</div>,
}));

describe('MCPInstallProgress', () => {
  beforeEach(() => {
    mocks.state.mcpInstallProgress = {};
  });

  it('prefers runner guide when dependency progress includes a connection command', () => {
    mocks.state.mcpInstallProgress['stdio-mcp'] = {
      connection: {
        command: 'npx',
      },
      progress: 40,
      step: MCPInstallStep.DEPENDENCIES_REQUIRED,
      systemDependencies: [
        {
          installed: false,
          meetRequirement: false,
          name: 'Node.js',
        },
      ],
    };

    render(<MCPInstallProgress identifier="stdio-mcp" />);

    expect(screen.getByTestId('runner-guide')).toHaveTextContent('npx');
    expect(screen.queryByTestId('dependencies-guide')).not.toBeInTheDocument();
  });

  it('falls back to dependency guide when only system dependencies are available', () => {
    mocks.state.mcpInstallProgress['stdio-mcp'] = {
      progress: 40,
      step: MCPInstallStep.DEPENDENCIES_REQUIRED,
      systemDependencies: [
        {
          installed: false,
          meetRequirement: false,
          name: 'Node.js',
        },
      ],
    };

    render(<MCPInstallProgress identifier="stdio-mcp" />);

    expect(screen.getByTestId('dependencies-guide')).toHaveTextContent('Node.js');
    expect(screen.queryByTestId('runner-guide')).not.toBeInTheDocument();
  });
});
