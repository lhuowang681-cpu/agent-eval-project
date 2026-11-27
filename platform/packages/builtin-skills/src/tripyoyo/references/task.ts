const content = `# lh task - Agent Task Management

Manage agent tasks: create, list, view, edit, delete, and schedule.

## Subcommands

- \`lh task list [--status <s>] [--root] [--parent <id>] [--agent <id>] [-L <n>] [--offset <n>] [--tree] [--board] [--json]\` - List tasks
- \`lh task view <id> [--json]\` - View task details by ID or identifier (e.g. \`T-1\`); also accepts \`docs_<id>\` / \`tpc_<id>\`
- \`lh task create -i <instruction> [-n <name>] [--agent <id>] [--parent <id>] [--priority <n>] [--prefix <p>] [--schedule <cron>] [--timezone <iana>] [--automation-mode <mode>] [--json]\` - Create a task
- \`lh task edit <id> [-n <name>] [-i <instruction>] [--agent <id>] [--priority <n>] [--description <text>] [--status <s>] [--schedule <cron>] [--timezone <iana>] [--automation-mode <mode>] [--heartbeat-interval <n>] [--heartbeat-timeout <n>] [--json]\` - Update a task
- \`lh task delete <id> [--yes]\` - Delete a task
- \`lh task checkpoint|dep|doc|lifecycle|review|topic ...\` - Subgroups for checkpoint, dependencies, pinned docs, run/comments, review, and topics

## Scheduling (important)

Tasks are the **only** mechanism in TripYoYo that actually gets dispatched. Use \`--schedule <cron>\` to create a scheduled task; it is scanned every 30 minutes by the central dispatcher and executed at the matching time.

- \`--schedule <cron>\` sets the cron pattern (e.g. \`0 8 * * *\` = every day at 08:00) and automatically sets \`automationMode=schedule\`.
- \`--timezone <iana>\` sets the timezone (e.g. \`Asia/Shanghai\`); defaults to \`UTC\`. Only applies when \`--schedule\` is given.
- Minimum interval is 30 minutes (enforced server-side).
- \`--automation-mode <mode>\`: \`heartbeat\` | \`schedule\`. Normally inferred from \`--schedule\` / \`--heartbeat-interval\`; only set explicitly to force a mode.
- In \`edit\`, \`--automation-mode none\` clears both automation mode and schedule, turning the task back into a plain backlog task that won't auto-run.

## Tips

- A task without \`--schedule\` / \`--automation-mode\` stays in \`backlog\` and never auto-runs.
- \`--heartbeat-interval <n>\` (seconds) implies \`automationMode=heartbeat\` for periodic execution.
- Use \`--json\` on \`list\`/\`view\` for machine-readable output; mutating commands print a short confirmation.
- Use \`--yes\` to skip confirmation on \`delete\`.

## Examples

\`\`\`bash
# Create a task that runs every day at 08:00 Asia/Shanghai
lh task create -i "从百度抓取最新新闻并汇总" -n "百度新闻抓取" --agent agt_xxx --schedule "0 8 * * *" --timezone "Asia/Shanghai"

# Verify schedule is wired
lh task view T-1
# → Automation: schedule  Schedule: 0 8 * * * (Asia/Shanghai)

# Stop it from auto-running
lh task edit T-1 --automation-mode none

# Delete
lh task delete T-1 --yes
\`\`\`
`;

export default content;
