import type {
  InteractiveFormDefinition,
  InteractiveFormField,
  InteractiveFormFieldOption,
} from '@lobechat/types';

const SUPPORTED_FIELD_TYPES = new Set([
  'checkbox',
  'date',
  'dateRange',
  'multiSelect',
  'number',
  'radio',
  'select',
  'slider',
  'text',
  'textarea',
]);

const OPTION_REQUIRED_FIELD_TYPES = new Set(['multiSelect', 'radio', 'select']);
const OPTION_SUPPORTED_FIELD_TYPES = new Set(['checkbox', ...OPTION_REQUIRED_FIELD_TYPES]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeFieldOption = (value: unknown): InteractiveFormFieldOption | undefined => {
  if (typeof value === 'string' && value) return { label: value, value };
  if (!isRecord(value)) return;

  if (typeof value.label === 'string' && typeof value.value === 'string') {
    return { label: value.label, value: value.value };
  }
};

const normalizeFieldOptions = (value: unknown) => {
  if (!Array.isArray(value)) return;

  const options = value.map(normalizeFieldOption);

  if (options.some((option) => !option)) return;

  return options as InteractiveFormFieldOption[];
};

const getFieldName = (field: Record<string, unknown>) => {
  if (typeof field.name === 'string' && field.name) return field.name;
  if (typeof field.id === 'string' && field.id) return field.id;
  if (typeof field.key === 'string' && field.key) return field.key;
};

const normalizeBehavior = (value: unknown): InteractiveFormDefinition['behavior'] => {
  if (value === 'send') return { submitMode: 'send-message' };
  if (value === 'save') return { submitMode: 'save-only' };
  if (!isRecord(value)) return;

  const behavior: InteractiveFormDefinition['behavior'] = {};

  if (typeof value.allowEditAfterSubmit === 'boolean') {
    behavior.allowEditAfterSubmit = value.allowEditAfterSubmit;
  }
  if (typeof value.generateSummary === 'boolean') {
    behavior.generateSummary = value.generateSummary;
  }
  if (value.submitMode === 'save-only' || value.submitMode === 'send-message') {
    behavior.submitMode = value.submitMode;
  }

  return Object.keys(behavior).length > 0 ? behavior : undefined;
};

const normalizeInteractiveFormField = (value: unknown): InteractiveFormField | undefined => {
  if (!isRecord(value)) return;
  const name = getFieldName(value);

  if (!name) return;
  if (typeof value.label !== 'string' || !value.label) return;
  if (typeof value.type !== 'string' || !SUPPORTED_FIELD_TYPES.has(value.type)) return;

  const normalizedField: Record<string, unknown> = {
    ...value,
    name,
  };

  if (!('defaultValue' in normalizedField) && 'default' in value) {
    normalizedField.defaultValue = value.default;
  }

  delete normalizedField.default;

  if (OPTION_SUPPORTED_FIELD_TYPES.has(value.type)) {
    const options = normalizeFieldOptions(value.options);

    if (OPTION_REQUIRED_FIELD_TYPES.has(value.type) && (!options || options.length === 0)) return;
    if (value.options !== undefined && (!options || options.length === 0)) return;

    if (options) {
      normalizedField.options = options;
    } else {
      delete normalizedField.options;
    }
  }

  return normalizedField as unknown as InteractiveFormField;
};

export const normalizeInteractiveFormDefinition = (
  value: unknown,
): InteractiveFormDefinition | undefined => {
  if (!isRecord(value)) return;
  if (value.version !== 1) return;
  if (typeof value.id !== 'string' || !value.id) return;
  if (typeof value.title !== 'string' || !value.title) return;
  if (!Array.isArray(value.fields) || value.fields.length === 0) return;

  const fields = value.fields.map(normalizeInteractiveFormField);

  if (fields.some((field) => !field)) return;

  const behavior = normalizeBehavior(value.behavior);
  const definition: Record<string, unknown> = {
    ...value,
    fields: fields as InteractiveFormField[],
  };

  if (behavior) {
    definition.behavior = behavior;
  } else {
    delete definition.behavior;
  }

  return definition as unknown as InteractiveFormDefinition;
};

export const isInteractiveFormDefinition = (value: unknown): value is InteractiveFormDefinition =>
  !!normalizeInteractiveFormDefinition(value);

export const getInteractiveFormDefaults = (definition: InteractiveFormDefinition) => {
  const defaults: Record<string, unknown> = {};

  for (const field of definition.fields) {
    if ('defaultValue' in field && field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  }

  return defaults;
};

const stringifyValue = (value: unknown): string => {
  if (Array.isArray(value)) return value.filter(Boolean).join('、');
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (value === null || value === undefined || value === '') return '未填写';

  return String(value);
};

const findOptionLabel = (options: InteractiveFormFieldOption[] | undefined, value: unknown) => {
  const option = options?.find((item) => item.value === value);

  return option?.label ?? stringifyValue(value);
};

const getFieldOptions = (field: InteractiveFormField) =>
  'options' in field ? field.options : undefined;

const formatFieldValue = (field: InteractiveFormField, value: unknown) => {
  if (field.type === 'dateRange' && Array.isArray(value)) {
    const [start, end] = value;

    return start && end ? `${start} 至 ${end}` : stringifyValue(value);
  }

  if (field.type === 'multiSelect' && Array.isArray(value)) {
    return value.map((item) => findOptionLabel(field.options, item)).join('、') || '未填写';
  }

  if (['checkbox', 'radio', 'select'].includes(field.type)) {
    const options = getFieldOptions(field);

    if (Array.isArray(value)) {
      return value.map((item) => findOptionLabel(options, item)).join('、');
    }

    return findOptionLabel(options, value);
  }

  return stringifyValue(value);
};

export const buildFormSubmissionSummary = (
  definition: InteractiveFormDefinition,
  values: Record<string, unknown>,
) => {
  const lines = [`我已提交「${definition.title}」：`];

  for (const field of definition.fields) {
    if (!(field.name in values)) continue;

    lines.push(`${field.label}：${formatFieldValue(field, values[field.name])}`);
  }

  return lines.join('\n');
};
