# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tech Stack

- Next.js 16 + React 19 + TypeScript
- SPA inside Next.js with `react-router-dom`
- `@lobehub/ui`, antd for components; antd-style for CSS-in-JS
- react-i18next for i18n; zustand for state management
- SWR for data fetching; TRPC for type-safe backend
- **Drizzle ORM with PostgreSQL** (supports Neon serverless or node-postgres drivers)
- Vitest for testing

## Database (PostgreSQL)

The project uses **PostgreSQL** as its primary database with Drizzle ORM. The database package is located at `packages/database/` and is structured as an autonomous package.

**Database Name**: `trncalciferdb`

### Database Configuration

**Environment Variables** (in `.env`):

- `DATABASE_URL`: PostgreSQL connection string (required)
  - Format: `postgres://username:password@host:port/database`
- `DATABASE_DRIVER`: `"neon"` (default, serverless) or `"node"` (standard pg)
- `KEY_VAULTS_SECRET`: Encryption key for sensitive data (API keys, proxy URLs)
  - Generate with: `openssl rand -base64 32`
  - **Required** - app throws error if not set
- `DATABASE_TEST_URL`: Optional separate database for testing

### Database Commands

```bash
# Generate migrations from schema changes
bun run db:generate

# Run pending migrations
bun run db:migrate

# Open Drizzle Studio GUI for database inspection
bun run db:studio

# Generate DBML documentation
bun run db:visualize
```

### Database Architecture

**Location**: `packages/database/`

**Key Components**:

- `src/schemas/` - 31 Drizzle ORM table definitions (users, agents, sessions, messages, topics, files, chunks, embeddings, market tables, etc.)
- `src/models/` - Business logic models (TopicModel, AgentModel, MessageModel, etc.)
- `src/repositories/` - High-level business operations (SearchRepository, KnowledgeRepository, etc.)
- `src/core/` - Database initialization and driver selection
- `migrations/` - 100+ SQL migration files

**Usage Pattern**:

```typescript
import { getServerDB } from '@lobechat/database';

const db = await getServerDB();
const topicModel = new TopicModel(db, userId);
const topics = await topicModel.query({ agentId, pageSize: 10 });
```

**Key Features**:

- **Vector Search**: pgvector extension for embeddings (semantic search + BM25)
- **Multi-tenancy**: All queries include `userId` filter for data isolation
- **Type Safety**: Full TypeScript with Drizzle ORM type inference
- **Cascade Deletes**: User deletion cascades to all related entities
- **JSONB**: Rich structured data storage for metadata

### Development Setup

For local development with Docker:

```bash
# Start PostgreSQL, Redis, and other services
bun run dev:docker

# Run migrations
bun run db:migrate

# Stop services
bun run dev:docker:down

# Reset database (WARNING: deletes all data)
bun run dev:docker:reset
```

## Project Structure

```plaintext
lobehub/
├── apps/desktop/           # Electron desktop app
├── packages/               # Shared packages (@lobechat/*)
│   ├── database/           # Database schemas, models, repositories (PostgreSQL + Drizzle)
│   ├── agent-runtime/      # Agent runtime
│   └── ...
├── src/
│   ├── app/                # Next.js App Router (backend API + auth)
│   │   ├── (backend)/     # API routes (trpc, webapi, etc.)
│   │   ├── spa/            # SPA HTML template service
│   │   └── [variants]/(auth)/  # Auth pages (SSR required)
│   ├── routes/             # SPA page components (Vite)
│   │   ├── (main)/         # Desktop pages
│   │   ├── (mobile)/       # Mobile pages
│   │   ├── (desktop)/      # Desktop-specific pages
│   │   ├── onboarding/     # Onboarding pages
│   │   └── share/          # Share pages
│   ├── spa/                # SPA entry points and router config
│   │   ├── entry.web.tsx   # Web entry
│   │   ├── entry.mobile.tsx
│   │   ├── entry.desktop.tsx
│   │   └── router/         # React Router configuration
│   ├── store/              # Zustand stores
│   ├── services/           # Client services
│   ├── server/             # Server services and routers
│   └── ...
└── e2e/                    # E2E tests (Cucumber + Playwright)
```

## SPA Routes and Features

SPA-related code is grouped under `src/spa/` (entries + router) and `src/routes/` (page segments). We use a **roots vs features** split: route trees only hold page segments; business logic and UI live in features.

- **`src/spa/`** – SPA entry points (`entry.web.tsx`, `entry.mobile.tsx`, `entry.desktop.tsx`) and React Router config (`router/`). Keeps router config next to entries to avoid confusion with `src/routes/`.

- **`src/routes/` (roots)**\
  Only page-segment files: `_layout/index.tsx`, `index.tsx` (or `page.tsx`), and dynamic segments like `[id]/index.tsx`. Keep these **thin**: they should only import from `@/features/*` and compose layout/page, with no business logic or heavy UI.

