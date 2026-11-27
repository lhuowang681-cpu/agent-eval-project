---
name: changelog
description: '归档改动到 changelog 并同步到飞书。当用户说「归档 changelog / 写入 changelog / 记录到 changelog / 生成 changelog / changelog 归档」时触发。会：(1) 按现有格式在 docs/changelog/ 创建中英文 mdx 文件；(2) 用飞书 MCP 在 TripYoYo Changelog 知识库目录下新建文档并粘贴中文版本；(3) 在汇总文档追加结构化摘要。'
---

# Changelog 归档

当用户要求把当前改动归档到 changelog 时，按顺序执行下列步骤。任何一步失败都要停下来告诉用户，不要跳过继续。

## 关键常量

| 常量                    | 值                                                                       |
| ----------------------- | ------------------------------------------------------------------------ |
| **Wiki 节点 token**     | `HUrswmdhUiVqkUkbYIBcHWNhnhg`                                            |
| **本地 changelog 目录** | `docs/changelog/`                                                        |
| **文件名格式**          | `YYYY-MM-DD-<slug>.mdx`（英文）<br>`YYYY-MM-DD-<slug>.zh-CN.mdx`（中文） |

**Wiki 节点的双重角色**：这个 token 既是「TripYoYo Changelog」知识库的**目录父节点**（Step 3 `wiki_node`），又是**汇总文档本身**（Step 4 `doc_id`）。

## 工具调用速查表

| Step             | 工具                          | 关键参数                                                    |
| ---------------- | ----------------------------- | ----------------------------------------------------------- |
| 1 收集改动       | `Bash`                        | `git log` / `git diff`                                      |
| 2 本地归档       | `Write`                       | 创建 `docs/changelog/YYYY-MM-DD-<slug>.mdx` 及 `.zh-CN.mdx` |
| 3 飞书新建子文档 | `mcp__feishu-mcp__create-doc` | `title` + `markdown` + `wiki_node`                          |
| 4 幂等检查       | `mcp__feishu-mcp__fetch-doc`  | `doc_id` = Wiki 节点 token                                  |
| 5 追加摘要       | `mcp__feishu-mcp__update-doc` | `doc_id` + `mode: append` + `markdown`                      |

## Step 1：收集与分类改动

**不使用飞书工具，纯本地操作。**

### 1.1 确定 commit 范围

按优先级尝试，第一个成功就用：

1. 用户明确指定（如「从 v1.2.0 开始」→ `git log v1.2.0..HEAD`）
2. 取最近一次涉及 changelog 的 commit：
   ```bash
   git log -1 --format=%H -- docs/changelog/
   ```
   若返回 commit hash，用 `git log <hash>..HEAD`
3. 兜底：`git diff main..HEAD`（按项目主分支调整，如 `canary`）

### 1.2 分类

每条改动归到 4 类之一：

| 类别   | 判定标准                               |
| ------ | -------------------------------------- |
| 新特性 | 引入新能力、新工具、新 API、新功能页面 |
| 修复   | 修正错误行为、修复崩溃、修 bug         |
| 优化   | 改进现有体验（提示词、性能、UX、措辞） |
| 其他   | 重构、清理、文档、依赖升级             |

### 1.3 取 slug 和 emoji

- **slug**：kebab-case 英文（如 `task-tools-routing-and-executor-fix`）
- **emoji**：与主题最贴切的一个（🐛 修复 / ✨ 新特性 / 🧹 清理 / 🌟 优化）
- **向用户确认**分类、slug、emoji（用户说「直接归档」可跳过）

## Step 2：本地归档

**使用 `Write` 工具。**

在 `docs/changelog/` 下创建两个文件（英文 + 中文），**严格遵守以下 mdx 格式规范**。

### 2.1 幂等检查（先做再写）

```bash
ls docs/changelog/$(date +%Y-%m-%d)- < slug > .* 2> /dev/null
```

