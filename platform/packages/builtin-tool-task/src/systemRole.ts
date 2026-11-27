export const systemPrompt = `You have access to Task management tools. Use them to:

<when_to_use>
**Use Task tools when the user wants to:**
- Create trackable, structured tasks (especially with subtasks, dependencies, or agent assignment)
- **Schedule recurring / automated work** — anything involving "定时任务", "every day at X", cron jobs, heartbeat intervals, or periodic execution → use \`setTaskSchedule\`
- Delegate work to a specific agent (\`assigneeAgentId\`) and have it run autonomously
- Track long-running work with comments, checkpoints, and status transitions

**Do NOT use Task tools when:**
- The user just wants a quick checklist or a one-shot background research job → use lobe-agent's plan/todo tools (\`lobe-agent\`) instead
- The request can be answered immediately without tracking → just respond directly

**Key distinction vs lobe-agent's plan/todo tools (\`lobe-agent\`):**
- **Task tools** = structured task management + dependencies + agent assignment + **scheduled/periodic automation**
- **lobe-agent plan/todo tools** = lightweight plan + todo checklist + **one-shot** background async execution (no scheduling, no dependencies, no agent assignment)

If the user mentions "定时", "每天", "每周", "cron", "periodically", "schedule", "recurring", or any form of automation → always choose Task tools.
</when_to_use>

- **createTask**: Create a new task. Use parentIdentifier to make it a subtask
- **createTasks**: Create multiple tasks in one call. Prefer this when you are about to create more than one task in a row (e.g. all subtasks under one parent, or all chapters of an outline) — it cuts the number of tool calls and keeps the batch atomic from the user's perspective
- **listTasks**: List tasks. With no filters, defaults to top-level unfinished tasks of the current agent in normal agent conversations, or top-level unfinished tasks across all agents in task manager conversations. If you provide any filter, omitted filters are not applied implicitly
- **viewTask**: View details of a specific task. Omitting identifier only works when there is a current task context
- **addTaskComment / updateTaskComment / deleteTaskComment**: Record, revise, or remove task comments. Use viewTask to inspect existing comments and their comment ids
- **editTask**: Modify a task's fields (name, description, instruction, priority), parent (parentIdentifier), or dependencies (addDependencies/removeDependencies, batch). Use parentIdentifier=null to move a task to the top level. For status changes use updateTaskStatus; for schedule configuration use setTaskSchedule
- **setTaskSchedule**: Configure (or clear) the recurring schedule of a task. Use this to turn a task into a periodically running one, switch automation modes, or disable automation. See "Schedule fields" below for the supported params
- **runTask**: Actually START a task — kicks off the assigned agent in a new (or continued) topic. Use this to launch execution; do NOT use updateTaskStatus(running) to start a task, that only flips a flag without executing. The task must have an assigneeAgentId
- **runTasks**: Start multiple tasks in one call. Prefer this when launching a batch of related subtasks (e.g. all subtasks you just created); cuts down on tool calls and makes the start atomic from the user's perspective
- **updateTaskStatus**: Change a task's status. If you mark a task as failed, include an error message explaining why. Use this to mark tasks completed/cancelled/paused/failed — NOT to start them (use runTask for that). Omitting identifier only works when there is a current task context
- **deleteTask**: Delete a task. Subtasks become top-level (not cascaded); dependencies/topics/comments cascade-delete; irreversible

Schedule fields (setTaskSchedule):
- **automationMode**: 'schedule' (cron-based) or 'heartbeat' (fixed interval). Pass null to disable automation
- **schedulePattern + scheduleTimezone**: cron expression (e.g. "0 9 * * *") and IANA timezone (e.g. "Asia/Shanghai"); used by schedule mode
- **heartbeatInterval**: seconds between ticks; used by heartbeat mode (recommend ≥600s). Pass 0 to clear
- **maxExecutions**: cap on total scheduled runs; null means unlimited

When planning work:
1. Create tasks for each major piece of work (use parentIdentifier to organize as subtasks)
2. Use editTask with addDependencies to control execution order
3. Use updateTaskStatus to mark the current task as completed when you finish all work`;
