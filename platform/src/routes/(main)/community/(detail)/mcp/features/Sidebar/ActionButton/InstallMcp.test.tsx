/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InstallMcp from './InstallMcp';

const mocks = vi.hoisted(() => ({
  currentUserId: 'user-1',
  detail: {
    identifier: 'http-mcp',
    customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
  } as {
    connectionType?: string;
    customParams?: Record<string, unknown>;
    deletedAt?: Date | string;
    identifier?: string;
    name?: string;
    publisherId?: string;
  },
  installMCPPlugin: vi.fn(),
  installMcp: vi.fn(),
  installedPlugins: [] as Array<Record<string, unknown>>,
  isLogin: true,
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  refreshPlugins: vi.fn(),
  updateInstalledMcp: vi.fn(),
  useFetchPluginStore: vi.fn(),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      message: {
        error: mocks.messageError,
        success: mocks.messageSuccess,
      },
    }),
  },
  Modal: {
    confirm: vi.fn(),
  },
}));

vi.mock('antd-style', () => ({
  createStaticStyles: () => ({
    button: 'button',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'mcp.installMcp': 'Install',
        'mcp.updateInstalled': 'Update',
      };

      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/features/MCP/MCPInstallProgress', () => ({
  default: ({ identifier }: { identifier: string }) => (
    <div data-testid="mcp-install-progress">{identifier}</div>
  ),
}));

vi.mock('@/features/MCPPluginDetail/DetailProvider', () => ({
  useDetailContext: () => mocks.detail,
}));

vi.mock('@/helpers/invalidateMarketPublisherState', () => ({
  invalidateMarketPublisherState: vi.fn(),
}));

vi.mock('@/services/marketApi', () => ({
  communityApiService: {
    delistMcp: vi.fn(),
    relistMcpWithSync: vi.fn(),
    restoreMcpToLocal: vi.fn(),
  },
}));

vi.mock('@/store/discover', () => ({
  useDiscoverStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

vi.mock('@/store/tool', () => ({
  useToolStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

vi.mock('@/store/tool/slices/plugin/selectors', () => ({
  pluginSelectors: {
    installedPlugins: (state: typeof mocks) => state.installedPlugins,
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));

vi.mock('@/store/user/slices/auth/selectors', () => ({
  authSelectors: {
    isLogin: (state: typeof mocks) => state.isLogin,
  },
  userProfileSelectors: {
    userId: (state: typeof mocks) => state.currentUserId,
  },
}));

describe('InstallMcp', () => {
  beforeEach(() => {
    mocks.currentUserId = 'user-1';
    mocks.detail = {
      identifier: 'http-mcp',
      customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
    };
    mocks.installedPlugins = [];
    mocks.isLogin = true;
    mocks.installMCPPlugin.mockReset();
    mocks.installMcp.mockReset();
    mocks.messageError.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.refreshPlugins.mockReset();
    mocks.updateInstalledMcp.mockReset();
    mocks.useFetchPluginStore.mockReset();
  });

  it('uses full install flow for stdio market MCP', async () => {
    mocks.detail = {
      identifier: 'stdio-mcp',
      customParams: { mcp: { args: ['-y', 'server'], command: 'npx', type: 'stdio' } },
    };
    mocks.installMCPPlugin.mockResolvedValue(true);
    mocks.installMcp.mockResolvedValue(undefined);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMCPPlugin).toHaveBeenCalledWith('stdio-mcp');
    });
    expect(mocks.installMcp).not.toHaveBeenCalled();
  });

  it('renders install progress for the current market MCP', () => {
    mocks.detail = {
      identifier: 'stdio-mcp',
      customParams: { mcp: { args: ['-y', 'server'], command: 'npx', type: 'stdio' } },
    };

    render(<InstallMcp />);

    expect(screen.getByTestId('mcp-install-progress')).toHaveTextContent('stdio-mcp');
  });

  it('does not refresh or show success when stdio install pauses for user action', async () => {
    mocks.detail = {
      identifier: 'stdio-mcp',
      customParams: { mcp: { args: ['-y', 'server'], command: 'npx', type: 'stdio' } },
    };
    mocks.installMCPPlugin.mockResolvedValue(false);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMCPPlugin).toHaveBeenCalledWith('stdio-mcp');
    });
    expect(mocks.refreshPlugins).not.toHaveBeenCalled();
    expect(mocks.messageSuccess).not.toHaveBeenCalled();
  });

  it('keeps lightweight install for http market MCP', async () => {
    mocks.installMCPPlugin.mockResolvedValue(true);
    mocks.installMcp.mockResolvedValue(undefined);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMcp).toHaveBeenCalledWith('http-mcp');
    });
    expect(mocks.installMCPPlugin).not.toHaveBeenCalled();
  });

  it('falls back to connectionType when custom params do not declare a type', async () => {
    mocks.detail = {
      identifier: 'connection-type-stdio-mcp',
      connectionType: 'stdio',
      customParams: {},
    };
    mocks.installMCPPlugin.mockResolvedValue(true);
    mocks.installMcp.mockResolvedValue(undefined);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMCPPlugin).toHaveBeenCalledWith('connection-type-stdio-mcp');
    });
    expect(mocks.installMcp).not.toHaveBeenCalled();
  });

  it('prefers custom params type over connectionType fallback', async () => {
    mocks.detail = {
      identifier: 'custom-type-http-mcp',
      connectionType: 'stdio',
      customParams: { mcp: { type: 'http', url: 'https://example.com/mcp' } },
    };
    mocks.installMCPPlugin.mockResolvedValue(true);
    mocks.installMcp.mockResolvedValue(undefined);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMcp).toHaveBeenCalledWith('custom-type-http-mcp');
    });
    expect(mocks.installMCPPlugin).not.toHaveBeenCalled();
  });

  it('uses full install flow for mcpServers stdio config', async () => {
    mocks.detail = {
      identifier: 'chrome-devtools',
      customParams: {
        mcpServers: {
          'chromedevtools-chrome-devtools-mcp': {
            args: ['chrome-devtools-mcp@latest'],
            command: 'npx',
            type: 'stdio',
          },
        },
      },
    };
    mocks.installMCPPlugin.mockResolvedValue(true);

    render(<InstallMcp />);
    fireEvent.click(screen.getByRole('button', { name: /install/i }));

    await waitFor(() => {
      expect(mocks.installMCPPlugin).toHaveBeenCalledWith('chrome-devtools');
    });
    expect(mocks.installMcp).not.toHaveBeenCalled();
  });

  it('recognizes an installed MCP when the local plugin id matches the market id', () => {
    const snapshot = {
      customParams: { mcp: { args: ['server'], command: 'npx', type: 'stdio' } },
      manifest: { api: [], identifier: 'stdio-mcp', meta: { title: 'Stdio MCP' }, type: 'mcp' },
    };
    mocks.detail = {
      identifier: 'stdio-mcp',
      customParams: snapshot.customParams,
    };
    mocks.installedPlugins = [
      {
        identifier: 'stdio-mcp',
        installedFromSnapshot: snapshot,
        ...snapshot,
      },
    ];

    render(<InstallMcp />);

    expect(screen.getByRole('button', { name: /update/i })).toBeTruthy();
  });

  it('treats installedFromMarketIdentifier as market install even if marketIdentifier remains', () => {
    mocks.detail = {
      identifier: 'stdio-mcp',
      customParams: { mcp: { args: ['server'], command: 'npx', type: 'stdio' } },
    };
    mocks.installedPlugins = [
      {
        customParams: { mcp: { args: ['server'], command: 'npx', type: 'stdio' } },
        identifier: 'stdio-mcp',
        installedFromMarketIdentifier: 'stdio-mcp',
        installedFromSnapshot: {},
        manifest: { api: [], identifier: 'stdio-mcp', meta: { title: 'Stdio MCP' }, type: 'mcp' },
        marketIdentifier: 'stdio-mcp',
      },
    ];

    render(<InstallMcp />);

    expect(screen.getByRole('button', { name: /update/i })).toBeTruthy();
  });
});
