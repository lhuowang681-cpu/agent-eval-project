# MCP Ada Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual MCP Ada token configuration, persistence, profile editing, onboarding prompts, and automatic HTTP MCP header injection.

**Architecture:** Persist the token on `users`, expose it through existing user state, and add one focused mutation for updates. Keep temporary behavior isolated in parser/header helper modules so the future company token API can replace the source with minimal changes.

**Tech Stack:** Next.js/React 19, Zustand, tRPC, Drizzle/PostgreSQL, Electron desktop controller, Vitest.

---

## File Structure

- `packages/database/src/schemas/user.ts`: add `mcpAdaToken` column.
- `packages/database/migrations/*_add_user_mcp_ada_token.sql`: generated migration with idempotent `ADD COLUMN IF NOT EXISTS`.
- `packages/types/src/user/preference.ts`: add `mcpAdaToken` to `LobeUser` and `UserInitializationState`.
- `packages/types/src/user/preference.test.ts` or focused util tests if existing type tests are not present: no runtime type test needed.
- `src/server/routers/lambda/user.ts`: return token from `getUserState`; add `updateMcpAdaToken` mutation.
- `packages/database/src/models/user.ts`: select/return `mcpAdaToken`.
- `src/services/user/index.ts`: add client method.
- `src/store/user/slices/common/action.ts`: add token to merged user state and action to update it.
- `src/store/user/slices/auth/selectors.ts`: add selector.
- `src/utils/mcpAdaToken.ts`: shared parser, placeholder, header name, market URL, instruction image URL, header injection helper.
- `src/utils/mcpAdaToken.test.ts`: parser and header injection tests.
- `src/features/McpAdaTokenConfig/*`: reusable modal/form component for web, desktop onboarding, profile.
- `src/routes/(main)/home/...` or global home layout: show web prompt once user state is loaded and token missing.
- Desktop onboarding route/config files: add dedicated post-login token page following existing onboarding route patterns.
- `src/routes/(main)/settings/profile/index.tsx` and `features/McpAdaTokenRow.tsx`: add profile row.
- `src/server/routers/tools/mcp.ts`: apply token helper to web HTTP MCP routes.
- `apps/desktop/src/main/controllers/McpCtr.ts`: apply token helper to desktop HTTP manifest creation when renderer sends saved token.
- Any renderer service calling desktop MCP HTTP APIs: pass saved token as fallback token.

## Tasks

### Task 1: Add persistence and user state

- [ ] Add `mcpAdaToken: text('mcp_ada_token')` to `packages/database/src/schemas/user.ts`.
- [ ] Update `packages/database/src/models/user.ts` `getUserState()` select and return object to include `mcpAdaToken`.
- [ ] Add `mcpAdaToken?: string | null` to `LobeUser` and `UserInitializationState` in `packages/types/src/user/preference.ts`.
- [ ] Update `src/server/routers/lambda/user.ts` to include `mcpAdaToken` in `getUserState()` response.
- [ ] Add `updateMcpAdaToken` mutation with `z.string().trim().min(1).nullable()` semantics; empty strings should save `null`.
- [ ] Add `updateMcpAdaToken` to `src/services/user/index.ts`.
- [ ] Add Zustand action and selector wiring so saved token appears under `user.mcpAdaToken`.

### Task 2: Generate database migration

- [ ] Run `bun run db:generate`.
- [ ] Rename the generated SQL file to a meaningful name containing `add_user_mcp_ada_token`.
- [ ] Edit the generated SQL to use `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "mcp_ada_token" text;`.
- [ ] Run `bun run db:generate:client`.

### Task 3: Add token parser and header helper

- [ ] Create `src/utils/mcpAdaToken.ts` with constants for header name, market URL, image URL, instruction text, placeholder JSON, `parseMcpAdaTokenInput`, `hasBbzaiMcpTokenHeader`, and `withBbzaiMcpTokenHeader`.
- [ ] Add tests in `src/utils/mcpAdaToken.test.ts` for raw token, copied JSON, empty input, malformed JSON, missing header, preserving explicit header, and filling missing/empty header.
- [ ] Run `bunx vitest run --silent='passed-only' 'src/utils/mcpAdaToken.test.ts'`.

### Task 4: Wire MCP header injection

- [ ] Update `src/server/routers/tools/mcp.ts` so each HTTP MCP route resolves the saved token for the current user and calls `withBbzaiMcpTokenHeader` before `mcpService`.
- [ ] For `getStreamableMcpServerManifest`, fill the `headers` argument before passing it to `mcpService.getStreamableMcpServerManifest`.
- [ ] For `listTools`, `listResources`, `listPrompts`, and `callTool`, fill `input`/`input.params` when `type === 'http'`.
- [ ] Update desktop HTTP MCP manifest/call flow so renderer passes saved token to `getStreamableMcpServerManifest`; apply the same helper in `apps/desktop/src/main/controllers/McpCtr.ts`.

### Task 5: Build reusable token configuration UI

- [ ] Create a reusable React component that renders instructions, external link, image, textarea placeholder JSON, validation, and save button.
- [ ] The component should parse pasted content via `parseMcpAdaTokenInput`, call the provided save callback with the token, and show a concise validation message on parse failure.
- [ ] Avoid logging the token.

### Task 6: Add web home prompt

- [ ] Locate the web home layout/component and mount the prompt only when not desktop, logged in, user state loaded, and `mcpAdaToken` is missing.
- [ ] Save via the new Zustand action and close the modal after successful save.

### Task 7: Add desktop onboarding page

- [ ] Locate the post-login onboarding route/config.
- [ ] Add one dedicated MCP Ada token step/page using the reusable configuration UI.
- [ ] If `mcpAdaToken` already exists, display configured state and allow continuing.

### Task 8: Add profile row

- [ ] Add `src/routes/(main)/settings/profile/features/McpAdaTokenRow.tsx`.
- [ ] Render it in `/settings/profile` for logged-in users.
- [ ] Use masked display by default with an edit affordance; edit mode uses the reusable parser and placeholder.

### Task 9: Verify

- [ ] Run targeted tests for the new utility and any updated user service/store tests.
- [ ] Run MCP store tests if header plumbing touches existing tested paths.
- [ ] Run `bun run type-check` if time allows; otherwise report why it was skipped.
