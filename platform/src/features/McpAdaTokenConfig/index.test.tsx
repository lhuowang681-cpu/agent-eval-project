import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MCP_ADA_TOKEN_PLACEHOLDER } from '../../utils/mcpAdaToken';
import McpAdaTokenConfig from './index';

describe('McpAdaTokenConfig', () => {
  it('renders the token input without crashing', () => {
    render(<McpAdaTokenConfig saveToken={vi.fn()} />);

    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', MCP_ADA_TOKEN_PLACEHOLDER);
  });
});
