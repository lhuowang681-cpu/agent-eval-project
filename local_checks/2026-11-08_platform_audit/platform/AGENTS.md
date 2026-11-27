# LobeYoYo Development Guidelines

This document serves as a comprehensive guide for all team members when developing LobeYoYo.

## Project Description

You are developing an open-source, modern-design AI Agent Workspace: LobeYoYo (previously TripYoYo).

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript
- **UI Components**: Ant Design, @lobehub/ui, antd-style
- **State Management**: Zustand, SWR
- **Database**: PostgreSQL, PGLite, Drizzle ORM
- **Testing**: Vitest, Testing Library
- **Package Manager**: pnpm (monorepo structure)

## Directory Structure

```plaintext
lobehub/
├── apps/desktop/           # Electron desktop app
├── packages/               # Shared packages (@lobechat/*)
│   ├── database/           # Database schemas, models, repositories
│   ├── agent-runtime/      # Agent runtime
│   └── ...
├── src/
│   ├── app/                # Next.js app router
│   ├── spa/                # SPA entry points (entry.*.tsx) and router config
│   ├── routes/             # SPA page components (roots)
│   ├── features/           # Business components by domain
│   ├── store/              # Zustand stores
│   ├── services/           # Client services
│   ├── server/             # Server services and routers
│   └── ...
├── .agents/skills/         # AI development skills
└── e2e/                    # E2E tests (Cucumber + Playwright)
```

## Development Workflow

### Git Workflow

- **Branch strategy**: `canary` is the development branch (cloud production); `main` is the release branch (periodically cherry-picks from canary)
- New branches should be created from `canary`; PRs should target `canary`
- Use rebase for git pull
- Git commit messages should prefix with gitmoji
- Git branch name format: `feat/feature-name`
- Use `.github/PULL_REQUEST_TEMPLATE.md` for PR descriptions

### Package Management

- Use `pnpm` as the primary package manager
- Use `bun` to run npm scripts
- Use `bunx` to run executable npm packages

### Code Style Guidelines

#### TypeScript

- Prefer interfaces over types for object shapes

### Testing Strategy

```bash
# Web tests
bunx vitest run --silent='passed-only' '[file-path-pattern]'

# Package tests (e.g., database)
cd packages/[package-name] && bunx vitest run --silent='passed-only' '[file-path-pattern]'
```

**Important Notes**:

- Wrap file paths in single quotes to avoid shell expansion
- Never run `bun run test` - this runs all tests and takes \~10 minutes

### Type Checking

- Use `bun run type-check` to check for type errors

### i18n

- **Keys**: Add to `src/locales/default/namespace.ts`
- **Dev**: Translate `locales/zh-CN/namespace.json` locale file only for preview
- DON'T run `pnpm i18n`, let CI auto handle it

## SPA Routes and Features

- **`src/routes/`** holds only page segments (`_layout/index.tsx`, `index.tsx`, `[id]/index.tsx`). Keep route files **thin** — import from `@/features/*` and compose, no business logic.
- **`src/features/`** holds business components by **domain** (e.g. `Pages`, `PageEditor`, `Home`). Layout pieces, hooks, and domain UI go here.
- See the **spa-routes** skill for the full convention and file-division rules.

## Skills (Auto-loaded)

All AI development skills are available in `.agents/skills/` directory and auto-loaded by Claude Code when relevant.

**IMPORTANT**: When reviewing PRs or code diffs, ALWAYS read `.agents/skills/code-review/SKILL.md` first.

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
