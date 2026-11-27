import { describe, expect, it } from 'vitest';

import {
  buildFormSubmissionSummary,
  getInteractiveFormDefaults,
  isInteractiveFormDefinition,
  normalizeInteractiveFormDefinition,
} from './schema';

describe('interactive form schema', () => {
  it('recognizes a valid interactive form definition', () => {
    expect(
      isInteractiveFormDefinition({
        fields: [
          {
            label: '出发城市',
            name: 'from',
            required: true,
            type: 'text',
          },
          {
            label: '预算',
            max: 100_000,
            min: 1000,
            name: 'budget',
            step: 1000,
            type: 'slider',
          },
        ],
        id: 'travel-plan',
        submitLabel: '生成旅行计划',
        title: '旅行计划收集表',
        version: 1,
      }),
    ).toBe(true);
  });

  it('rejects malformed interactive form definitions', () => {
    expect(isInteractiveFormDefinition(null)).toBe(false);
    expect(
      isInteractiveFormDefinition({ fields: [], id: 'empty', title: 'Empty', version: 1 }),
    ).toBe(false);
    expect(
      isInteractiveFormDefinition({
        fields: [{ label: 'Unknown', name: 'unknown', type: 'custom-code' }],
        id: 'bad-field',
        title: 'Bad',
        version: 1,
      }),
    ).toBe(false);
  });

  it('extracts default values from field definitions', () => {
    expect(
      getInteractiveFormDefaults({
        fields: [
          { label: '出发城市', name: 'from', type: 'text' },
          { defaultValue: 15_000, label: '预算', name: 'budget', type: 'slider' },
          {
            defaultValue: ['food'],
            label: '旅行风格',
            name: 'styles',
            options: [{ label: '美食探索', value: 'food' }],
            type: 'multiSelect',
          },
        ],
        id: 'travel-plan',
        title: '旅行计划收集表',
        version: 1,
      }),
    ).toEqual({
      budget: 15_000,
      styles: ['food'],
    });
  });

  it('normalizes field id aliases to field names', () => {
    const definition = normalizeInteractiveFormDefinition({
      fields: [
        {
          description: '请选择您计划的出行起止日期',
          id: 'travel_dates',
          label: '出行日期',
          required: true,
          type: 'dateRange',
        },
        {
          defaultValue: 2,
          id: 'people_count',
          label: '出行人数',
          max: 20,
          min: 1,
          type: 'number',
        },
      ],
      id: 'yunnan-travel-plan',
      title: '云南旅游计划定制',
      version: 1,
    });

    expect(definition?.fields.map((field) => field.name)).toEqual(['travel_dates', 'people_count']);
    expect(definition && getInteractiveFormDefaults(definition)).toEqual({
      people_count: 2,
    });
    expect(
      definition &&
        buildFormSubmissionSummary(definition, {
          people_count: 3,
          travel_dates: ['2026-07-01', '2026-07-05'],
        }),
    ).toBe('我已提交「云南旅游计划定制」：\n出行日期：2026-07-01 至 2026-07-05\n出行人数：3');
  });

  it('normalizes common agent-generated aliases in interactive form definitions', () => {
    const definition = normalizeInteractiveFormDefinition({
      behavior: 'send',
      description: '这是一个示例表单，展示各种字段类型',
      fields: [
        {
          label: '昵称',
          name: 'nickname',
          type: 'text',
        },
        {
          label: '工作年限',
          max: 30,
          min: 0,
          name: 'experience',
          step: 1,
          type: 'slider',
          default: 3,
        },
        {
          label: '订阅最新动态',
          name: 'subscribe',
          type: 'checkbox',
        },
      ],
      id: 'demo-form',
      submitLabel: '提交',
      title: '📝 用户信息收集表',
      version: 1,
    });

    expect(definition).toMatchObject({
      behavior: { submitMode: 'send-message' },
      fields: [
        {
          label: '昵称',
          name: 'nickname',
          type: 'text',
        },
        {
          defaultValue: 3,
          label: '工作年限',
          name: 'experience',
          type: 'slider',
        },
        {
          label: '订阅最新动态',
          name: 'subscribe',
          type: 'checkbox',
        },
      ],
      id: 'demo-form',
      title: '📝 用户信息收集表',
      version: 1,
    });
    expect(definition && getInteractiveFormDefaults(definition)).toEqual({
      experience: 3,
    });
  });

  it('allows single checkbox fields without options while keeping checkbox groups valid', () => {
    expect(
      isInteractiveFormDefinition({
        fields: [{ label: '订阅最新动态', name: 'subscribe', type: 'checkbox' }],
        id: 'single-checkbox',
        title: 'Single Checkbox',
        version: 1,
      }),
    ).toBe(true);

    expect(
      isInteractiveFormDefinition({
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
      }),
    ).toBe(true);
  });

  it('still rejects choice fields without options except single checkbox fields', () => {
    for (const type of ['multiSelect', 'radio', 'select']) {
      expect(
        isInteractiveFormDefinition({
          fields: [{ label: 'Bad choice', name: 'bad', type }],
          id: `bad-${type}`,
          title: 'Bad Choice',
          version: 1,
        }),
      ).toBe(false);
    }
  });

  it('builds a readable form submission summary with option labels', () => {
    const summary = buildFormSubmissionSummary(
      {
        fields: [
          { label: '出发城市', name: 'from', type: 'text' },
          {
            label: '旅行风格',
            name: 'styles',
            options: [
              { label: '文化历史', value: 'culture' },
              { label: '美食探索', value: 'food' },
            ],
            type: 'multiSelect',
          },
          {
            label: '出行日期',
            name: 'dateRange',
            type: 'dateRange',
          },
          {
            label: '预算',
            name: 'budget',
            type: 'slider',
          },
        ],
        id: 'travel-plan',
        title: '旅行计划收集表',
        version: 1,
      },
      {
        budget: 15_000,
        dateRange: ['2026-07-01', '2026-07-07'],
        from: '北京',
        styles: ['culture', 'food'],
      },
    );

    expect(summary).toBe(
      '我已提交「旅行计划收集表」：\n出发城市：北京\n旅行风格：文化历史、美食探索\n出行日期：2026-07-01 至 2026-07-07\n预算：15000',
    );
  });
});
