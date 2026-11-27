# 云沙箱 & 文件 Skill — Agent 对话测试用例

> 面向测试人员的手动测试文档。在 **Agent 对话** 中验证「原有云沙箱能力」与「本次新增的文件 / Office Skill 能力」。
>
> 最后更新：2026-06-15

---

## 1. 功能范围

### 1.1 原有能力（云沙箱基础）

| 能力             | 内置工具                                                | 说明                                           |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Shell 命令       | `lobe-cloud-sandbox` → `runCommand`                     | `extract-text`、`pdfinfo`、`jq`、`wc` 等       |
| Python 执行      | `executeCode`                                           | 会话级解释器，同 topic 内状态可复用            |
| 沙箱文件读写     | `readLocalFile` / `writeLocalFile` / `editLocalFile` 等 | 操作沙箱内路径                                 |
| 文件导出         | `exportFile`                                            | 将沙箱文件导出为可下载 URL                     |
| Topic 级 Session | —                                                       | 同一会话 topic 复用沙箱；空闲后可能回收        |
| 预注入上传文件   | 服务端 `preInjectSandboxFiles`                          | 发送带附件消息前写入 `/mnt/user-data/uploads/` |

### 1.2 本次新增 / 变更能力

| 能力                               | 说明                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| **File Reading** Skill             | 引导 Agent 正确读取沙箱附件（非 `cat` 乱读）                                       |
| **DOCX / PDF / PPTX / XLSX** Skill | Office 文档创建、编辑、分析；脚本在 `/mnt/skills/public/<skill>/scripts/`          |
| **非媒体文件一律走沙箱**           | 与文件大小无关；小 xlsx/pdf 也不再 inline 进上下文                                 |
| **技能可见性过滤**                 | 仅当对话含沙箱附件时，`<available_skills>` 才出现 File Reading + 四个 Office Skill |
| **自动启用 Cloud Sandbox**         | 检测到沙箱附件时 `forceCloudSandbox`                                               |
| **readReference 路径修复**         | PPTX/PDF 子文档引用与 `resources` key 对齐；支持无扩展名 / 大小写容错              |
| **Skill 图标**                     | File Reading、DOCX、PDF、PPTX、XLSX 在技能商店 / 配置页有独立图标                  |

---

## 2. 测试环境前置

### 2.1 必配项

- [ ] 已部署 **Cloud Sandbox**（OpenSandbox / `agentark/sandbox-code-interpreter` 镜像）
- [ ] 对象存储（S3 等）可用：文件上传、`exportFile` 导出依赖存储
- [ ] Agent 已启用内置工具：
  - [ ] **Cloud Sandbox**（`lobe-cloud-sandbox`）
  - [ ] **Skills**（`lobe-skills`）
- [ ] 沙箱镜像已内置：
  - Office 脚本：`/mnt/skills/public/{docx,pdf,pptx,xlsx}/scripts/`
  - Python 依赖：pandas、openpyxl、python-docx、python-pptx、pypdf、pdfplumber 等
  - CLI：`extract-text`、`pdftotext`、`pdfinfo`、`pandoc`、`jq` 等

### 2.2 推荐 Agent 配置

- 使用支持 **工具调用（Function Calling）** 的模型
- Skill 激活模式：当前产品为 **自动激活**（`skillActivateMode: auto`）
- 新建独立 **Topic** 做每条用例，避免沙箱 session 状态串扰

### 2.3 测试数据准备

| 编号 | 文件          | 用途             | 建议特征                  |
| ---- | ------------- | ---------------- | ------------------------- |
| F-01 | `sample.txt`  | 纯文本           | < 5KB，英文内容           |
| F-02 | `large.log`   | 大文本           | > 20KB，多行日志          |
| F-03 | `tiny.xlsx`   | 小表格           | **< 10KB**，2～3 列若干行 |
| F-04 | `report.xlsx` | 常规模型         | 多 Sheet，含表头          |
| F-05 | `memo.docx`   | Word             | 含标题 + 段落             |
| F-06 | `deck.pptx`   | PPT              | 3～5 页                   |
| F-07 | `digital.pdf` | 可选中文本层 PDF | `pdffonts` 有字体         |
| F-08 | `scan.pdf`    | 扫描件 PDF       | 无文本层，需 OCR / 转图   |
| F-09 | `photo.jpg`   | 图片             | 对比媒体不走沙箱注入策略  |
| F-10 | `data.csv`    | CSV              | 含表头，100+ 行           |
| F-11 | `bundle.zip`  | 压缩包           | 内含 2～3 个文件          |

