# Force Auto Skill Activate Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在运行时强制使用 `auto` 技能激活模式，隐藏 UI 切换入口，不允许用户修改，保留 `manual` 逻辑以便回退。

**Architecture:** 在 `getSkillActivateModeById` selector 层直接返回 `'auto'`，使两处运行时调用点（`streamingExecutor.ts`、`aiAgent/index.ts`）的 `isManualMode` 始终为 `false`；同时从 `PopoverContent.tsx` 移除 `<SkillActivateMode />` 渲染，UI 切换器消失。组件文件和 `manual` 分支逻辑均保留，便于回退。

**Tech Stack:** TypeScript, React, Zustand (agent store selectors), Vitest

---

## File Map

| 操作             | 文件                                                           | 说明                                   |
| ---------------- | -------------------------------------------------------------- | -------------------------------------- |
| Modify           | `src/store/agent/selectors/chatConfigByIdSelectors.ts`         | 强制返回 `'auto'`                      |
| Modify (test)    | `src/store/agent/selectors/chatConfigByIdSelectors.test.ts`    | 新增 selector 行为测试                 |
| Modify           | `src/features/ChatInput/ActionBar/Tools/PopoverContent.tsx`    | 移除 `<SkillActivateMode />` 及 import |
| Keep (no change) | `src/features/ChatInput/ActionBar/Tools/SkillActivateMode.tsx` | 组件保留，用于回退                     |

---

### Task 1: 为 getSkillActivateModeById 写失败测试

**Files:**

- Test: `src/store/agent/selectors/chatConfigByIdSelectors.test.ts`

- [ ] **Step 1: 在测试文件中添加 `getSkillActivateModeById` 的 describe 块**

打开 `src/store/agent/selectors/chatConfigByIdSelectors.test.ts`，在最后一个 `describe` 块之后追加以下内容：

```ts
describe('getSkillActivateModeById', () => {
  it('should always return "auto" regardless of stored value', () => {
    const stateWithManual = createState({
      agentMap: {
        'agent-1': { chatConfig: { skillActivateMode: 'manual' } },
      },
    });
    expect(chatConfigByIdSelectors.getSkillActivateModeById('agent-1')(stateWithManual)).toBe(
      'auto',
    );
  });

  it('should return "auto" when skillActivateMode is not set', () => {
    const stateWithUndefined = createState({
      agentMap: {
        'agent-1': { chatConfig: {} },
      },
    });
    expect(chatConfigByIdSelectors.getSkillActivateModeById('agent-1')(stateWithUndefined)).toBe(
      'auto',
    );
  });
});
```

- [ ] **Step 2: 运行测试，确认失败（第一个 case 期望失败，因为当前实现会返回 `'manual'`）**

```bash
bunx vitest run --silent='passed-only' 'src/store/agent/selectors/chatConfigByIdSelectors.test.ts'
```

预期：第一个新测试 `should always return "auto" regardless of stored value` **FAIL**，报告收到 `'manual'` 但期望 `'auto'`。第二个新测试 PASS（因当前实现默认也返回 `'auto'`）。

---

### Task 2: 修改 selector 强制返回 `auto`

**Files:**

- Modify: `src/store/agent/selectors/chatConfigByIdSelectors.ts:74-77`

- [ ] **Step 1: 替换 `getSkillActivateModeById` 实现**

将以下原有代码（第 74-77 行）：

```ts
const getSkillActivateModeById =
  (agentId: string) =>
  (s: AgentStoreState): 'auto' | 'manual' =>
    getChatConfigById(agentId)(s).skillActivateMode ?? 'auto';
```

替换为：

```ts
// FORCE: skill activate mode is locked to 'auto' — toggle UI is hidden.
// To revert: remove the forced return and restore the original line below.
// Original: getChatConfigById(agentId)(s).skillActivateMode ?? 'auto'
const getSkillActivateModeById =
  (agentId: string) =>
  (_s: AgentStoreState): 'auto' | 'manual' =>
    'auto';
```

注意：参数 `s` 改为 `_s`（不再使用，避免 lint 报 unused variable）。

- [ ] **Step 2: 运行测试，确认全部通过**

```bash
bunx vitest run --silent='passed-only' 'src/store/agent/selectors/chatConfigByIdSelectors.test.ts'
```

预期：所有测试 **PASS**，无 FAIL。

- [ ] **Step 3: 类型检查**

```bash
bun run type-check 2>&1 | grep -E 'chatConfigByIdSelectors|getSkillActivateMode' | head -20
```

预期：无与上述文件相关的类型错误输出。

- [ ] **Step 4: 提交**

```bash
git add src/store/agent/selectors/chatConfigByIdSelectors.ts \
  src/store/agent/selectors/chatConfigByIdSelectors.test.ts
git commit -m "feat: 强制 skillActivateMode selector 返回 auto，锁定自主激活模式"
```

---

### Task 3: 从 PopoverContent 移除切换器 UI

**Files:**

- Modify: `src/features/ChatInput/ActionBar/Tools/PopoverContent.tsx:9,82`

- [ ] **Step 1: 移除 import 语句**

将第 9 行：

```ts
import SkillActivateMode from './SkillActivateMode';
```

整行删除。

- [ ] **Step 2: 移除 JSX 渲染**

将第 82 行（删除 import 后行号偏移为第 81 行）：

```tsx
<SkillActivateMode />
```

整行删除。

删除后，`<Flexbox horizontal align="center" className={styles.header} gap={4}>` 内部只剩下 `<SearchBar ... />` 一个子元素，结构正常。

- [ ] **Step 3: 类型检查**

```bash
bun run type-check 2>&1 | grep -E 'PopoverContent|SkillActivateMode' | head -20
```

预期：无相关类型错误。

- [ ] **Step 4: 提交**

```bash
git add src/features/ChatInput/ActionBar/Tools/PopoverContent.tsx
git commit -m "feat: 隐藏技能激活模式切换入口，UI 统一为自主激活"
```

---

## 回退说明

如需恢复用户可切换行为：

1. **`chatConfigByIdSelectors.ts`**：删除强制返回行，将 `_agentId` 改回 `agentId`、`_s` 改回 `s`，取消注释原有实现：

   ```ts
   const getSkillActivateModeById =
     (agentId: string) =>
     (s: AgentStoreState): 'auto' | 'manual' =>
       getChatConfigById(agentId)(s).skillActivateMode ?? 'auto';
   ```

2. **`streamingExecutor.ts`**（\~line 175）：删除 FORCE 注释块，恢复原始赋值：

   ```ts
   // When skillActivateMode is 'manual', skipDefaultTools gives user precise control
   const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';
   ```

3. **`aiAgent/index.ts`**（\~line 438）：同上，删除 FORCE 注释块，恢复原始赋值：

   ```ts
   // When skillActivateMode is 'manual', skip default tools to give user precise control
   const isManualMode = agentConfig.chatConfig?.skillActivateMode === 'manual';
   ```

4. **`PopoverContent.tsx`**：恢复 `import SkillActivateMode from './SkillActivateMode'` 及 `<SkillActivateMode />` 渲染。

5. 同步删除 Task 1 中新增的测试（或改为验证原有行为）。
