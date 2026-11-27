import { describe, expect, it } from 'vitest';

import { getInteractiveWidgetKind, interactiveWidgetKinds } from './registry';

describe('interactiveWidgetKinds registry', () => {
  it('registers the options and form kinds', () => {
    expect(interactiveWidgetKinds.map((item) => item.kind)).toEqual(['options', 'form']);
  });

  it('resolves a kind definition by kind string', () => {
    expect(getInteractiveWidgetKind('options')?.kind).toBe('options');
    expect(getInteractiveWidgetKind('form')?.kind).toBe('form');
  });

  it('returns undefined for unknown or missing kinds', () => {
    expect(getInteractiveWidgetKind('confirm')).toBeUndefined();
    expect(getInteractiveWidgetKind(undefined)).toBeUndefined();
  });

  it('normalizes a valid options definition and drops items without a title', () => {
    const definition = getInteractiveWidgetKind('options')!.normalize({
      id: 'dinner-options',
      items: [
        { title: 'Pizza' },
        { title: '' },
        { icon: '🍜', prompt: 'give me noodles', title: 'Noodles' },
      ],
      kind: 'options',
      version: 1,
    });

    expect(definition?.items).toEqual([
      { title: 'Pizza' },
      { icon: '🍜', prompt: 'give me noodles', title: 'Noodles' },
    ]);
  });

  it('rejects an options definition with no valid items', () => {
    expect(
      getInteractiveWidgetKind('options')!.normalize({
        id: 'empty',
        items: [{ title: '' }],
        kind: 'options',
        version: 1,
      }),
    ).toBeUndefined();
  });

  it('normalizes a valid form definition and tags it with kind "form"', () => {
    const definition = getInteractiveWidgetKind('form')!.normalize({
      fields: [{ label: '出发城市', name: 'from', type: 'text' }],
      id: 'travel-plan',
      kind: 'form',
      title: '旅行计划收集表',
      version: 1,
    });

    expect(definition?.kind).toBe('form');
    expect(definition?.fields).toHaveLength(1);
  });

  it('rejects a malformed form definition', () => {
    expect(
      getInteractiveWidgetKind('form')!.normalize({ id: 'bad', kind: 'form', version: 1 }),
    ).toBeUndefined();
  });
});