### 2.4 观察点（每条用例建议记录）

1. **用户消息 XML**：是否出现 `<uploaded_files>`（沙箱）vs `<files>`（inline）
2. **可用技能列表**：是否仅在有附件时出现 File Reading / Office Skills
3. **工具调用链**：`activateSkill` → `readReference` → `runCommand` / `executeCode` → `exportFile`
4. **沙箱路径**：上传文件应在 `/mnt/user-data/uploads/{fileId}_{sanitizedName}`
5. **回答质量**：是否基于真实读取结果，而非编造文件内容

---

## 3. 测试用例

### 模块 A — 文件上传与沙箱路由（核心变更）

#### A-01 小体积 xlsx 仍走沙箱（P0）

| 项           | 内容                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **目的**     | 验证「非媒体与大小无关」策略                                                                                                                                                                                                                                   |
| **前置**     | 新 Topic；Agent 已启用 Cloud Sandbox + Skills                                                                                                                                                                                                                  |
| **操作**     | 上传 `tiny.xlsx`（< 10KB），发送：「这个文件里有什么内容？请根据文件实际内容回答。」                                                                                                                                                                           |
| **预期**     | ① 消息含 `<uploaded_files>`，`mode="sandbox"`，带 `sandbox_path`；② **无** 完整表格 inline 在 `<file>` 内；③ Agent 调用 `activateSkill('File Reading')` 或直接用 `runCommand`/`executeCode` 读沙箱路径；④ 使用 `extract-text` 或 openpyxl 预览，回答与文件一致 |
| **不应出现** | 直接 `cat` xlsx 输出乱码；在未读文件情况下编造数据                                                                                                                                                                                                             |

#### A-02 大体积 log 走沙箱 + head/tail（P0）

| 项       | 内容                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| **操作** | 上传 `large.log`（> 20KB），问：「日志最后 50 行大概说了什么？」                        |
| **预期** | 沙箱模式；Agent 用 `tail` 或 `readLocalFile` 分段读取，**非** 全文 `cat` 进上下文       |
| **备注** | 20KB 规则仅影响 File Reading 对纯文本的 `cat` vs `head/tail` 建议，**不**影响是否进沙箱 |

#### A-03 图片仍 inline / 视觉输入（P0）

| 项       | 内容                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| **操作** | 上传 `photo.jpg`，问：「图里有什么？」                                       |
| **预期** | 图片作为 **vision 输入**；可走多模态理解；**不应**要求 `extract-text` 读 jpg |
| **验证** | `processingMode` 非 sandbox（或不受沙箱文件 Skill 过滤影响）                 |

#### A-04 多文件同条消息（P1）

| 项       | 内容                                                               |
| -------- | ------------------------------------------------------------------ |
| **操作** | 同条消息上传 `memo.docx` + `tiny.xlsx`，问：「分别概括两个文件。」 |
| **预期** | 两个 `sandbox_path`；分别读取；不混淆路径                          |

#### A-05 中文文件名上传（P1）

| 项       | 内容                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| **操作** | 上传中文名文件如 `销售报表.xlsx`，问内容                                                         |
| **预期** | `sandbox_path` 中文件名被 sanitize（非 ASCII 转 `_`），Agent 使用 **实际 sandbox_path** 读取成功 |
| **导出** | 若生成新文件并 `exportFile`，输出路径须为 **英文文件名**                                         |

#### A-06 同 Topic 二次发送复用注入（P1）

| 项       | 内容                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| **操作** | 第一条上传 `report.xlsx` 并提问；第二条不再上传，问：「刚才那个表格有多少行？」 |
| **预期** | 沙箱 session 仍可用；能读到已注入文件（或再次从 topic 历史解析注入）            |

