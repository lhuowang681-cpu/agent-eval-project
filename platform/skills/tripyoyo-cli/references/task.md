# Task Commands

Manage agent tasks: create, edit, list, view, delete, and schedule.

**Source**: `apps/cli/src/commands/task/`

> **Scheduling**: Tasks are the **only** mechanism in TripYoYo that actually gets dispatched. A task with `automationMode='schedule'` + a cron `schedulePattern` is scanned every 30 minutes by the central QStash dispatcher and executed at the matching time. Use `lh task create --schedule` to create a scheduled task. Do **not** use `lh cron` — it exists in some versions but is not wired to any dispatcher and will never fire.

## `lh task list`

List tasks.

```bash
lh task list [options]
```

| Option            | Description                                                         | Default |
| ----------------- | ------------------------------------------------------------------- | ------- |
| `--status <s>`    | Filter by status (backlog/running/paused/completed/failed/canceled) | -       |
| `--root`          | Only root tasks (no parent)                                         | -       |
| `--parent <id>`   | Filter by parent task ID                                            | -       |
| `--agent <id>`    | Filter by assignee agent ID                                         | -       |
| `-L, --limit <n>` | Page size                                                           | `50`    |
| `--offset <n>`    | Offset                                                              | `0`     |
| `--tree`          | Display as tree                                                     | -       |
| `--board`         | Kanban board grouped by status                                      | -       |
| `--json [fields]` | JSON output with optional field filter                              | -       |

**Table columns**: ID, NAME, STATUS, PRI, AGENT, TYPE, CREATED

---

## `lh task view <id>`

View task details by ID or identifier (e.g. `T-1`). Also accepts `docs_<id>` (shows document content) or `tpc_<id>` (shows topic messages).

```bash
lh task view [fields]] < id > [--json
```

**Displays**: identifier, name, status, priority, instruction, agent, automation mode, schedule (pattern + timezone), heartbeat, subtasks, topics, timestamps.

---

## `lh task create`

Create a new task.

```bash
lh task create [options]
```

| Option                     | Description                                                      | Required |
| -------------------------- | ---------------------------------------------------------------- | -------- |
| `-i, --instruction <text>` | Task instruction                                                 | **Yes**  |
| `-n, --name <name>`        | Task name                                                        | No       |
| `--agent <id>`             | Assign to agent                                                  | No       |
| `--parent <id>`            | Parent task ID                                                   | No       |
| `--priority <n>`           | 0=none, 1=urgent, 2=high, 3=normal, 4=low                        | `0`      |
| `--prefix <prefix>`        | Identifier prefix                                                | `T`      |
| `--schedule <cron>`        | Cron schedule (e.g. `0 8 * * *`); sets `automationMode=schedule` | No       |
| `--timezone <iana>`        | Schedule timezone (e.g. `Asia/Shanghai`)                         | `UTC`    |
| `--automation-mode <mode>` | `heartbeat` \| `schedule` (normally inferred from `--schedule`)  | No       |
| `--json [fields]`          | JSON output with optional field filter                           | No       |

**Schedule notes**:

- `--schedule` automatically sets `automationMode='schedule'`; you only need `--automation-mode` to force `heartbeat`.
- `--timezone` only applies when `--schedule` is given.
- Cron minimum interval is 30 minutes (enforced server-side).
- Only `schedule` mode is dispatched; a task without `--schedule`/`--automation-mode` stays in `backlog` and never auto-runs.

**Output**: Created task identifier (e.g. `T-4`).

---

## `lh task edit <id>`

Update a task. All fields optional; only specified ones change.

```bash
lh task edit < id > [options]
```

| Option                     | Description                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `-n, --name <name>`        | Task name                                                          |
| `-i, --instruction <text>` | Task instruction                                                   |
| `--agent <id>`             | Assign to agent                                                    |
| `--priority <n>`           | Priority (0-4)                                                     |
| `--description <text>`     | Task description                                                   |
| `--status <status>`        | Set status (backlog/running/paused/completed/failed/canceled)      |
| `--schedule <cron>`        | Set cron schedule; sets `automationMode=schedule`                  |
| `--timezone <iana>`        | Schedule timezone                                                  |
| `--automation-mode <mode>` | `heartbeat` \| `schedule` \| `none` (clear automation + schedule)  |
| `--heartbeat-interval <n>` | Heartbeat interval in seconds (implies `automationMode=heartbeat`) |
| `--heartbeat-timeout <n>`  | Heartbeat timeout in seconds (0 to disable)                        |
| `--json [fields]`          | JSON output with optional field filter                             |

**Clearing automation**: `--automation-mode none` clears both `automationMode` and `schedulePattern`, turning the task back into a plain backlog task that won't auto-run.

---

## `lh task delete <id>`

Delete a task.

```bash
lh task delete < id > [--yes]
```

Requires confirmation unless `--yes` is provided.

---

## Subcommands

The task command also exposes subgroups for advanced lifecycle management:

- `lh task checkpoint` — checkpoint config (get/set/clear)
- `lh task dep` — dependencies (add/remove/list)
- `lh task doc` — pinned documents
- `lh task lifecycle` — run, run-ready-subtasks, preview-subtask-layers, comments
- `lh task review` — review config and state
- `lh task topic` — task topics

Run `lh task <subgroup> --help` for details.

---

## Example: create a scheduled task

```bash
# Create a task that runs every day at 08:00 Asia/Shanghai
lh task create \
  -i "从百度抓取最新新闻并汇总" \
  -n "百度新闻定时抓取" \
  --agent agt_xxx \
  --schedule "0 8 * * *" \
  --timezone "Asia/Shanghai"

# Verify schedule is wired
lh task view T-1
# → Automation: schedule  Schedule: 0 8 * * * (Asia/Shanghai)

# Stop it from running
lh task edit T-1 --automation-mode none

# Delete
lh task delete T-1 --yes
```
