# 设计文档：强制使用 auto 技能激活模式

**日期**：2026-05-11\
**状态**：已批准

## 背景

对话界面底部的技能面板（Tools Popover）头部区域有一个 `SkillActivateMode` 切换器，允许用户在 `auto`（AI 自主激活）和 `manual`（仅用户勾选）两种模式间切换。

需求：隐藏此切换入口，在运行时强制使用 `auto` 模式，不允许用户修改；保留 `manual` 逻辑以便回退。

## 方案选择

采用**方案 B：在 selector 层强制返回 `auto`**。

理由：`getSkillActivateModeById` 是两处运行时调用（`streamingExecutor.ts`、`aiAgent/index.ts`）的唯一读取出口，在此单点覆盖可同时影响所有消费方，无需散改多处。

## 改动范围

### 1. `src/store/agent/selectors/chatConfigByIdSelectors.ts`

将 `getSkillActivateModeById` 强制返回 `'auto'`，将原有读取逻辑保留为注释：

```ts
// FORCE: skill activate mode is locked to 'auto' — toggle UI is hidden.
// To revert: remove the forced return and uncomment the original line below.
// Original: getChatConfigById(agentId)(s).skillActivateMode ?? 'auto'
const getSkillActivateModeById =
  (agentId: string) =>
  (_s: AgentStoreState): 'auto' | 'manual' =>
    'auto';
```

### 2. `src/features/ChatInput/ActionBar/Tools/PopoverContent.tsx`

- 移除第 82 行的 `<SkillActivateMode />` 渲染
- 移除顶部对应的 `import SkillActivateMode` 语句
- 组件文件 `SkillActivateMode.tsx` 本身**不删除**，保留用于回退

## 保留内容（不改动）

| 文件                     | 说明                                              |
| ------------------------ | ------------------------------------------------- |
| `SkillActivateMode.tsx`  | 组件保留，仅从渲染树移除                          |
| `streamingExecutor.ts`   | `isManualMode` 读取逻辑不变，受 selector 覆盖影响 |
| `aiAgent/index.ts`       | 同上                                              |
| `chatConfig.ts` 类型定义 | `skillActivateMode` 字段保留                      |
| `locales/` 翻译文件      | 不改动                                            |

## 回退步骤

1. 恢复 `getSkillActivateModeById` 原有逻辑（取消注释，删除强制返回）
2. 恢复 `PopoverContent.tsx` 中的 `import` 和 `<SkillActivateMode />` 渲染

共 2 处改动，可快速回退。

## 影响范围

- **UI**：技能面板 header 右侧切换器消失
- **运行时**：`isManualMode` 始终为 `false`，`skipDefaultTools` 不再因 manual 模式而跳过默认工具
- **存储**：`skillActivateMode` 字段继续存在于 agent chatConfig，但读取时被覆盖
- **测试**：无需新增测试；现有逻辑路径（auto）未改变