---

### 模块 B — 技能可见性 & 工具自动启用

#### B-01 无附件时不展示沙箱 Skills（P0）

| 项       | 内容                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **操作** | 新 Topic，**不上传文件**，发送：「你好」                                                                                                                                      |
| **预期** | `<available_skills>` / 技能商店可见列表中 **不含**：File Reading、DOCX、PDF、PPTX、XLSX（identifier：`lobe-file-reading`、`lobe-docx`、`lobe-pdf`、`lobe-pptx`、`lobe-xlsx`） |

#### B-02 有附件时展示沙箱 Skills（P0）

| 项       | 内容                                                                                    |
| -------- | --------------------------------------------------------------------------------------- |
| **操作** | 上传任意非媒体文件（如 `memo.docx`），任意提问                                          |
| **预期** | 上述 5 个 Skill **出现**；Cloud Sandbox 工具集被强制启用（即使 Agent 配置里未手动勾选） |

#### B-03 Skill 图标展示（P2）

| 项       | 内容                                                    |
| -------- | ------------------------------------------------------- |
| **操作** | 打开 **设置 → 技能 / 工具** 或技能商店，查看 5 个 Skill |
| **预期** | 各自显示 SVG 图标（文档 / Office 风格），非默认 🧩      |

---

### 模块 C — File Reading Skill

#### C-01 激活 File Reading（P0）

| 项       | 内容                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **操作** | 上传未知类型或 xlsx，问：「帮我看看这个文件。」                                                                                  |
| **预期** | `activateSkill` name=`File Reading`；随后 `runCommand` 使用 `stat`/`file`/`extract-text` 等，路径为 `/mnt/user-data/uploads/...` |

#### C-02 PDF 不 cat（P0）

| 项       | 内容                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| **操作** | 上传 `digital.pdf`，问：「有几页？第一页讲什么？」                               |
| **预期** | 使用 `pdfinfo`、`pdffonts` 或 `pdftotext -f 1 -l 1`；**不出现**对 pdf 的裸 `cat` |

#### C-03 CSV 用 pandas nrows（P1）

| 项       | 内容                                                   |
| -------- | ------------------------------------------------------ |
| **操作** | 上传 `data.csv`，问：「列名是什么？前 5 行长什么样？」 |
| **预期** | `pandas.read_csv(..., nrows=5)` 或等价；非全文加载     |

#### C-04 ZIP 只列目录（P1）

| 项       | 内容                                                           |
| -------- | -------------------------------------------------------------- |
| **操作** | 上传 `bundle.zip`，问：「里面有什么文件？」                    |
| **预期** | `unzip -l` 或 `tar -tf`；**不** 除非用户明确要求否则不全量解压 |

#### C-05 探查后跳转 Office Skill（P1）

| 项       | 内容                                                                       |
| -------- | -------------------------------------------------------------------------- |
| **操作** | 上传 `deck.pptx`，问：「帮我把第 2 页标题改成 XXX。」                      |
| **预期** | 先读内容（`extract-text` 或预览），再 `activateSkill('PPTX')` 进入编辑流程 |

---

### 模块 D — Office Skills（DOCX / PDF / PPTX / XLSX）

> 通用验证点：激活后技能正文含 **Sandbox execution** preamble；脚本使用 **绝对路径** `/mnt/skills/public/<skill>/scripts/...`；**不** `cd` 进技能目录；**不** 执行 `pip install` / `npm install`。

#### D-01 DOCX — 读取（P0）

| 项       | 内容                                                               |
| -------- | ------------------------------------------------------------------ |
| **操作** | 上传 `memo.docx`，问：「提取正文前 200 字。」                      |
| **预期** | `activateSkill('DOCX')` 或 File Reading → `extract-text`；内容正确 |

#### D-02 DOCX — 创建并导出（P1）

| 项       | 内容                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **操作** | 不上传，说：「用 DOCX skill 生成一份简单会议纪要，标题 Meeting Notes，一段正文，导出给我。」                                  |
| **预期** | `activateSkill('DOCX')`；`executeCode`/`runCommand` 生成 `/tmp/meeting_notes.docx`（英文路径）；`exportFile` 成功；用户可下载 |

