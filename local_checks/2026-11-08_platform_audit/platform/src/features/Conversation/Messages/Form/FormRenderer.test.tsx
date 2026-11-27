import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import FormRenderer from './FormRenderer';

afterEach(() => {
  cleanup();
});

describe('FormRenderer', () => {
  it('submits single checkbox fields as boolean values', async () => {
    const onSubmit = vi.fn();

    render(
      <FormRenderer
        definition={{
          fields: [{ label: '订阅最新动态', name: 'subscribe', type: 'checkbox' }],
          id: 'single-checkbox',
          title: 'Single Checkbox',
          version: 1,
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ subscribe: true });
    });
  });

  it('keeps checkbox groups submitting selected option arrays', async () => {
    const onSubmit = vi.fn();

    render(
      <FormRenderer
        definition={{
          fields: [
            {
              label: '可选服务',
              name: 'services',
              options: [
                { label: '接机', value: 'pickup' },
                { label: '早餐', value: 'breakfast' },
              ],
              type: 'checkbox',
            },
          ],
          id: 'checkbox-group',
          title: 'Checkbox Group',
          version: 1,
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByLabelText('接机'));
    fireEvent.click(screen.getByRole('button', { name: /提\s*交/ }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ services: ['pickup'] });
    });
  });
});
