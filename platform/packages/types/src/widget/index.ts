import type { InteractiveFormDefinition, InteractiveFormField } from '../message/common/metadata';

// ===== Options kind =====

export interface OptionsWidgetItem {
  desc?: string;
  icon?: string;
  prompt?: string;
  title: string;
}

export interface OptionsWidgetDefinition {
  id: string;
  items: OptionsWidgetItem[];
  kind: 'options';
  version: 1;
}

// ===== Form kind =====

export interface FormWidgetDefinition {
  behavior?: InteractiveFormDefinition['behavior'];
  description?: string;
  fields: InteractiveFormField[];
  id: string;
  kind: 'form';
  submitLabel?: string;
  title: string;
  version: 1;
}

// ===== Union =====

export type InteractiveWidgetDefinition = FormWidgetDefinition | OptionsWidgetDefinition;