#### D-03 PDF — 文本层读取（P0）

| 项       | 内容                                                         |
| -------- | ------------------------------------------------------------ |
| **操作** | 上传 `digital.pdf`，问：「总结 PDF 要点。」                  |
| **预期** | `activateSkill('PDF')`；`pdftotext` 或 pypdf；总结与原文一致 |

#### D-04 PDF — readReference FORMS / REFERENCE（P0）

| 项           | 内容                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **操作**     | 说：「我要填 PDF 表单，先告诉我表单处理要注意什么。」                                                                                       |
| **预期**     | `activateSkill('PDF')` → `readReference({ id: 'PDF', path: 'FORMS.md' })` **成功**（或 `forms`/`forms.md` 经容错解析）；返回 forms 文档内容 |
| **失败特征** | `Resource not found: "forms" in builtin skill "PDF"`                                                                                        |

#### D-05 PDF — 扫描件（P1）

| 项       | 内容                                                                   |
| -------- | ---------------------------------------------------------------------- |
| **操作** | 上传 `scan.pdf`，问：「这份 PDF 能直接提取文字吗？」                   |
| **预期** | `pdffonts` 判断无字体 → 说明需 OCR / 转图；引用 PDF skill 扫描文档章节 |

#### D-06 PPTX — 读取（P0）

| 项       | 内容                                                   |
| -------- | ------------------------------------------------------ |
| **操作** | 上传 `deck.pptx`，问：「每页标题分别是什么？」         |
| **预期** | `extract-text` 或 `python -m markitdown`；列出各页标题 |

#### D-07 PPTX — readReference pptxgenjs / editing（P0）

| 项           | 内容                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **操作**     | 说：「从零创建一份 3 页 PPT，先读取 pptxgenjs 教程。」                                                                          |
| **预期**     | `activateSkill('PPTX')` → `readReference({ id: 'PPTX', path: 'pptxgenjs.md' })` **成功**；资源树含 `editing.md`、`pptxgenjs.md` |
| **失败特征** | `Resource not found: "pptxgenjs.md"`（修复前问题）                                                                              |

#### D-08 PPTX — soffice 绝对路径（P1）

| 项       | 内容                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| **操作** | 需要 LibreOffice 转换时（如 legacy `.ppt`），观察 Agent 命令                             |
| **预期** | 使用 `python /mnt/skills/public/pptx/scripts/office/soffice.py ...`，**非** 裸 `soffice` |

#### D-09 XLSX — 小文件读取（P0）

| 项       | 内容                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| **操作** | 上传 `tiny.xlsx`，问：「有哪些 sheet？第一个 sheet 前 5 行？」                       |
| **预期** | `activateSkill('XLSX')` 或 File Reading；openpyxl `read_only=True` 或 `extract-text` |

#### D-10 XLSX — 创建并导出（P1）

| 项       | 内容                                                    |
| -------- | ------------------------------------------------------- |
| **操作** | 「创建一个 xlsx，Sheet1 填入 A1=Name B1=Score，导出。」 |
| **预期** | openpyxl 写入 `/tmp/...xlsx`；`exportFile`；下载可打开  |

#### D-11 跨 Skill 协作（P1）

| 项       | 内容                                                            |
| -------- | --------------------------------------------------------------- |
| **操作** | 上传 xlsx，问：「先告诉我内容，再帮我在最后一列加一列 Total。」 |
| **预期** | File Reading 探查 → `activateSkill('XLSX')` 编辑 → `exportFile` |

---

### 模块 E — Cloud Sandbox 工具体系（原有，回归）

#### E-01 runCommand 基础（P0）

| 项       | 内容                                                                     |
| -------- | ------------------------------------------------------------------------ |
| **操作** | 无附件，说：「在沙箱里执行 `echo hello` 并告诉我输出。」                 |
| **预期** | `runCommand`；stdout 含 `hello`；需用户确认（若开启 human intervention） |

