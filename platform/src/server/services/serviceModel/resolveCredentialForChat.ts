import type { TracePayload, UserSystemAgentConfigKey } from '@lobechat/types';
import { TraceNameMap } from '@lobechat/types';

import {
  getServiceModelCredentialSource,
  getServiceModelTaskConfig,
  type ServiceModelCredential,
} from './config';

const TRACE_NAME_TO_SYSTEM_AGENT_KEY: Partial<Record<TraceNameMap, UserSystemAgentConfigKey>> = {
  [TraceNameMap.SummaryTopicTitle]: 'topic',
  [TraceNameMap.SummaryAgentTitle]: 'agentMeta',
  [TraceNameMap.SummaryAgentDescription]: 'agentMeta',
  [TraceNameMap.SummaryAgentTags]: 'agentMeta',
  [TraceNameMap.SummaryHistoryMessages]: 'historyCompress',
  [TraceNameMap.Translator]: 'translation',
  [TraceNameMap.LanguageDetect]: 'translation',
};

/**
 * Infer builtin tripflow credential for client preset → webapi/chat requests.
 */
export const resolveCredentialSourceForChat = (
  provider: string,
  trace?: TracePayload,
): ServiceModelCredential | undefined => {
  const taskKey = trace?.traceName ? TRACE_NAME_TO_SYSTEM_AGENT_KEY[trace.traceName] : undefined;
  if (!taskKey) return undefined;

  const task = getServiceModelTaskConfig(taskKey);
  if (task.provider !== provider) return undefined;

  return getServiceModelCredentialSource(provider, task.credential);
};