若已存在 → 提示用户而不是覆盖，询问是否要换 slug。

### 2.2 mdx 格式规范

#### Frontmatter（YAML，必填三个字段）

```yaml
---
title: "English Title \U0001F4C1"
description: >-
  English 1-2 sentence summary of this release.
tags:
  - Tag1
  - Tag2
---
```

| 字段          | 规则                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`       | 英文标题 + **一个** emoji。emoji 必须用 YAML unicode escape（如 📁 → `\U0001F4C1`、🛠️ → `\U0001F6E0️`、🔌 → `\U0001F50C`），不要用字面 emoji |
| `description` | 英文 1-2 句话，面向用户，**不讲实现细节**。用 `>-` folded scalar 让长文本自动折行                                                           |
| `tags`        | 2-6 个英文标签，首字母大写（如 `Cloud Sandbox` / `Task Tools` / `Bug Fix`）                                                                 |

#### 正文结构

```markdown
# English Title <emoji> ← H1 必须与 frontmatter title 一致（emoji 用字面即可）

<1-2 句简介，概述本次发布>

## 🌟 Key Updates ← 必有章节

- 📄 **Feature A**: 一句话描述
- 📊 **Feature B**: 一句话描述

## 🐛 Bug Fixes ← 有修复时加

- 🔧 **Fix description**: ...

## 💫 Experience Improvements ← 有体验优化时加

<1-2 句概述即可，不列 bullet 也可>

## 💡 Tips ← 有使用建议时加

- 建议 1
- 建议 2
```

#### 章节标题固定 emoji（不要换）

| 章节                    | 固定 emoji | 是否必填     |
| ----------------------- | ---------- | ------------ |
| Key Updates             | 🌟         | ✅ 必有      |
| Bug Fixes               | 🐛         | 有修复时     |
| Experience Improvements | 💫         | 有体验优化时 |
| Tips                    | 💡         | 有使用建议时 |

#### Bullet 风格

- 每条 bullet 必须以一个**与内容相关**的 emoji 开头（📄 📊 📑 📈 🔧 🧭 🧹 🔌 🤖 ⏱️ 🔄 等）
- 关键特性名用 `**bold**` 标出
- 内容**面向用户**，描述用户能感知到的变化，不讲实现细节
- 中文版本结构与英文版一一对应，语义相同

### 2.3 最小完整示例（英文）

```markdown
---
title: "Task Tools Routing and Executor Fix \U0001F6E0️"
description: >-
  Fixes lobe-task tool calls stuck in loading, improves routing between
  lobe-task and lobe-gtd so scheduled requests land on the right tool.
tags:
  - Task Tools
  - Bug Fix
---

# Task Tools Routing and Executor Fix 🛠️

This release fixes a long-standing issue where `lobe-task` tool calls would hang forever, and sharpens the routing between `lobe-task` and `lobe-gtd`.

## 🐛 Bug Fixes

- 🔧 **`lobe-task` tool calls no longer hang**: the executor was implemented but never registered in the frontend executor registry.

## 🌟 Key Updates

- 🧭 **Clearer routing between `lobe-task` and `lobe-gtd`**: meta descriptions and system prompts now route "定时/cron/periodic" requests to `lobe-task`.
```

### 2.4 中文版规则

- frontmatter 的 `title` / `description` / `tags` 仍用**英文**（保持与英文版一致）
- 正文用中文撰写，章节标题对应翻译：
  - `## 🌟 Key Updates` → `## 🌟 重要更新`
  - `## 🐛 Bug Fixes` → `## 🐛 问题修复`
  - `## 💫 Experience Improvements` → `## 💫 体验优化`
  - `## 💡 Tips` → `## 💡 使用建议`
- 章节标题的 emoji **必须与英文版一致**（不要换）

## Step 3：飞书新建子文档

**使用 `mcp__feishu-mcp__create-doc`。**