#### E-02 executeCode 会话状态（P1）

| 项       | 内容                                                   |
| -------- | ------------------------------------------------------ |
| **操作** | ①「用 Python 定义 x=42」 ②「上一题的 x 加 8 是多少？」 |
| **预期** | 同 topic 内第二次 `executeCode` 能用到 `x`；回答 50    |

#### E-03 exportFile 英文路径（P0）

| 项       | 内容                                                              |
| -------- | ----------------------------------------------------------------- |
| **操作** | 生成中文路径文件后导出（可引导：「把结果存成 报表.txt 并导出」）  |
| **预期** | Agent 应先 **rename** 为英文路径再 `exportFile`；或提示文件名策略 |

#### E-04 禁止 pip install（P0）

| 项       | 内容                                                                   |
| -------- | ---------------------------------------------------------------------- |
| **操作** | 「pip install numpy 然后画个图」                                       |
| **预期** | **不** 执行安装；说明镜像无 numpy；建议用 Artifacts 做图表或改用已装库 |

#### E-05 readLocalFile 分段（P2）

| 项       | 内容                                                       |
| -------- | ---------------------------------------------------------- |
| **操作** | 沙箱内有大文件，要求读第 100～120 行                       |
| **预期** | `readLocalFile` 带 `startLine`/`endLine` 或 shell `sed -n` |

#### E-06 后台命令（P2）

| 项       | 内容                                             |
| -------- | ------------------------------------------------ |
| **操作** | 触发长时间 `runCommand`（若产品支持 background） |
| **预期** | `getCommandOutput` / `killCommand` 可用          |

---

### 模块 F — Skills 工具（lobe-skills）

#### F-01 activateSkill 未找到（P1）

| 项       | 内容                                 |
| -------- | ------------------------------------ |
| **操作** | 诱导调用 `activateSkill('NotExist')` |
| **预期** | 返回可用技能列表；Agent 友好提示     |

#### F-02 readReference 路径容错（P1）

| 项       | 内容                                                                         |
| -------- | ---------------------------------------------------------------------------- |
| **操作** | 激活 PPTX 后，分别用 path=`pptxgenjs`、`pptxgenjs.md`、`PPTXGENJS.MD` 读参考 |
| **预期** | 均能读到 `pptxgenjs.md` 内容（容错解析）                                     |

#### F-03 execScript vs runCommand（P2）

| 项       | 内容                                                      |
| -------- | --------------------------------------------------------- |
| **操作** | Office skill 要求跑 bundled script                        |
| **预期** | 需要技能包资源时用 `execScript`；普通 CLI 用 `runCommand` |

---

### 模块 G — 负面与边界

#### G-01 未启用 Cloud Sandbox（P1）

| 项       | 内容                                                       |
| -------- | ---------------------------------------------------------- |
| **前置** | Agent **关闭** Cloud Sandbox，且对话无沙箱附件触发强制启用 |
| **操作** | 上传 xlsx 并提问                                           |
| **预期** | 无法执行沙箱命令；应有明确失败或降级提示（视产品策略）     |

#### G-02 沙箱超时（P2）

| 项       | 内容                         |
| -------- | ---------------------------- |
| **操作** | 执行接近 60s 的命令          |
| **预期** | 超时错误；Agent 建议拆分任务 |

#### G-03 路径穿越（P2）

| 项       | 内容                                                |
| -------- | --------------------------------------------------- |
| **操作** | 若可构造 `readReference` path=`../../../etc/passwd` |
| **预期** | 拒绝；返回 path traversal 不允许                    |

#### G-04 无 S3 / 注入失败（P2）

| 项       | 内容                                                                                |
| -------- | ----------------------------------------------------------------------------------- |
| **前置** | 存储或沙箱异常环境                                                                  |
| **预期** | 发送消息不阻断；日志有 `preInjectSandboxFiles failed`；Agent 读文件失败时有合理解释 |

#### G-05 多轮附件累积（P1）

| 项       | 内容                                                |
| -------- | --------------------------------------------------- |
| **操作** | 第 1 轮上传 A；第 2 轮上传 B；问「对比 A 和 B」     |
| **预期** | topic 内两文件均可访问（预注入收集 topic 历史附件） |

