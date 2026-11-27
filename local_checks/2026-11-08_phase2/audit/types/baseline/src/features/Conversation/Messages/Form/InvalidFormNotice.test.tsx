import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import InvalidFormNotice, { buildInvalidFormTroubleshootingInfo } from './InvalidFormNotice';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InvalidFormNotice', () => {
  it('builds troubleshooting info with message id and raw definition', () => {
    const info = buildInvalidFormTroubleshootingInfo({
      definition: { fields: [{ label: 'Bad', name: 'bad', type: 'custom' }] },
      messageId: 'message-1',
    });

    expect(info).toContain('interactive-form-invalid-definition');
    expect(info).toContain('message-1');
    expect(info).toContain('"type": "custom"');
  });

  it('copies troubleshooting info from the invalid form notice', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <InvalidFormNotice
        definition={{ fields: [{ label: 'Bad', name: 'bad', type: 'custom' }] }}
        messageId="message-2"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '复制排障信息' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('message-2'));
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"type": "custom"'));
  });
});
