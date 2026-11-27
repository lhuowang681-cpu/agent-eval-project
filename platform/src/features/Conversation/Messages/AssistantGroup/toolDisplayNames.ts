import type { ChatToolPayloadWithResult } from '@lobechat/types';
import { t } from 'i18next';

import { LOADING_FLAT } from '@/const/message';

import { TOOL_API_DISPLAY_NAMES } from './constants';

const toTitleCase = (apiName: string): string =>
  apiName
    .replaceAll(/[_-]/g, ' ')
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/\b\w/g, (s) => s.toUpperCase())
    .trim();

export const getToolDisplayName = (apiName: string): string => {
  const defaultValue = toTitleCase(apiName);
  const key = TOOL_API_DISPLAY_NAMES[apiName];
  if (!key) return defaultValue;

  return t(key, { defaultValue, ns: 'chat' });
};

export const areWorkflowToolsComplete = (tools: ChatToolPayloadWithResult[]): boolean => {
  const visibleTools = tools.filter((tool) => tool.intervention?.status !== 'pending');
  if (visibleTools.length === 0) return false;

  return visibleTools.every((tool) => tool.result && tool.result.content !== LOADING_FLAT);
};

export const getWorkflowSummaryText = (tools: ChatToolPayloadWithResult[]): string => {
  const groups = new Map<string, number>();
  for (const tool of tools) {
    groups.set(tool.apiName, (groups.get(tool.apiName) || 0) + 1);
  }

  return [...groups.entries()]
    .map(([apiName, count]) => {
      const name = getToolDisplayName(apiName);
      return count > 1 ? `${name} (${count})` : name;
    })
    .join(', ');
};

export const hasWorkflowError = (tools: ChatToolPayloadWithResult[]): boolean =>
  tools.some((tool) => tool.result?.error);

export const hasPendingIntervention = (tools: ChatToolPayloadWithResult[]): boolean =>
  tools.some((tool) => tool.intervention?.status === 'pending');