```json
{
  "markdown": "<中文 changelog 的 markdown 内容>",
  "title": "YYYY-MM-DD <中文标题>",
  "wiki_node": "HUrswmdhUiVqkUkbYIBcHWNhnhg"
}
```

**mdx → markdown 转换规则**：

- 删除 frontmatter（`---` 之间的那段）
- 保留 emoji 标题、代码块、表格、列表
- 飞书扩展语法（`<callout>`、`<grid>` 等）可直接使用，不必降级

**成功返回**：响应里会带 `doc_id` 和 `doc_url`。**记下 `doc_url`，Step 6 报告时要用**。

**超时处理**：若返回 `task_id` 而非 `doc_id`，用同一工具再次调用，仅传 `task_id` 查询任务状态，直到拿到 `doc_id`。

## Step 4：汇总文档幂等检查

**使用 `mcp__feishu-mcp__fetch-doc`。**

```json
{
  "doc_id": "HUrswmdhUiVqkUkbYIBcHWNhnhg"
}
```

在返回的 markdown 中搜索 `# YYYY-MM-DD`（今天日期）：

- **已存在** → 提示用户「今天已追加过摘要」，询问是否要覆盖 / 跳过 / 强制追加
- **不存在** → 进入 Step 5

## Step 5：追加结构化摘要

**使用 `mcp__feishu-mcp__update-doc`。**

```json
{
  "doc_id": "HUrswmdhUiVqkUkbYIBcHWNhnhg",
  "markdown": "<摘要内容>",
  "mode": "append"
}
```

**摘要格式**（空章节整段省略，不要出现空标题）：

```markdown
# YYYY-MM-DD

## 新特性

- <一句话>
- <一句话>

## 修复

- <一句话>

## 优化

- <一句话>

## 其他

- <一句话>
```

**摘要条目要求**：

- 每条以 `- ` 开头，一句话讲清楚做了什么，避免代码细节
- 与 Step 2 中文 changelog 要点保持一致，但更简洁
- 章节顺序固定：新特性 → 修复 → 优化 → 其他
- 没有条目的章节**整段省略**（连 `## 章节标题` 都不要）

## Step 6：完成报告

全部步骤完成后，向用户报告：

1. ✅ 本地 changelog 文件路径（2 个）
2. 🔗 飞书新文档链接（Step 3 返回的 `doc_url`）
3. 🔗 汇总文档链接：`https://trip.larkenterprise.com/wiki/HUrswmdhUiVqkUkbYIBcHWNhnhg`（确认摘要已追加）

如任何一步失败，明确告知失败原因和建议的补救步骤，不要假装完成。

## Step 7：询问是否提交本地改动

完成报告后，询问用户：

> 是否需要把新创建的 changelog 文件 commit & push？

- 用户同意 → 按常规流程提交（gitmoji 前缀 📝，commit message 写明 changelog 主题）
- 用户拒绝 → 流程结束

## 失败处理

| 失败场景                        | 处理                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| 飞书 MCP 未安装 / OAuth 失败    | 只完成 Step 1-2，告诉用户本地已归档、飞书同步失败请手动处理 |
| `create-doc` 超时返回 `task_id` | 用同一工具再次调用，仅传 `task_id` 查询任务状态             |
| `update-doc` 报定位错误         | `fetch-doc` 重新拉取文档，检查结构后重试                    |
| 同日同 slug 本地文件已存在      | 提示用户，询问换 slug 还是覆盖                              |
| 汇总文档已含当天摘要            | 提示用户，询问覆盖 / 跳过 / 强制追加                        |

## 注意事项

- **时区**：日期以 `YYYY-MM-DD` 形式取本机当前日期
- **顺序**：Step 1-2（本地同步） → Step 3-5（飞书 MCP 串行） → Step 6-7（报告与提交）
- **不要跳步**：本地没写完不要先去飞书创建文档，否则会出现飞书文档与本地不一致的情况