- **`src/features/`**\
  Business components by **domain** (e.g. `Pages`, `PageEditor`, `Home`). Put layout chunks (sidebar, header, body), hooks, and domain-specific UI here. Each feature exposes an `index.ts` (or `index.tsx`) with clear exports.

When adding or changing SPA routes:

1. In `src/routes/`, add only the route segment files (layout + page) that delegate to features.
2. Implement layout and page content under `src/features/<Domain>/` and export from there.
3. In route files, use `import { X } from '@/features/<Domain>'` (or `import Y from '@/features/<Domain>/...'`). Do not add new `features/` folders inside `src/routes/`.

See the **spa-routes** skill (`.agents/skills/spa-routes/SKILL.md`) for the full convention and file-division rules.

## Development

### Environment Variables

本项目有两类 `.env` 文件，用途不同，请勿混淆：

| 文件                                         | 用途                                                      |
| -------------------------------------------- | --------------------------------------------------------- |
| `.env`                                       | **Web 端**（Next.js 服务端 + SPA 前端）使用的所有环境变量 |
| `.env.desktop.test` / `.env.desktop.prod` 等 | **桌面端**（Electron 主进程 + 渲染进程）使用的环境变量    |

桌面端 `.env.desktop.*` 文件由 `apps/desktop/` 下的 Electron 应用加载，不会参与 Web 端构建；修改 Web 配置时请勿编辑桌面端文件，反之亦然。

### Starting the Dev Environment

```bash
# SPA dev mode (frontend only, proxies API to localhost:3010)
bun run dev:spa

# Full-stack dev (Next.js + Vite SPA concurrently)
bun run dev
```

After `dev:spa` starts, the terminal prints a **Debug Proxy** URL:

```plaintext
Debug Proxy: https://calcifer.train.ctripcorp.com/_dangerous_local_dev_proxy?debug-host=http%3A%2F%2Flocalhost%3A9876
```

Open this URL to develop locally against the production backend (calcifer.train.ctripcorp.com). The proxy page loads your local Vite dev server's SPA into the online environment, enabling HMR with real server config.

### Build Commands

```bash
# Full build (SPA + Next.js)
bun run build

# Build SPA only
bun run build:spa

# Build Next.js only
bun run build:next

# Build for Captain (internal deployment)
bun run build:captain

# Build for Docker
bun run build:docker

# Analyze bundle size
bun run build:analyze
```

### Linting and Type Checking

```bash
# Full lint (TypeScript + styles + type check + circular deps)
bun run lint

# TypeScript lint only
bun run lint:ts

# Style lint only
bun run lint:style

# Type check (uses tsgo for speed)
bun run type-check

# Check for circular dependencies
bun run lint:circular

# Find unused exports
bun run lint:unused
```

> \[!IMPORTANT]
> **禁止每改完文件就跑 `bun run type-check`（全量 tsgo，拖卡机器）。** 改动文件后只看 Edit/Write 自带的 `<new-diagnostics>`；需要主动验证就用 LSP 对单文件诊断，或最多跑改动所在 package 的 tsconfig。全量 `bun run type-check` 仅在大范围改动收尾时跑一次。

### Git Workflow

- **Branch strategy**: `canary` is the development branch (cloud production); `main` is the release branch (periodically cherry-picks from canary)
- New branches should be created from `canary`; PRs should target `canary`
- Use rebase for `git pull`
- Commit messages: prefix with gitmoji
- Branch format: `<type>/<feature-name>`

### Package Management

- `pnpm` for dependency management
- `bun` to run npm scripts
- `bunx` for executable npm packages

### Testing

```bash
# Run specific test (NEVER run `bun run test` - takes ~10 minutes)
bunx vitest run --silent='passed-only' '[file-path]'

# Database package
cd packages/database && bunx vitest run --silent='passed-only' '[file]'
```

- Prefer `vi.spyOn` over `vi.mock`
- Tests must pass type check: `bun run type-check`
- After 2 failed fix attempts, stop and ask for help

### i18n

- Add keys to `src/locales/default/namespace.ts`
- For dev preview: translate `locales/zh-CN/` and `locales/en-US/`
- Don't run `pnpm i18n` - CI handles it

## Skills (Auto-loaded by Claude)

Claude Code automatically loads relevant skills from `.agents/skills/`.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **calcifer-chathub** (64997 symbols, 134181 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource                                          | Use for                                  |
| ------------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/calcifer-chathub/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/calcifer-chathub/clusters`       | All functional areas                     |
| `gitnexus://repo/calcifer-chathub/processes`      | All execution flows                      |
| `gitnexus://repo/calcifer-chathub/process/{name}` | Step-by-step execution trace             |

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
