import type { BuiltinToolResult } from '@lobechat/types';

import type { ExecTaskParams, ExecTasksParams } from './types';

/**
 * Pure trigger builders shared between the client executor and the server
 * runtime — these never touch storage, they only build the special `state`
 * that AgentRuntime's executor recognizes to dispatch exec_task/exec_tasks
 * (or their client-side variants) instructions.
 */

export const buildExecTaskResult = (
  params: ExecTaskParams,
  parentMessageId?: string,
): BuiltinToolResult => {
  const { description, instruction, inheritMessages, timeout, runInClient } = params;

  if (!description || !instruction) {
    return {
      content: 'Task description and instruction are required.',
      success: false,
    };
  }

  const task = { description, inheritMessages, instruction, runInClient, timeout };
  const stateType = runInClient ? 'execClientTask' : 'execTask';

  return {
    content: `🚀 Triggered async task for ${runInClient ? 'client-side' : ''} execution:\n- ${description}`,
    state: {
      parentMessageId,
      task,
      type: stateType,
    },
    stop: true,
    success: true,
  };
};

export const buildExecTasksResult = (
  params: ExecTasksParams,
  parentMessageId?: string,
): BuiltinToolResult => {
  const { tasks } = params;

  if (!tasks || tasks.length === 0) {
    return {
      content: 'No tasks provided to execute.',
      success: false,
    };
  }

  const taskCount = tasks.length;
  const taskList = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');
  const hasClientTasks = tasks.some((t) => t.runInClient);
  const stateType = hasClientTasks ? 'execClientTasks' : 'execTasks';
  const executionMode = hasClientTasks ? 'client-side' : '';

  return {
    content: `🚀 Triggered ${taskCount} async task${taskCount > 1 ? 's' : ''} for ${executionMode} execution:\n${taskList}`,
    state: {
      parentMessageId,
      tasks,
      type: stateType,
    },
    stop: true,
    success: true,
  };
};
