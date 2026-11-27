import { cleanup, render } from '@testing-library/react';
import { createElement, type ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatasetCreateModal from './DatasetCreateModal';
import DatasetEditModal from './DatasetEditModal';
import TestCaseCreateModal from './TestCaseCreateModal';
import TestCaseEditModal from './TestCaseEditModal';

// Replace external UI primitives, but execute all four real modal components.
// An unbound JSX identifier such as a missing Input import must still throw.
vi.mock('@lobehub/ui', async () => {
  const { createElement } = await import('react');
  const Container = ({ children }: { children?: React.ReactNode }) =>
    createElement('div', null, children);
  const Input = Object.assign(() => createElement('input'), {
    TextArea: () => createElement('textarea'),
  });
  return {
    Accordion: Container,
    AccordionItem: Container,
    Center: Container,
    Flexbox: Container,
    Icon: Container,
    Input,
    Modal: Container,
    Text: Container,
    TextArea: Input.TextArea,
  };
});
vi.mock('antd', async () => {
  const { createElement } = await import('react');
  const Container = ({
    children,
    label,
  }: {
    children?: React.ReactNode;
    label?: React.ReactNode;
  }) => createElement('div', null, label, children);
  const form = {
    setFieldsValue: vi.fn(),
    setFieldValue: vi.fn(),
    resetFields: vi.fn(),
    validateFields: vi.fn(),
  };
  const Form = Object.assign(Container, {
    Item: Container,
    useForm: () => [form],
    useWatch: (name: string) => (name === 'evalMode' ? 'llm-rubric' : undefined),
  });
  const Input = Object.assign(() => createElement('input'), {
    TextArea: () => createElement('textarea'),
  });
  return {
    App: { useApp: () => ({ message: { success: vi.fn(), error: vi.fn() } }) },
    Form,
    Input,
    InputNumber: Input,
    Select: () => createElement('select'),
  };
});
vi.mock('antd-style', () => ({ cssVar: {} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/agentEval', () => ({ agentEvalService: {} }));
afterEach(cleanup);

describe('real Judge modal component rendering', () => {
  for (const [name, Component] of [
    ['DatasetCreate', DatasetCreateModal],
    ['DatasetEdit', DatasetEditModal],
    ['TestCaseCreate', TestCaseCreateModal],
    ['TestCaseEdit', TestCaseEditModal],
  ] as Array<[string, ComponentType<any>]>) {
    it(`${name} opens with complete Judge fields and bound JSX controls`, () => {
      const config = { model: 'synthetic', provider: 'openai', criteria: 'synthetic criterion' };
      const { container } = render(
        createElement(Component, {
          open: true,
          onClose: vi.fn(),
          onCancel: vi.fn(),
          datasetId: 'd',
          benchmarkId: 'b',
          dataset: { id: 'd', name: 'Dataset', evalMode: 'llm-rubric', evalConfig: config },
          testCase: {
            id: 'c',
            datasetId: 'd',
            content: { input: 'question' },
            evalMode: 'llm-rubric',
            evalConfig: config,
          },
        }),
      );
      expect(container.textContent).toContain('judge.provider');
      expect(container.textContent).toContain('judge.model');
      expect(container.querySelector('input')).toBeTruthy();
    });
  }
});
