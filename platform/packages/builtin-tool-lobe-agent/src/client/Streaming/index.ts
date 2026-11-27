import type { BuiltinStreaming } from '@lobechat/types';

import { LobeAgentApiName } from '../../types';
import { CreatePlanStreaming } from './CreatePlan';
import { ExecTaskStreaming } from './ExecTask';
import { ExecTasksStreaming } from './ExecTasks';

/**
 * Lobe Agent Streaming Components Registry
 *
 * Streaming components render tool calls while they are
 * still executing, allowing real-time feedback to users.
 */
export const LobeAgentStreamings: Record<string, BuiltinStreaming> = {
  [LobeAgentApiName.createPlan]: CreatePlanStreaming as BuiltinStreaming,
  [LobeAgentApiName.execTask]: ExecTaskStreaming as BuiltinStreaming,
  [LobeAgentApiName.execTasks]: ExecTasksStreaming as BuiltinStreaming,
};

export { CreatePlanStreaming } from './CreatePlan';
export { ExecTaskStreaming } from './ExecTask';
export { ExecTasksStreaming } from './ExecTasks';
