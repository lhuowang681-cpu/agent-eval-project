# 飞书 MCP 真实浏览器 E2E 套件

用真实 Playwright 操作浏览器 + 真实 LLM + 真实飞书 MCP，系统覆盖飞书 10 个工具的读 / 写 / 健壮性场景，多模型对比，每场景录屏；并保留一份确定性 mock 回归锁定已修 bug。

> 设计文档见 `~/.claude/plans/feishu-mcp-tingly-kay.md`。

## 目录

```
config.ts            全局配置（端口、模型矩阵、文件夹 token、超时）
auth-capture.ts      一次性：手动授权飞书 → 保存 storageState
run.ts               真实模式入口（A/B 组 + D 组矩阵）
lib/                 driver / mcpCapture / modelSwitch / report
scenarios/           真实场景（read.ts 只读，write.ts 写入，fixtures 大文档）
regression/          C 组 mock 确定性回归（mockHarness + run.mts）
.auth/ videos/ screenshots/ reports/   运行产物（已 gitignore）
```

## 前置

1. 本地全栈 dev 已起：`bun run dev`（默认 `http://localhost:3010`）。
2. `.env` 配好：`DEV_USER_NAME`/`DEV_USER_PASSWORD`（应用登录）、各 LLM provider 的 API key、以及写入目标：
   ```
   FEISHU_TEST_FOLDER_TOKEN=<你空间里的测试文件夹 token>
   ```
3. 一次性捕获飞书授权态：
   ```bash
   bunx tsx scripts/feishu-e2e/auth-capture.ts
   ```
   按提示在浏览器里发一句用到飞书的话并完成 OAuth 授权，脚本自动存 `.auth/storageState.json`。

## 跑真实场景

```bash
# 只读冒烟
bunx tsx scripts/feishu-e2e/run.ts --scenario FS-READ-01
bunx tsx scripts/feishu-e2e/run.ts --group read

# 写入（需 FEISHU_TEST_FOLDER_TOKEN）
bunx tsx scripts/feishu-e2e/run.ts --scenario FS-WRITE-01
bunx tsx scripts/feishu-e2e/run.ts --scenario FS-WRITE-02,FS-WRITE-04

# A+B 全部（默认模型）
bunx tsx scripts/feishu-e2e/run.ts --all

# 跨模型矩阵（D 组）
bunx tsx scripts/feishu-e2e/run.ts --matrix
bunx tsx scripts/feishu-e2e/run.ts --matrix --models claude-opus,gpt
```

录屏 → `videos/<场景ID[-model]>.webm`；报告 → `reports/report-*.md` / `.json`。

环境变量可覆盖：`SPA_URL`、`HEADLESS=true`、`FS_SCENARIO_TIMEOUT`、`FS_SETTLE_QUIET`。

## 跑 mock 回归（C 组，无需授权 / 真实模型）

```bash
bunx tsx scripts/feishu-e2e/regression/run.mts           # 全部
bunx tsx scripts/feishu-e2e/regression/run.mts FS-REG-02 # 单个

# 条件 schema 契约（纯 Ajv 单测）
bunx vitest run --silent='passed-only' src/services/feishuUpdateDocSchema.test.ts \
  packages/context-engine/src/engine/tools/__tests__/ToolArgumentsRepairer.test.ts
```

## 场景一览

| ID                 | 组        | 覆盖                                                                                        |
| ------------------ | --------- | ------------------------------------------------------------------------------------------- |
| FS-READ-01..06     | 只读      | search-doc /fetch-doc (大文档分页) /list-docs/get-comments/search-user+get-user /fetch-file |
| FS-WRITE-01..05    | 写入      | create-doc (小 / 大文档 + 异步) /update-doc (多模式 / 大内容) /add-comments                 |
| FS-MTX-01          | 矩阵      | FS-WRITE-02/03/04 × 模型集                                                                  |
| FS-REG-01/02/04/05 | mock 回归 | 空 markdown 熔断 / 转义吞 markdown 救回 / UAT 失效授权卡片 / Mecha loop 熔断                |
| FS-REG-03          | 单测      | update-doc 条件 schema 契约（Ajv）                                                          |

## 已发现的问题（运行本套件得出）

1. **update-doc 的 `allOf`/`if-then` 条件 schema 让 Claude 完全用不了飞书 MCP（已修）**：
   commit 1b8c915f 给 update-doc 加了 JSON-Schema `allOf/if/then` 来强制写入模式必传 markdown。
   但 Claude（Sonnet 4.6）经 Bedrock/tripflow (Peta) 网关时，Bedrock 的 Anthropic tool
   `input_schema` **不接受这些关键字**，整个 tools 请求被 `ValidationException(400)` 拒掉 ——
   于是 Claude 连 search-doc 都调不了（所有飞书工具同批发送，一个非法 schema 全挂）。
   修复：移除 `allOf`，schema 回到只 `required:['mode']` 的扁平结构（写入模式必传 markdown 改由
   description 提示 + `ToolArgumentsRepairer` + 重复失败熔断兜底）。见
   `packages/builtin-mcp-feishu/src/manifest.ts`、`src/services/feishuUpdateDocSchema.test.ts`。
   修复后 sonnet 读写 10/10 全过。
2. **`update-doc` markdown 救回从未在真实链路生效（已修）**：`internal_transformToolCalls`
   构造的 manifests 不含 `builtinMcpManifests`，`ToolArgumentsRepairer` 拿不到飞书 schema
   而静默跳过修复。已在 `src/store/chat/slices/plugin/actions/internals.ts` 补接线，FS-REG-02 验证。
3. **大 markdown 单次写入不执行 ——MiniMax 特有，非通用 bug**：默认模型 MiniMax M2.7 在
   `create-doc`/`update-doc` 的 markdown body 超过约 400–500 字时，工具调用渲染出来但
   **永不执行**（`mcp.callTool` 不发起，该轮挂住）。同场景换 **Claude Sonnet 4.6** 实测可写入
   15623 字大文档（FS-WRITE-06）。所以这是 MiniMax 的输出预算 / 大 tool-call 组装限制，不是飞书
   MCP 的问题。FS-WRITE-02/04 默认尺寸限制在 MiniMax 可靠区间，FS-WRITE-06 作大文档诊断对比。

## 注意

- `.auth/storageState.json` 含真实凭证，已 gitignore，勿提交。
- 飞书 UAT 会过期：报告 / 运行若出现鉴权错，重跑 `auth-capture.ts`。
- 真实 LLM 不确定：A/B/D 组用「工具被正确调用 + 无 error + 可回读」宽松判据；严格 pass/fail 看 C 组。
- contenteditable 编辑器对 `keyboard.insertText` 不可靠，prompt 必须可逐字 type，**不要在
  prompt 里回显超长内容**；大文档让模型自行生成。
