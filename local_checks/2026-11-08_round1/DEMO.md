# 第一轮修复的本机演示与复测

使用已恢复的原平台工作副本，不需要显卡。真实数据库为 PostgreSQL 16.15 + pgvector 0.8.6，模型是项目原有本地 Mock，不能用于证明模型效果。评测数据库模型/服务自动测试仍用原 PGlite 测试配置；HTTP 和以下浏览器演示使用真实 PostgreSQL。

## 1 启动

在正常本机 PowerShell 打开项目目录：

```powershell
cd C:\Users\1\Desktop\就业agent\agent-eval-project
& ./local_checks/2026-11-08_round1/start_postgres.ps1
python ./local_checks/2026-11-08_round1/serve_local.py
```

保持这个终端运行，等待 READY。地址为 `http://127.0.0.1:13010`。启动器管理原 Next 后端、Vite 前端 9876、本地 Mock LLM 18088 和 Mock 工具服务 18089。`ENABLE_MOCK_DEV_USER=0`，浏览器使用真实登录会话；HTTP 自动验收的显式开发认证头仅对应合成审计用户。所有模型凭据均为本地占位值。

首次 Vite 依赖预构建和 Next 页面编译可能较慢。只启动 Next 会导致登录后的 SPA 500；首次编译超过代理等待时间也可能出现暂时 500，应结合日志区分。本次已实际遇到并保留早期失败记录。

数据库使用 ASCII 临时路径 `%TEMP%/agent-eval-round1-pgdata`，避免 Windows 中文路径初始化失败；二进制位于本目录 `postgres-portable/pgsql`，通过本机临时 Junction 访问。不安装系统服务，不删除已有数据。启动前确认 15433、13010、9876、18088、18089 未被其它程序使用。

107 个迁移已在真实 PostgreSQL 执行，两个依赖 ParadeDB pg_search/BM25 的迁移没有执行，也没有写假成功记录。见 `postgres-migrations.json`。搜索/BM25 不在本轮演示范围。

本机二进制已准备。复建工具来源：[PostgreSQL Windows 官方入口](https://www.postgresql.org/download/windows/)、[EDB 官方二进制](https://www.enterprisedb.com/download-postgresql-binaries)、[pgvector 官方 Windows 安装说明](https://github.com/pgvector/pgvector#windows)及其支持的 conda-forge Windows 包。已使用 `postgresql-16.15-1-windows-x64-binaries.zip` 和 `pgvector-0.8.6-h2466b09_0.conda`；这份修复补丁包不包含数据库二进制或整份 node_modules。

## 2 浏览器完整操作

1. 打开 `http://127.0.0.1:13010/signin`。本次专用合成账号为 `round1-ui@example.com`，密码 `Round1LocalOnly2026!`；不是生产凭据。首次在空库演示可先注册本机测试账号。
2. 进入 `/eval`，创建一个名称和标识都唯一的 Benchmark，再创建数据集，评测方式选择 Contains。数据集 identifier 在用户范围内唯一，复跑不能沿用旧 identifier。
3. 添加三题，例如 `Synthetic question 1/2/3`，三题期望答案均为 `Mock LLM`。这是为了验证确定的本机运行链路。
4. 在运行弹窗选择默认 `TripYoYo AI`。该用户的 Inbox 需配置为 `model=mock-model`、`provider=openai`，系统角色任意合成文本，关闭额外插件；自动浏览器脚本会通过真实会话 API 准备这一前置配置，随后清除会话重新通过登录表单登录。
5. 创建并启动运行，等待 Completed，检查三题 Passed、分数均 1、通过率 100%。查看逐题报告和运行配置快照。
6. 修改 Agent 配置后新建一轮运行。不要修改旧运行来替代重新评测；检查新旧快照。HTTP 自动验收实际将系统角色从 `Synthetic v1` 改为 `Synthetic v2`，并确认旧运行仍保存 v1。
7. UI 自动验收另外修改数据集描述和新运行 maxSteps 配置并重测；这项与 Agent 配置修改的 HTTP 证据分开记录，不混称。

本地 Mock 是固定回复，改提示词后仍通过只证明配置、执行、评分和报告衔接，不能声称 Agent 效果提升。

## 3 自动复测命令

另开终端，在项目根目录运行：

```powershell
python ./local_checks/2026-11-08_round1/http_eval.py http://127.0.0.1:13010 http://127.0.0.1:18088
python ./local_checks/2026-11-08_round1/http_judge_errors.py

$env:BASE_URL='http://127.0.0.1:13010'
$env:LOGIN_EMAIL='round1-ui@example.com'
$env:LOGIN_PASSWORD='Round1LocalOnly2026!'
$env:UI_OUTPUT=(Join-Path (Get-Location) 'local_checks/2026-11-08_round1/ui/manual-replay')
node ./local_checks/2026-11-08_round1/ui/verify_ui.cjs

python ./local_checks/2026-11-08_round1/scoring/run_regression.py
python ./local_checks/2026-11-08_round1/attribution/run_regression.py
```

浏览器脚本使用本机 Edge 和已有 Playwright。真实登录及业务接口不替换；外部字体可在测试中阻断，阻断列表记入结果。运行环境若禁止启动浏览器、读取 pnpm 链接或访问本机端口，会单独失败；0 项测试不算通过。

Runtime、完整服务及路由的准确最终命令保存在各结果目录的 `*-command.json`，完整汇总见 `ROUND1_REPORT.md`。启动器的 `--smoke` 参数还会运行原有 27 项 HTTP/SSE/计算器工具冒烟；勿与浏览器评测同时切换 Mock 场景。

Judge HTTP 验证分别故意缺少模型配置及让本地 Mock 返回非 JSON，预期题目是 error、failedCases=0，整轮终结为 failed。这是错误路径验收通过，不表示这些题目通过。有效 Judge 分数、合法零分及双路径的服务回归使用明确标注的 ModelRuntime 替身。

## 4 停止与原件

在启动器终端 Ctrl+C 停止它管理的服务，再运行：

```powershell
& ./local_checks/2026-11-08_round1/stop_postgres.ps1
```

保留测试库供查看，不执行清库或递归删除。原 ZIP、96 个 `source-reference` 快照保持不变；实际修复平台在 `local_checks/2026-11-08_platform_audit/platform`，修复归因入口在 `local_checks/2026-11-08_round1/attribution/structured_jsonl_attribution.py`，不是只读快照。
