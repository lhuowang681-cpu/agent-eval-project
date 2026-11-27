import type { InteractiveWidgetDefinition, InteractiveWidgetSubmission } from '@lobechat/types';
import type { FC } from 'react';

import { normalizeFormWidgetDefinition } from './kinds/form/normalize';
import FormWidget from './kinds/form/Render';
import { normalizeOptionsWidgetDefinition } from './kinds/options/normalize';
import OptionsWidget from './kinds/options/Render';

export interface InteractiveWidgetRenderProps<
  T extends InteractiveWidgetDefinition = InteractiveWidgetDefinition,
> {
  definition: T;
  messageId: string;
  submission?: InteractiveWidgetSubmission;
}

interface InteractiveWidgetKindDefinition<
  T extends InteractiveWidgetDefinition = InteractiveWidgetDefinition,
> {
  Component: FC<InteractiveWidgetRenderProps<T>>;
  kind: T['kind'];
  normalize: (value: unknown) => T | undefined;
}

/**
 * Single place to register a new interactive widget kind: add a { kind, Component, normalize }
 * entry here and it becomes dispatchable from the `interactive-widget` markdown tag.
 */
export const interactiveWidgetKinds: InteractiveWidgetKindDefinition<any>[] = [
  { Component: OptionsWidget, kind: 'options', normalize: normalizeOptionsWidgetDefinition },
  { Component: FormWidget, kind: 'form', normalize: normalizeFormWidgetDefinition },
];

export const getInteractiveWidgetKind = (kind: unknown) =>
  interactiveWidgetKinds.find((item) => item.kind === kind);
