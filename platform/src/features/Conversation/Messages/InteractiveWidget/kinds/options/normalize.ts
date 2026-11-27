import type { OptionsWidgetDefinition } from '@lobechat/types';

export const normalizeOptionsWidgetDefinition = (
  value: unknown,
): OptionsWidgetDefinition | undefined => {
  if (!value || typeof value !== 'object') return undefined;

  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return undefined;

  const normalizedItems = items.filter(
    (item): item is OptionsWidgetDefinition['items'][number] =>
      !!item &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).title === 'string' &&
      !!(item as Record<string, unknown>).title,
  );

  if (normalizedItems.length === 0) return undefined;

  return {
    ...(value as Record<string, unknown>),
    items: normalizedItems,
  } as OptionsWidgetDefinition;
};
