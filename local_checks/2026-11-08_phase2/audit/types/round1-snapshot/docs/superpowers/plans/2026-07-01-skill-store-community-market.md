# Skill Store Community Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adapt the server-side `lobe-skill-store` builtin tool to the project's self-hosted community market.

**Architecture:** Keep the builtin tool package API unchanged. Replace the server runtime service's market SDK search/install paths with a `CommunityService` dependency that maps official Skill Store params into the local market model.

**Tech Stack:** TypeScript, Vitest, TRPC service layer, Drizzle-backed `CommunityService`.

---

### Task 1: Test Server Runtime Community Market Behavior

**Files:**

- Create: `src/server/services/toolExecution/serverRuntimes/__tests__/skillStore.test.ts`

- Modify: `src/server/services/toolExecution/serverRuntimes/skillStore.ts`

- [ ] **Step 1: Write failing tests**

Create tests that instantiate the service with mocked `communityService`, `importer`, and `marketService`. Assert `searchSkill` maps `q` to `keyword`, maps unsupported sorts to `recommended`, and returns the runtime response shape. Assert `importFromMarket` calls `communityService.installSkill`.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
bunx vitest run --silent='passed-only' 'src/server/services/toolExecution/serverRuntimes/__tests__/skillStore.test.ts'
```

Expected: failure because `SkillStoreServerRuntimeService` is not exported or does not accept/use `communityService`.

### Task 2: Implement Community Market Runtime Adapter

**Files:**

- Modify: `src/server/services/toolExecution/serverRuntimes/skillStore.ts`

- [ ] **Step 1: Export the service class and add `communityService` dependency**

Add `CommunityService` to the factory and constructor. Keep `MarketService` only for direct URL/GitHub/zip import behavior if needed by existing code.

- [ ] **Step 2: Map search params**

Implement a small mapping helper inside `skillStore.ts`:

```ts
const mapSkillStoreSort = (sort?: SearchSkillParams['sort']) => {
  if (sort === 'installCount') return 'installCount';
  if (sort === 'updatedAt' || sort === 'createdAt') return 'updatedAt';
  return 'recommended';
};
```

Use it from `searchSkill`.

- [ ] **Step 3: Install from community market**

Change `importFromMarket` to call `communityService.installSkill(identifier)` and return `{ skill: { id, name }, status }`, where existing installs use `unchanged` when no created/updated status is available.

- [ ] **Step 4: Run focused tests**

Run the same Vitest command and fix failures.

### Task 3: Sync Official Refresh Hook

**Files:**

- Modify: `packages/builtin-tool-skill-store/src/ExecutionRuntime/index.ts`

- Modify: `packages/builtin-tool-skill-store/src/executor/index.ts`

- [ ] **Step 1: Add package tests if needed**

Add minimal tests for `notifyImported` and `onAfterCall` if package test execution is practical in this repo.

- [ ] **Step 2: Implement official refresh hook**

Add `notifyImported()` to runtime and executor `onAfterCall` for successful `importSkill` and `importFromMarket`.

- [ ] **Step 3: Run focused verification**

Run focused tests for server runtime and package runtime/executor.
