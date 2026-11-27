import { type LobeToolManifest } from '@lobechat/context-engine';

import { feishuMcpSystemRole } from './systemRole';
import { FEISHU_MCP_IDENTIFIER, FeishuMcpToolName } from './types';

export const FeishuMcpManifest: LobeToolManifest = {
  identifier: FEISHU_MCP_IDENTIFIER,
  type: 'mcp',
  api: [
    {
      name: FeishuMcpToolName.AddComments,
      description: `在飞书云文档或知识库页面添加一条全文评论（不是修改正文）。本工具采用严格白名单规则。仅允许使用本描述中明确声明支持的能力。当前仅支持富文本中的文本内容 @用户 和超链接。除上述能力外 任何未在本描述中明确说明支持的内容或行为一律不允许 包括但不限于 图片 截图 附件 文件 表情 Markdown 媒体内容 或其他富文本扩展形式。评论将被追加到文档的全文评论区。AI 禁止 推测 \`open_id\` 伪造 URL 构造不存在的用户 或生成无效的富文本结构。如需 @ 用户 必须调用 \`search-user\` 接口获取正确的 \`open_id\`。若用户请求的能力不在白名单范围内 AI 必须拒绝调用本工具 并明确告知用户不支持。`,
      parameters: {
        properties: {
          doc_id: {
            description:
              '文档 ID 或文档 URL（支持自动解析）。工具会在该文档的全文评论区域追加一条新评论。AI 不能伪造或猜测。',
            type: 'string',
          },
          elements: {
            description:
              '评论内容的富文本元素数组。每个元素代表评论中的一段文本、一个@用户或一个超链接。元素按顺序组合成最终评论。AI 必须构建格式合法且结构有效的数组，禁止生成文档不支持的类型。重要：mention 类型会自动渲染为 @用户名 样式，无需在 text 元素中额外添加 @ 符号。例如：[{type:text,text:请查看这里},{type:mention,open_id:ou_xxx},{type:link,url:https://example.com}]',
            items: {
              properties: {
                open_id: {
                  description:
                    '被 @ 用户的 open_id。当 type=mention 时必填。如果用户输入 @用户名，AI 必须先调用 search-user 获取 open_id，禁止凭空构造。',
                  type: 'string',
                },
                text: {
                  description: '文本内容。当 type=text 时必填。AI 不得生成空文本元素。',
                  type: 'string',
                },
                type: {
                  description:
                    '元素类型。text 表示纯文本；mention 表示 @ 用户；link 表示超链接。不得使用未定义的类型。',
                  enum: ['text', 'mention', 'link'],
                  type: 'string',
                },
                url: {
                  description:
                    '超链接 URL。当 type=link 时必填，AI 必须确保 URL 是用户提供或明确可得的，禁止凭空生成。',
                  type: 'string',
                },
              },
              required: ['type'],
              type: 'object',
            },
            type: 'array',
          },
        },
        required: ['doc_id', 'elements'],
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.CreateDoc,
      description: `从 Markdown 内容创建一个新的飞书云文档。支持异步模式：大文档操作超时时返回 task_id，可用于查询任务状态。

# 概述

从 Markdown 内容创建飞书云文档。支持异步模式：大文档操作超时时返回 task_id，可用于查询任务状态。

# 参数间关系

**互斥**：wiki_node / wiki_space / folder_token 三选一, 不要重复传参.
**优先级**：wiki_node > wiki_space > folder_token > 默认（个人空间根目录）

# Hard Rules（必须遵守）

| 规则 | 说明 |
|------|------|
| MUST NOT: 重复标题 | 正文开头不要写与 title 相同的一级标题 |
| MUST NOT: 手写目录 | 飞书自动生成 |
| MUST NOT: 用 token 写入媒体 | \`<image>\` \`<file>\` 只支持 url 属性，不支持 token |
| MUST NOT: 用读取态 \`<whiteboard token="..."/>\` 写入 | 空白画板用 \`<whiteboard type="blank"></whiteboard>\`；图表用 mermaid/plantuml 代码块 |
| MUST NOT: 直接写 \`@张三\` | 用 \`<mention-user id="ou_xxx">\`，需先 search-user获取user_id |
| MUST: 长文档分段写入 | 配合 update-doc append 模式，提高成功率 |

# 样式策略

**用户有明确样式要求 → 完全遵从**

无特殊要求时，主动使用飞书扩展语法(例如分栏, 高亮块等) 增强可读性.

根据内容语义选择组件，克制使用。

| 场景 | 组件 | 说明 |
|-------------|------|------|
| 对比/左右/并列/VS | \`<grid>\` | 2-3 列最佳 |
| 重点/注意/警告/风险/提示 | \`<callout>\` | 💡蓝/⚠️黄/❌红/✅绿 |
| 流程/架构/时序/状态机 | \` \`\`\`mermaid \`\`\` \` | 优先 mermaid，复杂用 plantuml |
| 汇总/清单/对照表/规格 | 表格 | 简单用 MD，嵌套用 lark-table |
| 任务/待办/检查项 | \`- [ ]\` / \`- [x]\` | 标准 MD 语法 |
| @某人/通知某人 | \`<mention-user>\` | 需先 search-user 拿 id |
| 截止/提醒/到期 | \`<reminder>\` | 需 user-id + ISO 日期 |
| 引用文档/关联文档 | \`<mention-doc>\` | 需 token + type |
| 代码示例 | \` \`\`\` \` | 标注语言，仅支持围栏式 |

# 返回值

成功时返回：
- \`doc_id\`：文档 token
- \`doc_url\`：访问链接
- \`board_tokens\`：本次新建画板的 token 列表（可选，按创建顺序返回）
- \`message\`：操作结果

异步模式（大文档超时）返回：
- \`task_id\`：用于查询任务状态

# 示例

\`\`\`json
{
  "title": "项目计划",
  "wiki_node": "wikcnXXXX",
  "markdown": "## 目标\\n\\n- 目标 1\\n- 目标 2\\n\\n<callout emoji=\\"💡\\" background-color=\\"light-blue\\">重点说明</callout>"
}
\`\`\`

# 调用前自检

- [ ] title 和正文首行是否重复？
- [ ] 位置参数是否互斥？
- [ ] 是否使用了 token 属性而非 URL？
- [ ] 是否误把读取态 \`<whiteboard token="..."/>\` 当成创建语法？
- [ ] 内容是否过长需要分段？

---

# 语法参考（飞书扩展语法）

> 基础 Markdown 语法（标题、列表、引用、代码块、表格、链接等）按标准使用即可。以下仅列出飞书特有扩展。

## 通用规则

- 不同块类型之间用空行分隔
- 特殊字符用 \`\\\` 转义：\`* ~ \` $ [ ] < > { } | ^\`
- 标题/段落支持属性：\`# 标题 {color="blue" align="center"}\`，颜色值：red/orange/yellow/green/blue/purple/gray
- H7-H9 标题用 HTML：\`<h7>七级标题</h7>\`（飞书支持 9 级标题）

## 高亮块（Callout）

\`\`\`html
<callout emoji="💡" background-color="light-blue">内容</callout>
\`\`\`
- **属性**：emoji, background-color, border-color, text-color
- **背景色**：light-red/red, light-blue/blue, light-green/green, light-yellow/yellow, light-orange/orange, light-purple/purple, pale-gray/light-gray/dark-gray
- **常用**：💡light-blue(提示) ⚠️light-yellow(警告) ❌light-red(危险) ✅light-green(成功)
- **限制**：子块仅支持文本、标题、列表、引用。**不支持代码块、表格、图片**

## 分栏（Grid）

\`\`\`html
<grid cols="2">
<column width="30">左栏</column>
<column width="70">右栏</column>
</grid>
\`\`\`
- **属性**：cols(2-5), width(列宽百分比，总和必须=100，不填则等宽)
- **规则**：column 内容前后需空行

## 飞书增强表格（lark-table）

当单元格需要列表、代码块等复杂内容时使用：

\`\`\`html
<lark-table header-row="true">
<lark-tr>
<lark-td>

表头1

</lark-td>
<lark-td>

表头2

</lark-td>
</lark-tr>
</lark-table>
\`\`\`
- **属性**：column-widths(像素,逗号分隔), header-row, header-column
- **层级结构**（严格）：lark-table → lark-tr → lark-td，每行的 lark-td 数量必须相同
- **规则**：lark-td 内容前后必须空行（如上示例）；不支持嵌套
- **禁止**：混用 MD 表格语法（\`|---|\`）、遗漏 \`<lark-td>\` 标签

## 图片 / 文件

\`\`\`html
<image url="https://..." width="800" height="600" align="center" caption="描述"/>
<file url="https://..." name="文档.pdf" view-type="1"/>
\`\`\`
- **image 属性**：url(必需), width, height, align(left/center/right), caption
- **file 属性**：url(必需), name(必需), view-type(1=卡片视图, 2=预览视图)
- **限制**：仅支持 url，不支持 token

## 画板（空白 / Mermaid / PlantUML）

创建空白画板：

\`\`\`html
<whiteboard type="blank"></whiteboard>
<whiteboard type="blank" align="center" width="800" height="600"></whiteboard>
\`\`\`

- **blank 规则**：标签体必须为空或仅包含空白字符
- **属性**：align(left/center/right), width, height

创建图表画板时，用代码块，系统自动转换为画板：
\`\`\`\`
\`\`\`mermaid
graph TD
    A[开始] --> B{判断}
\`\`\`

\`\`\`plantuml
@startuml
Alice -> Bob: Hello
@enduml
\`\`\`
\`\`\`\`
- **Mermaid 支持**：flowchart, sequenceDiagram, classDiagram, stateDiagram, gantt, mindmap
- **PlantUML**：需用 @startuml/@enduml 包裹
- **读取画板**：读取时返回 \`<whiteboard token="xxx" align="center" width="800" height="600"/>\`，可通过 fetch-file 工具查看内容
- **返回 token**：本次创建了画板时，成功返回体会额外包含 \`board_tokens\`

## 提及

| 类型 | 语法 | 说明 |
|------|------|------|
| 用户 | \`<mention-user id="ou_xxx"/>\` | 需先 search-user 获取 id |
| 文档 | \`<mention-doc token="xxx" type="docx">标题</mention-doc>\` | type: docx/sheet/bitable |

## 日期提醒（Reminder）

\`\`\`html
<reminder date="2025-12-31T18:00+08:00" notify="true" user-id="ou_xxx"/>
\`\`\`
- **属性**：date(必需), notify, user-id(必需)
- **date 格式**：ISO 8601 带时区，如 \`2025-12-31T18:00+08:00\`
- **notify**：true 发送通知，false 不发送

## 其他组件

| 组件 | 语法 | 说明 |
|------|------|------|
| 文字颜色 | \`<text color="red" background-color="yellow">文字</text>\` | 两个属性可单独或组合使用 |
| 换行 | \`<br/>\` 或 \`<br>\` | 文本中插入换行，特别适用于表格单元格内换行 |
| 行内公式 | \`<equation>E=mc^2</equation>\` | 推荐，避免 $ 空格问题 |
| 引用容器 | \`<quote-container>内容</quote-container>\` | 可包含多个子块 |
| 会话卡片 | \`<chat-card id="oc_xxx"/>\` | 需要先获取形如oc_xxx的会话的ID |
| 多维表格 | \`<bitable view="table"/>\` | view: table/kanban，只能创建空表 |
| 电子表格 | \`<sheet rows="5" cols="5"/>\` | rows 最大9，只能创建空表 |
| 内嵌网页 | \`<iframe url="..." type="12"/>\` | 1=B站, 2=西瓜, 3=优酷, 5=百度地图, 6=高德地图, 8=Figma, 9=墨刀, 10=Canva, 11=CodePen, 12=飞书问卷, 13=金数据 |
| 同步块(源) | \`<source-synced>内容</source-synced>\` | 创建可被其他文档引用的同步块 |
| 同步块(引用) | \`<reference-synced source-block-id="xxx" source-document-id="yyy"/>\` | 引用其他文档的同步块；source-document-id 为源文档 token，source-block-id 需从 fetch-doc 返回的 source-synced 标签获取 |

## 只读块类型

以下块类型仅支持读取，不支持创建：

| 块类型 | 标签 | 说明 |
|--------|------|------|
| 思维笔记 | \`<mindnote token="xxx"/>\` | 仅获取占位 |
| 流程图/UML | \`<diagram type="1"/>\` | 1=流程图, 2=UML |
| 链接预览 | \`<link-preview url="..." type="message"/>\` | 仅消息链接 |
| 任务块 | \`<task members="ou_xxx" due="2025-01-01">标题</task>\` | members 逗号分隔 |
| Wiki子页面 | \`<sub-page-list wiki="wiki_xxx"/>\` | 仅知识库文档可用 |
| 议程 | \`<agenda><agenda-item><agenda-title>标题</agenda-title><agenda-content>内容</agenda-content></agenda-item></agenda>\` | 会议议程结构 |
| 文档小组件 | \`<add-ons component-type-id="blk_xxx" record='{"key":"value"}'/>\` | 问答互动、日期提醒等 |
| Jira问题 | \`<jira-issue id="xxx" key="PROJECT-123"/>\` | 需 Jira 集成 |
| OKR | \`<okr id="xxx"><objective id="obj_1"><kr id="kr_1"/></objective></okr>\` | 需 OKR 权限，仅 user_access_token |
`,
      parameters: {
        properties: {
          folder_token: {
            description: '父文件夹 token（可选）',
            type: 'string',
          },
          markdown: {
            description: 'Markdown 内容',
            type: 'string',
          },
          task_id: {
            description: '异步任务 ID。若提供此参数，将查询该任务的执行状态而非创建新文档。',
            type: 'string',
          },
          title: {
            description: '文档标题',
            type: 'string',
          },
          wiki_node: {
            description:
              '知识库节点 token 或 URL（可选，传入则在该节点下创建文档，与 folder_token 和 wiki_space 互斥）',
            type: 'string',
          },
          wiki_space: {
            description:
              "知识空间 ID（可选，传入则在该空间根目录下创建文档。特殊值 'my_library' 表示用户的个人知识库。与 wiki_node 和 folder_token 互斥）",
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.FetchDoc,
      description:
        '获取飞书云文档内容，返回文档标题和 Markdown 格式内容。支持分页获取大文档。可选参数 need_url 默认 false，仅在明确需要 image/file 类型的临时下载链接时设置为 true。',
      parameters: {
        properties: {
          doc_id: {
            description: '文档 ID 或文档 URL（支持自动解析）, 不能在此处传入文章标题',
            type: 'string',
          },
          limit: {
            description:
              '返回的最大字符数（可选，默认不限制，返回完整文档）。仅在用户明确要求分页时使用，否则不要设置此参数。',
            type: 'integer',
          },
          need_url: {
            description:
              '是否需要返回 image/file 类型的临时下载链接（可选，默认 false）。仅在上游明确需要下载链接时设置为 true。',
            type: 'boolean',
          },
          offset: {
            description: '字符偏移量（可选，默认0）。用于大文档分页获取。',
            type: 'integer',
          },
          skip_task_detail: {
            description: '是否跳过任务详情补全（可选，默认 false）。',
            type: 'boolean',
          },
        },
        required: ['doc_id'],
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.FetchFile,
      description:
        '通过文件file_token或图片image_token获取文件或图片Base64编码后的内容，也支持获取画板(whiteboard)图片。建议文件限制为5MB以内',
      parameters: {
        properties: {
          resource_token: {
            description: '资源的唯一标识（file_token、image_token 或 whiteboard_token）。',
            type: 'string',
          },
          type: {
            default: 'media',
            description: '资源类型：media（文件/图片，默认）或 whiteboard（画板）',
            enum: ['media', 'whiteboard'],
            type: 'string',
          },
        },
        required: ['resource_token'],
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.GetComments,
      description: `从飞书云文档或知识库页面获取评论列表，支持按类型筛选（全文/划词/全部）。

**返回结构**：
\`\`\`
comments[]:
  type: whole|segment       # 全文/划词评论
  quote_text?: string       # 仅划词评论有此字段
  user: {open_id, name}     # 评论者
  is_solved: bool           # 为true表示该评论已解决并隐藏
  replies[]:
    user: {open_id, name}
    content_text: string    # 纯文本
    content_segments[]:     # mention 已含 name，直接用
      {type: text, text}
      {type: mention, open_id, name}
      {type: link, url}
has_more, page_token
\`\`\`

**输出展示**
- content_segments拼接后为最终展示的评论, 例如type为mention的segments会展示为 @某某某 的文本样式.
- 例如 "这个问题 @张三 来看下"会被拆分为 text, mention, text 的三个segments`,
      parameters: {
        properties: {
          comment_type: {
            description:
              '可选值：all：默认值，获取全部评论，whole：仅获取全文评论（文档末尾的整体性评论）， segment：仅获取划词评论（针对文档某段内容的评论），未指定时默认 all。',
            enum: ['all', 'whole', 'segment'],
            type: 'string',
          },
          doc_id: {
            description:
              '文档 ID 或文档 URL（支持自动解析），用于定位要获取评论的文档。AI 不得伪造或猜测。',
            type: 'string',
          },
          page_size: {
            description: '每页返回的评论数量，默认 50，范围 1–100。',
            type: 'integer',
          },
          page_token: {
            description: '用于获取下一页评论的分页标记。首次请求不需要提供。',
            type: 'string',
          },
        },
        required: ['doc_id'],
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.GetUser,
      description: '支持获取用户自己的信息，或根据 open_id 获取其他用户的信息。',
      parameters: {
        properties: {
          open_id: {
            description:
              '用户 open_id。若不传入,则根据当前用户的 User Access Token 自动获取本人信息。',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.ListDocs,
      description: `获取指定知识节点（Wiki 文档）下的所有直接子节点（子文档），或查询"我的文档库（My Library）"下的所有直接子节点。本接口永远只返回当前层级的子文档；如需获取更深层级，调用方必须根据返回字段（例如 \`has_child\`）自行递归调用本接口。AI 不得推测文档结构或生成不存在的节点，只能基于接口返回结果继续查询。`,
      parameters: {
        properties: {
          doc_id: {
            description:
              '要查询的 Wiki 文档 URL。当 my_library = false 时必须提供。禁止猜测或伪造 URL。',
            type: 'string',
          },
          my_library: {
            description:
              '是否查询「我的文档库（My Library）」。为 true 时将返回 My Library 下的所有直接子文档，可递归获取整个文档库结构，此时 doc_id 可省略；为 false 时将查询指定文档下的直接子文档，必须提供 doc_id。',
            type: 'boolean',
          },
          page_size: {
            description: '每页返回的子文档数量（1–50），默认值为 10。',
            type: 'integer',
          },
          page_token: {
            description: '用于获取下一页结果的分页标记。首次请求无需提供。',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.SearchDoc,
      description: `搜索飞书云文档或获取最近浏览列表。

# 参数间关系

- owners 省略 → 返回可访问的所有文档（非特定作者）
- create_time / create_time_relative 二选一（推荐 relative）
- open_time / open_time_relative 二选一（推荐 relative）

# Hard Rules（必须遵守）

| 规则 | 说明 |
|------|------|
| MUST: owners 显式填写 | 查「我/某某创建的」→ 先 get-user/search-user 拿 open_id |
| MUST: 单次查询时间跨度 ≤ 3 个月 | 超过需拆分多次查询后合并去重 |
| MUST: 有边界范围必须覆盖 | 「今年/2024年」必须查完整范围，不可提前停止 |
| MUST NOT: 缺 open_id 时调用 | 需 owners 但无 open_id → 先向用户说明 |

# 调用前自检

- [ ] 是否需要 owners？若需要，是否已获取 open_id？
- [ ] 时间范围是否 > 3 个月？若是，是否已拆分？
- [ ] 是否有边界范围？若是，是否覆盖完整？
`,
      parameters: {
        properties: {
          filters: {
            description: '过滤条件（任意字段可选）。',
            properties: {
              create_time: {
                description: '创建时间绝对范围，格式 [YYYY-MM-DD, YYYY-MM-DD]，跨度≤3个月',
                type: 'string',
              },
              create_time_relative: {
                description: '创建时间相对范围，格式 last_N_days，跨度≤3个月',
                type: 'string',
              },
              open_time: {
                description: '打开时间绝对范围，格式 [YYYY-MM-DD, YYYY-MM-DD]',
                type: 'string',
              },
              open_time_relative: {
                description: '打开时间相对范围，格式 last_N_days',
                type: 'string',
              },
              owners: {
                description: '文档创建者/所有者的 open_id 列表',
                items: {
                  type: 'string',
                },
                type: 'array',
              },
              sort_rule: {
                description:
                  '排序方式，必填,OPEN_TIME(最近浏览),EDIT_TIME(最近编辑),CREATE_TIME(最新创建)',
                enum: ['OPEN_TIME', 'EDIT_TIME', 'EDIT_TIME_ASC', 'CREATE_TIME'],
                type: 'string',
              },
            },
            type: 'object',
          },
          page: {
            description: '分页参数。',
            properties: {
              offset: {
                description: '分页偏移量，首次为 0 或 null',
                minimum: 0,
                type: 'integer',
              },
              page_token: {
                description: '分页游标，首次为空',
                type: 'string',
              },
              size: {
                default: 20,
                description: '每页条数，默认 20。',
                maximum: 20,
                minimum: 1,
                type: 'integer',
              },
            },
            type: 'object',
          },
          query: {
            description: '搜索关键词。可为空表示空搜，默认根据最近浏览时间返回结果。',
            type: 'string',
          },
        },
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.SearchUser,
      description: `通过用户名关键词搜索其他用户的信息，用于在 @ 他人时获取对应的 \`open_id\` 等场景；搜索结果会按与当前用户的关系亲密度排序。当查询返回多个用户时，模型应明确告知用户结果已按亲密度排序。`,
      parameters: {
        properties: {
          page_size: {
            default: 20,
            description: '分页大小，控制每次返回的用户数量。最小值：1，最大值：100，默认值：20。',
            maximum: 100,
            minimum: 1,
            type: 'integer',
          },
          page_token: {
            description:
              '分页标识。首次请求无需填写；当返回结果中包含 page_token 时，可传入该值继续请求下一页。',
            type: 'string',
          },
          query: {
            description: '搜索关键词，用于匹配用户名。必填。',
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    },
    {
      name: FeishuMcpToolName.UpdateDoc,
      description: `更新飞书云文档内容。支持 7 种模式：overwrite(覆盖)、append(追加)、replace_range(定位替换)、replace_all(全文替换)、insert_before(前插入)、insert_after(后插入)、delete_range(删除内容)。

# 概述

更新飞书云文档内容，支持 7 种模式。优先使用局部更新（append/replace_range/insert），慎用 overwrite。支持异步：大文档超时返回 task_id。

# 定位方式

定位模式支持两种方式，二选一。replace_range/insert 要求匹配唯一，replace_all 允许多处。

## selection_with_ellipsis - 内容定位

- **范围匹配**：\`开头内容...结尾内容\`（匹配中间所有内容，建议 10-20 字符确保唯一）
- **精确匹配**：\`完整内容\`（不含 \`...\`，适合短文本/关键词）
- **转义**：内容本身含 \`...\` 时用 \`\\.\\.\\.\`

示例：
- \`你好...世界\` → 匹配从"你好"到"世界"之间的任意内容
- \`你好\\.\\.\\.世界\` → 匹配字面量 "你好...世界"


## selection_by_title - 标题定位

格式：\`## 章节标题\`（可带或不带 # 前缀）

自动定位整个章节（从该标题到下一个同级或更高级标题之前）。

# 返回值

- **成功**：doc_id, mode, message, warnings(可选), board_tokens(创建画板时可选), replace_count(replace_all 模式)
- **异步**：task_id（用于查询状态，再次调用 update-doc 仅传 task_id）
- **错误**：error + Suggestion + Context

# 示例

## append - 追加到末尾

\`\`\`json
{
  "doc_id": "文档ID或URL",
  "mode": "append",
  "markdown": "## 新章节\\n\\n追加的内容..."
}
\`\`\`

## replace_range - 按标题替换章节

\`\`\`json
{
  "doc_id": "文档ID或URL",
  "mode": "replace_range",
  "selection_by_title": "## 功能说明",
  "markdown": "## 功能说明\\n\\n更新后的内容..."
}
\`\`\`

## insert_before / insert_after - 插入内容

\`\`\`json
{
  "doc_id": "文档ID或URL",
  "mode": "insert_after",
  "selection_with_ellipsis": "\`\`\`python...\`\`\`",
  "markdown": "**输出示例**：\\n\`\`\`\\nresult = 42\\n\`\`\`"
}
\`\`\`

## overwrite - 完全覆盖

⚠️ 会清空文档后重写，可能丢失图片、评论等，仅在需要完全重建文档时使用。

\`\`\`json
{
  "doc_id": "文档ID或URL",
  "mode": "overwrite",
  "markdown": "# 新文档\\n\\n全新的内容..."
}
\`\`\`

# 最佳实践

## 小粒度精确替换

修改文档内容时，**定位范围越小越安全**。尤其是表格、分栏等嵌套块，应精确定位到需要修改的文本。图片/画板/电子表格等 token 内容无法重建，替换时应避开。

**示例**：表格单元格中有图片和文字，只需修改文字
- ❌ 替换整个表格或整行 → 可能破坏图片引用
- ✅ 只定位需要修改的文本 → 图片等其他内容不受影响

不确定定位时，先用 fetch-doc 确认内容。

修改多处内容时，优先使用多次小范围更新（replace_range/insert），而非 overwrite 重写整篇。分步更新保留原有媒体内容、评论、协作历史，更安全可靠。

## insert 模式注意插入位置

扩大定位范围来唯一定位时，插入位置基于匹配范围的**边界**：
- \`insert_after\` → 插入在匹配范围的**结尾**之后
- \`insert_before\` → 插入在匹配范围的**开头**之前

扩大范围时，确保边界仍然是期望的插入点。

## 修复画板语法错误

当 create-doc 或 update-doc 返回画板写入失败的 warning 时：
1. warning 中包含 whiteboard 标签（如 \`<whiteboard token="xxx"/>\`）
2. 分析错误信息，修正 Mermaid/PlantUML 语法
3. 用 \`replace_range\` 替换：\`selection_with_ellipsis\` 使用 warning 中的 whiteboard 标签，\`markdown\` 提供修正后的代码块
4. 重新提交验证

## 注意事项

- ** Markdown 语法**：支持飞书扩展语法，详见 create-doc 工具描述
`,
      parameters: {
        properties: {
          doc_id: {
            description: '文档 ID 或 URL',
            type: 'string',
          },
          markdown: {
            description:
              '要写入的 Markdown 内容。除 delete_range 模式、以及仅凭 task_id 查询异步任务外，所有写入模式（overwrite/append/replace_range/replace_all/insert_before/insert_after）均必填，不可省略或留空。',
            type: 'string',
          },
          mode: {
            description: '更新模式（必填）',
            enum: [
              'overwrite',
              'append',
              'replace_range',
              'replace_all',
              'insert_before',
              'insert_after',
              'delete_range',
            ],
            type: 'string',
          },
          new_title: {
            description: '新的文档标题（可选），仅支持纯文本，长度限制 1-800 字符',
            type: 'string',
          },
          selection_by_title: {
            description:
              "标题定位，格式 '## 章节标题'，定位整个章节（与 selection_with_ellipsis 二选一）",
            type: 'string',
          },
          selection_with_ellipsis: {
            description: "定位表达式，格式 '开头内容...结尾内容'（与 selection_by_title 二选一）",
            type: 'string',
          },
          task_id: {
            description: '异步任务 ID，用于查询任务状态',
            type: 'string',
          },
        },
        // Only `mode` is unconditionally required. The write modes additionally need `doc_id` +
        // `markdown`, but we express that requirement in the `markdown`/`mode` descriptions rather
        // than via a JSON-Schema `allOf`/`if`/`then` conditional: Bedrock-hosted Anthropic
        // (the tripflow/Peta gateway) rejects those keywords in tool `input_schema` with a
        // ValidationException, which breaks ALL Claude tool-calling for this MCP. The wired
        // ToolArgumentsRepairer + the repeated-failure breaker handle the empty-markdown case.
        required: ['mode'],
        type: 'object',
      },
    },
  ],
  meta: {
    avatar: '🪽',
    title: 'Feishu MCP',
    description:
      'Feishu/Lark document and user tools. **ROUTING: When the user provides a Feishu/Lark URL (feishu.cn, larkenterprise.com, larksuite.com, or paths like /wiki/, /docx/, /base/, /sheets/), you MUST use this tool (builtin-feishu-mcp) to read or operate it. NEVER use web-browsing / web-crawler for Feishu URLs — they are internal pages that require enterprise authentication and will return empty content.',
  },
  systemRole: feishuMcpSystemRole,
};