---

## 4. 推荐测试顺序（冒烟 → 全量）

```
冒烟（约 30 分钟）
  A-01 → A-03 → B-01 → B-02 → C-01 → C-02 → D-07 → D-04 → E-01 → E-04

Office 全量（约 1 小时）
  D-01 ~ D-11

回归（约 30 分钟）
  E-02 ~ E-06、F-01 ~ F-03、G-01 ~ G-05
```

---

## 5. 验收检查清单

| #   | 检查项                                                  | 通过 |
| --- | ------------------------------------------------------- | ---- |
| 1   | 非媒体附件（含 <10KB xlsx）一律沙箱注入，内容不进上下文 | ☐    |
| 2   | 图片 / 音视频不走「非媒体沙箱」策略                     | ☐    |
| 3   | 无附件时 5 个沙箱 Skill 不可见                          | ☐    |
| 4   | 有附件时 5 个沙箱 Skill 可见且图标正确                  | ☐    |
| 5   | File Reading 引导正确读取命令，非 cat 二进制            | ☐    |
| 6   | PPTX `readReference('pptxgenjs.md')` 成功               | ☐    |
| 7   | PDF `readReference('FORMS.md')` 成功                    | ☐    |
| 8   | Office 脚本使用 `/mnt/skills/public/...` 绝对路径       | ☐    |
| 9   | 生成文件默认 `exportFile`，路径为英文                   | ☐    |
| 10  | 不尝试 pip/npm install                                  | ☐    |

---

## 6. 关键路径与标识符速查

| 概念               | 值                                                                     |
| ------------------ | ---------------------------------------------------------------------- |
| 上传目录           | `/mnt/user-data/uploads/`                                              |
| 上传文件名         | `{fileId}_{sanitizedOriginalName}`                                     |
| Office 脚本根      | `/mnt/skills/public/{docx\|pdf\|pptx\|xlsx}/scripts/`                  |
| activateSkill 名称 | `File Reading`、`DOCX`、`PDF`、`PPTX`、`XLSX`                          |
| Skill identifier   | `lobe-file-reading`、`lobe-docx`、`lobe-pdf`、`lobe-pptx`、`lobe-xlsx` |
| PPTX 资源          | `editing.md`、`pptxgenjs.md`                                           |
| PDF 资源           | `FORMS.md`、`REFERENCE.md`                                             |
| 纯文本 20KB 规则   | **仅** File Reading 内 `cat` vs `head/tail`，**非**沙箱门槛            |

---

## 7. 已知限制（测试时预期行为）

1. 沙箱 **不能** 运行时安装 numpy/matplotlib 等未预装包。
2. 图表类需求应走 **Artifacts**，非沙箱出图。
3. LibreOffice 必须用 **soffice.py 包装脚本**，裸 `soffice` 可能挂起。
4. Session 空闲回收后，临时 `/tmp` 文件可能丢失；用户上传在 `/mnt/user-data/uploads/` 会随 topic 重新注入。
5. `readReference` 读的是 **BuiltinSkill 内存资源**，不是沙箱磁盘上的 `.md` 文件（两者内容应对齐）。

---

## 8. 缺陷记录模板

```
用例编号：
环境：（staging / 本地 / 版本号）
Topic ID：
复现步骤：
实际结果：
预期结果：
工具调用截图/日志：（activateSkill / readReference / runCommand 参数）
严重级别：P0 / P1 / P2
```

---

## 9. 相关代码与文档

- 沙箱策略：`packages/utils/src/fileSandboxPolicy.ts`
- 技能过滤：`src/services/chat/mecha/filterSkillsForSandboxFiles.ts`
- File Reading 正文：`packages/prompts/src/prompts/files/fileReadingSkill.ts`
- 附件 Prompt：`packages/prompts/src/prompts/files/file.ts`
- Cloud Sandbox 系统提示：`packages/builtin-tool-cloud-sandbox/src/systemRole.ts`
- 预注入：`src/server/services/market/preInjectSandboxFiles.ts`
