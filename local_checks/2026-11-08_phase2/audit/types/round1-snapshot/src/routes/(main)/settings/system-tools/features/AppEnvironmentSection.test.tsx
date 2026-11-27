import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AppEnvironmentSection from './AppEnvironmentSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Flexbox: ({ children }: any) => <div>{children}</div>,
  Form: ({ items }: any) => (
    <div>
      {items.map((group: any) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <p>{group.desc}</p>
          {group.children.map((item: any) => (
            <div key={String(item.label)}>{item.label}</div>
          ))}
        </section>
      ))}
    </div>
  ),
  Tag: ({ children }: any) => <span>{children}</span>,
  Text: ({ children }: any) => <span>{children}</span>,
}));

describe('AppEnvironmentSection', () => {
  it('renders Electron, Chromium, and embedded Node.js versions from preload env', () => {
    window.lobeEnv = {
      chromeVersion: '126.0.0',
      electronVersion: '31.0.0',
      nodeVersion: '22.0.0',
    };

    render(<AppEnvironmentSection />);

    expect(screen.getByText('Electron')).toBeInTheDocument();
    expect(screen.getByText('31.0.0')).toBeInTheDocument();
    expect(screen.getByText('Chromium')).toBeInTheDocument();
    expect(screen.getByText('126.0.0')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('22.0.0')).toBeInTheDocument();
  });
});
