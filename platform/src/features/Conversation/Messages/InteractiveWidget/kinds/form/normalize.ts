import type { FormWidgetDefinition } from '@lobechat/types';

import { normalizeInteractiveFormDefinition } from '@/features/Conversation/Messages/Form/schema';

export const normalizeFormWidgetDefinition = (value: unknown): FormWidgetDefinition | undefined => {
  const normalized = normalizeInteractiveFormDefinition(value);
  if (!normalized) return undefined;

  return { ...normalized, kind: 'form' };
};
