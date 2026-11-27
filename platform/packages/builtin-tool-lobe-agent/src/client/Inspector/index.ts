import type { BuiltinInspector } from '@lobechat/types';

import { LobeAgentApiName } from '../../types';
import { ClearTodosInspector } from './ClearTodos';
import { CreatePlanInspector } from './CreatePlan';
import { CreateTodosInspector } from './CreateTodos';
import { ExecTaskInspector } from './ExecTask';
import { ExecTasksInspector } from './ExecTasks';
import { UpdatePlanInspector } from './UpdatePlan';
import { UpdateTodosInspector } from './UpdateTodos';

/**
 * Lobe Agent Inspector Components Registry
 *
 * Inspector components customize the title/header area
 * of tool calls in the conversation UI.
 */
export const LobeAgentInspectors: Record<string, BuiltinInspector> = {
  [LobeAgentApiName.clearTodos]: ClearTodosInspector as BuiltinInspector,
  [LobeAgentApiName.createPlan]: CreatePlanInspector as BuiltinInspector,
  [LobeAgentApiName.createTodos]: CreateTodosInspector as BuiltinInspector,
  [LobeAgentApiName.execTask]: ExecTaskInspector as BuiltinInspector,
  [LobeAgentApiName.execTasks]: ExecTasksInspector as BuiltinInspector,
  [LobeAgentApiName.updatePlan]: UpdatePlanInspector as BuiltinInspector,
  [LobeAgentApiName.updateTodos]: UpdateTodosInspector as BuiltinInspector,
};
