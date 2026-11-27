---
name: dot-db-query
description: 'Use when needing to query the trncalciferdb database for information retrieval, debugging, or data inspection via DOT MCP tools. Triggers on database lookup, table data check, schema inspection, or row counting tasks. Default environment is uat unless the user explicitly specifies otherwise.'
---

# DOT Database Query Guide

When you need to look up information, troubleshoot issues, or inspect data in this project's database, use the **DOT MCP tools** (prefixed with `mcp__DOT__`). Do not attempt to connect via `psql` or other CLIs — DOT is the canonical, permissioned path.

## Database Basics

- **Database name**: `trncalciferdb`
- **ORM**: Drizzle (PostgreSQL)
- **Schema source of truth**: `packages/database/src/schemas/` — read these files directly to learn table names, columns, indexes, and relations before constructing queries. **Do not guess table/column names**; always confirm against the schema files first.
- **Default environment**: `uat` — when the user does not explicitly state which environment to query, use `env_type: "uat"`. Only switch to `pro`/`prod` when the user clearly asks for production data.

## Available DOT Tools

All tools below are MCP tools under the `DOT` server. They take `db_name`, `sql`, `env_type`, etc. as parameters.

| Tool                          | Use for                                                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp__DOT__sql_execute`       | Run a SQL query (read-only in `pro`; read/write in `fat`/`uat`). **Always add `LIMIT`** — default to `LIMIT 10`, max `LIMIT 50` for inspection. Aggregates (`COUNT`/`SUM`/`GROUP BY`) preferred over row dumps. |
| `mcp__DOT__show_tables`       | List tables in a db; supports `table_name_pattern` for fuzzy match.                                                                                                                                             |
| `mcp__DOT__show_create_table` | Get the `CREATE TABLE` DDL for a table.                                                                                                                                                                         |
| `mcp__DOT__show_index`        | List indexes on a table.                                                                                                                                                                                        |
| `mcp__DOT__show_table_status` | Row count, data size, index size, create/update time.                                                                                                                                                           |
| `mcp__DOT__show_table_data`   | Sample rows from a table (defaults to 10, ordered by `datachange_lasttime` desc if present).                                                                                                                    |

## Workflow

1. **Identify the table** — read `packages/database/src/schemas/` to find the right table and confirm column names. The Drizzle schema file is the source of truth for what columns exist.
2. **Pick the environment** — default `uat`. Confirm with the user if production data is needed.
3. **Choose the cheapest tool** — prefer `show_table_data` / `show_table_status` for quick peeks, and `sql_execute` with `LIMIT` + projection only for targeted lookups. Use `COUNT` first when you only need a count.
4. **Construct the query** — always project specific columns (`SELECT col1, col2`), never `SELECT *` unless inspecting schema. Always `LIMIT`.
5. **Report results** — summarize what the data shows relative to the user's question; don't dump raw rows.

## Examples

### List tables matching a pattern

```json
{
  "db_name": "trncalciferdb",
  "env_type": "uat",
  "table_name_pattern": "session"
}
```

(tool: `mcp__DOT__show_tables`)

### Inspect a table's schema

```json
{
  "db_name": "trncalciferdb",
  "env_type": "uat",
  "table_name": "sessions"
}
```

(tool: `mcp__DOT__show_create_table`)

### Count rows matching a condition

```json
{
  "db_name": "trncalciferdb",
  "env_type": "uat",
  "sql": "SELECT count(*) FROM sessions WHERE user_id = 'abc123';"
}
```

(tool: `mcp__DOT__sql_execute`)

### Look up specific rows

```json
{
  "db_name": "trncalciferdb",
  "env_type": "uat",
  "sql": "SELECT id, title, created_at FROM topics WHERE session_id = 'xyz' ORDER BY created_at DESC LIMIT 10;"
}
```

(tool: `mcp__DOT__sql_execute`)

## Rules & Guardrails

- **Environment default is `uat`.** Never query `pro`/`prod` unless the user explicitly asks. Production is read-only.
- **Row limits are mandatory.** Default `LIMIT 10`; never exceed `LIMIT 50` for inspection. For bulk export needs, tell the user to use the DOT platform (<http://dot.ops.ctripcorp.com>) directly — do not run large pulls.
- **Always project specific columns.** Avoid `SELECT *` — it pulls large JSONB columns and wastes tokens.
- **Confirm schema from `packages/database/src/schemas/` first.** Don't guess table or column names from memory.
- **Prefer aggregates for "how many / is there" questions** — `COUNT(*)` / `EXISTS` over row dumps.
- **Sensitive data**: API keys, proxy URLs, and similar secrets in the DB are encrypted under `KEY_VAULTS_SECRET`. Raw query results may show ciphertext — do not attempt to decrypt or log secrets.
- **Multi-tenancy**: most tables carry a `userId` (or `user_id`) column. Always scope lookups by `userId` when investigating a specific user's issue to avoid cross-tenant data leakage.

## Related Skills

- `db-migrations` — for generating/running Drizzle migrations when you need to _change_ schema, not just read it.
- `drizzle` — for Drizzle ORM query patterns in application code.
