import { describe, expect, it } from 'vitest';

import { calculatorExecutor } from '../executor';
import { CalculatorExecutionRuntime } from './index';

describe('CalculatorExecutionRuntime.calculate structured evidence', () => {
  it('forwards the original structured calculation error without interpreting text', async () => {
    const input = { expression: 'invalid(' };
    const original = await calculatorExecutor.calculate(input);
    expect(original.success).toBe(false);
    expect(original.error).toMatchObject({ type: 'CalculationError', message: expect.any(String) });

    const result = await new CalculatorExecutionRuntime().calculate(input);
    expect(result.success).toBe(false);
    expect(result.error).toEqual(original.error);
    expect(result.content).toBe(original.content);
  });

  it('preserves successful content and state without introducing an error', async () => {
    const result = await new CalculatorExecutionRuntime().calculate({ expression: '2 + 2' });
    expect(result.success).toBe(true);
    expect(result.content).toBe('4');
    expect(result.state).toMatchObject({ expression: '2 + 2', result: '4' });
    expect(result.error).toBeUndefined();
  });
});
