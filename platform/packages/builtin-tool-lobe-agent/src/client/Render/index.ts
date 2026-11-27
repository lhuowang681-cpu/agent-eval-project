import { LobeAgentApiName } from '../../types';
import CreatePlan from './CreatePlan';
import ExecTaskRender from './ExecTask';
import ExecTasksRender from './ExecTasks';
import TodoListRender from './TodoList';

/**
 * Lobe Agent Tool Render Components Registry
 *
 * All todo operations use the same TodoList render component
 * which displays the current state of the todo list.
 * Plan operations use the CreatePlan render component.
 */
export const LobeAgentRenders = {
  // All todo operations render the same TodoList UI
  [LobeAgentApiName.clearTodos]: TodoListRender,
  [LobeAgentApiName.createTodos]: TodoListRender,
  [LobeAgentApiName.updateTodos]: TodoListRender,

  // Plan operations render the PlanCard UI
  [LobeAgentApiName.createPlan]: CreatePlan,
  [LobeAgentApiName.updatePlan]: CreatePlan,

  // Async task operations
  [LobeAgentApiName.execTask]: ExecTaskRender,
  [LobeAgentApiName.execTasks]: ExecTasksRender,
};

export { default as CreatePlan, PlanCard } from './CreatePlan';
export { default as ExecTaskRender } from './ExecTask';
export { default as ExecTasksRender } from './ExecTasks';
export type { TodoListRenderState } from './TodoList';
export { default as TodoListRender, TodoListUI } from './TodoList';
