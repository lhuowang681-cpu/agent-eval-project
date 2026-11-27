'use client';

import type { InteractiveFormDefinition, InteractiveFormField } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Slider } from 'antd';
import { createStyles } from 'antd-style';
import { memo, useCallback } from 'react';

import { getInteractiveFormDefaults } from './schema';

const { RangePicker } = DatePicker;

const useStyles = createStyles(({ css, token }) => ({
  container: css`
    padding: ${token.paddingMD}px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillQuaternary};
  `,
  description: css`
    margin: 0;
    color: ${token.colorTextSecondary};
  `,
  form: css`
    .ant-form-item {
      margin-block-end: ${token.marginMD}px;
    }

    .ant-form-item:last-child {
      margin-block-end: 0;
    }
  `,
  title: css`
    margin: 0;
    font-size: ${token.fontSizeLG}px;
    font-weight: 600;
    color: ${token.colorTextHeading};
  `,
}));

interface FormRendererProps {
  definition: InteractiveFormDefinition;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (values: Record<string, unknown>) => void;
}

const getRules = (field: InteractiveFormField) =>
  field.required ? [{ message: `请填写${field.label}`, required: true }] : undefined;

const renderField = (field: InteractiveFormField) => {
  switch (field.type) {
    case 'textarea': {
      return (
        <Input.TextArea autoSize={{ maxRows: 6, minRows: 3 }} placeholder={field.placeholder} />
      );
    }

    case 'select': {
      return <Select options={field.options} placeholder={field.placeholder} />;
    }

    case 'multiSelect': {
      return <Select mode="multiple" options={field.options} placeholder={field.placeholder} />;
    }

    case 'radio': {
      return <Radio.Group options={field.options} />;
    }

    case 'checkbox': {
      if (!field.options) return <Checkbox />;

      return <Checkbox.Group options={field.options} />;
    }

    case 'date': {
      return <DatePicker style={{ width: '100%' }} />;
    }

    case 'dateRange': {
      return <RangePicker style={{ width: '100%' }} />;
    }

    case 'number': {
      return (
        <InputNumber
          max={field.max}
          min={field.min}
          placeholder={field.placeholder}
          step={field.step}
          style={{ width: '100%' }}
        />
      );
    }

    case 'slider': {
      return <Slider max={field.max} min={field.min} step={field.step} />;
    }

    default: {
      return <Input placeholder={field.placeholder} />;
    }
  }
};

const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeValue);

  if (
    value &&
    typeof value === 'object' &&
    'format' in value &&
    typeof value.format === 'function'
  ) {
    return value.format('YYYY-MM-DD');
  }

  return value;
};

const normalizeValues = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, normalizeValue(value)]));

const isSingleCheckboxField = (field: InteractiveFormField) =>
  field.type === 'checkbox' && !('options' in field && field.options);

const FormRenderer = memo<FormRendererProps>(({ definition, disabled, loading, onSubmit }) => {
  const { styles } = useStyles();
  const [form] = Form.useForm();

  const handleFinish = useCallback(
    (values: Record<string, unknown>) => {
      onSubmit(normalizeValues(values));
    },
    [onSubmit],
  );

  return (
    <Flexbox className={styles.container} gap={16}>
      <Flexbox gap={4}>
        <h3 className={styles.title}>{definition.title}</h3>
        {definition.description && <p className={styles.description}>{definition.description}</p>}
      </Flexbox>
      <Form
        className={styles.form}
        disabled={disabled || loading}
        form={form}
        initialValues={getInteractiveFormDefaults(definition)}
        layout="vertical"
        onFinish={handleFinish}
      >
        {definition.fields.map((field) => (
          <Form.Item
            extra={field.description}
            key={field.name}
            label={field.label}
            name={field.name}
            rules={getRules(field)}
            valuePropName={isSingleCheckboxField(field) ? 'checked' : undefined}
          >
            {renderField(field)}
          </Form.Item>
        ))}
        <Form.Item>
          <Button block htmlType="submit" loading={loading} type="primary">
            {definition.submitLabel || '提交'}
          </Button>
        </Form.Item>
      </Form>
    </Flexbox>
  );
});

FormRenderer.displayName = 'FormRenderer';

export default FormRenderer;
