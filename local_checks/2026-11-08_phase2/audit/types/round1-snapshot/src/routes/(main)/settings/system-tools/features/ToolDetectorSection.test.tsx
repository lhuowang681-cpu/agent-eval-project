import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ToolDetectorSection from './ToolDetectorSection';

const {
  detectAllTools,
  installTool,
  messageError,
  messageSuccess,
  modalConfirm,
  reinstallTool,
  uninstallTool,
} = vi.hoisted(() => ({
  detectAllTools: vi.fn(),
  installTool: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  modalConfirm: vi.fn(),
  reinstallTool: vi.fn(),
  uninstallTool: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, disabled, loading, onClick }: any) => (
    <button disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  CopyButton: () => <button>copy</button>,
  Dropdown: ({ children }: any) => <>{children}</>,
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Form: ({ footer, items }: any) => (
    <div>
      {items.map((group: any) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <p>{group.desc}</p>
          {group.children.map((item: any) => (
            <div key={String(item.label)}>
              <div>{item.label}</div>
              <p>{item.desc}</p>
              <div>{item.children}</div>
            </div>
          ))}
        </section>
      ))}
      {footer}
    </div>
  ),
  Icon: () => <span />,
  Skeleton: () => <div>loading</div>,
  Tag: ({ children }: any) => <span>{children}</span>,
  Text: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@lobechat/electron-client-ipc', () => ({
  useWatchBroadcast: vi.fn(),
}));

vi.mock('@/services/electron/toolDetector', () => ({
  toolDetectorService: {
    detectAllTools,
    installTool,
    reinstallTool,
    uninstallTool,
  },
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual('antd');
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: {
          error: messageError,
          success: messageSuccess,
        },
        modal: {
          confirm: modalConfirm,
        },
      }),
    },
  };
});

describe('ToolDetectorSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectAllTools.mockResolvedValue({
      node: { available: false },
      python: { available: true, path: '/usr/bin/python3', version: 'Python 3.12.0' },
    });
    installTool.mockResolvedValue({
      commandLabel: 'brew install node',
      success: true,
      toolName: 'node',
    });
    modalConfirm.mockImplementation(({ onOk }) => onOk?.());
  });

  it('shows the expected tool set without browser automation tools', async () => {
    render(<ToolDetectorSection />);

    expect(await screen.findByText('node')).toBeInTheDocument();
    expect(screen.getByText('python')).toBeInTheDocument();
    expect(screen.getByText('npm')).toBeInTheDocument();
    expect(screen.getByText('bun')).toBeInTheDocument();
    expect(screen.getByText('bunx')).toBeInTheDocument();
    expect(screen.getByText('pnpm')).toBeInTheDocument();
    expect(screen.getByText('uv')).toBeInTheDocument();
    expect(screen.queryByText('agent-browser')).not.toBeInTheDocument();
  });

  it('confirms installation and redetects tools after success', async () => {
    render(<ToolDetectorSection />);

    await screen.findByText('node');
    fireEvent.click(screen.getAllByText('settingSystemTools.install.action')[0]);

    await waitFor(() => {
      expect(modalConfirm).toHaveBeenCalled();
      expect(installTool).toHaveBeenCalledWith('node');
      expect(detectAllTools).toHaveBeenLastCalledWith(true);
      expect(messageSuccess).toHaveBeenCalled();
    });
  });

  it('shows only failure feedback when installation fails', async () => {
    installTool.mockResolvedValueOnce({
      commandLabel: 'brew install node',
      error: 'Homebrew is required',
      success: false,
      toolName: 'node',
    });

    render(<ToolDetectorSection />);

    await screen.findByText('node');
    fireEvent.click(screen.getAllByText('settingSystemTools.install.action')[0]);

    await waitFor(() => {
      expect(messageError).toHaveBeenCalledWith('Homebrew is required');
    });
  });
});
