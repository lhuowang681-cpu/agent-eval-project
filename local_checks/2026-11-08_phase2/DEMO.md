# 第二阶段本机演示与复跑

所有命令从 `C:\Users\1\Desktop\就业agent\agent-eval-project` 执行。使用现有完整平台工作副本；交付ZIP不含node_modules、PostgreSQL二进制或数据库，不能只解压此证据包就启动全平台。无需显卡，当前所有模型验证使用本机Mock。第一阶段材料保留，勿覆盖运行旧阶段验收脚本。

## 启动与页面

```powershell
cd C:\Users\1\Desktop\就业agent\agent-eval-project
& ./local_checks/2026-11-08_phase2/start_postgres.ps1
python ./local_checks/2026-11-08_phase2/serve_local.py
```

PG启动请作为独立命令执行，再运行常驻启动器；不要把两者放在同一个PTY后台启动。等待READY后另开终端操作。端口为Next 13010、Vite 9876、Mock模型18088、Mock服务18089、PG15433，勿与第一阶段同时启动。启动器只访问localhost，模型/S3均为占位配置。

数据库是单独的 `agent_eval_phase2`，使用原16.15+pgvector0.8.6便携集群。首次复建二进制来源和本机初始化说明见第一阶段DEMO.md；107项迁移已执行，2项BM25迁移明确未执行。不要把缺失扩展标成通过。

打开 `http://127.0.0.1:13010/signin`，本机合成账号 `phase2-ui@example.com`，密码 `Phase2LocalOnly2026!`。空库可用下列UI脚本注册，再清除会话并通过真实表单登录。浏览器页面未启用默认开发认证旁路；自动HTTP脚本显式使用独立合成审计用户。

```powershell
$env:BASE_URL='http://127.0.0.1:13010'
$env:LOGIN_EMAIL='phase2-ui@example.com'
$env:LOGIN_PASSWORD='Phase2LocalOnly2026!'
$env:UI_OUTPUT=(Join-Path (Get-Location) 'local_checks/2026-11-08_phase2/increment1/ui/manual-replay')
node ./local_checks/2026-11-08_phase2/increment1/ui/verify_judge_forms.cjs
```

脚本真实操作Dataset新建/编辑与Case新建/编辑，配置 `openai/mock-judge-valid`、criteria、systemRole及timeout，不填写旧judgePrompt，然后API读回。已有账号重复注册可能422，只有随后真实登录及session成功才继续。需要本机Edge和已有Playwright。

## Judge与归因闭环

依次执行，不能并行切换Mock场景：

```powershell
python ./local_checks/2026-11-08_phase2/judge_http.py
python ./local_checks/2026-11-08_phase2/attribution_http.py
python ./local_checks/2026-11-08_phase2/http_smoke.py
```

这些命令重写本轮对应HTTP结果文件，复跑前请另存交付ZIP。Judge脚本创建实际任务和运行，检查合法评分、0分、空响应、非法JSON、越界、空reason、二值半分、provider错误、超时、旧配置及K=2。`error`是预期错误路径，不表示题目通过。结果包含实际runId/topicId及报告API内容，属于显式开发认证的审计用户；它没有上述UI账号的登录凭据。UI用户与审计用户隔离，不能跨用户查看这些运行。浏览器 `/eval` 只展示当前真实登录用户自己的数据；本轮UI验收范围为登录及四表单，运行报告链路的证据在HTTP结果中。

归因脚本创建三题质量失败及一题实际计算器错误，调用原扩展的diagnosisRequest，然后真实CLI worker、diagnosisGet/List/Trace，检查去重、证据身份和评分不变，并验证未登录401/另一真实会话404。跨用户检查依赖前面的UI合成账号已经创建。

手工处理失败运行时，在另一个终端：

```powershell
cd ./local_checks/2026-11-08_platform_audit/platform
$env:DATABASE_DRIVER='node'
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:15433/agent_eval_phase2'
$env:KEY_VAULTS_SECRET='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
$env:EVAL_ATTRIBUTION_PYTHON='C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
node --import tsx scripts/local/evalAttribution.ts --user-id phase2-audit-user --run-id 实际失败runId
node --import tsx scripts/local/evalAttribution.ts --user-id phase2-audit-user --process-only --limit 100
```

默认enqueue并处理；`--enqueue-only`只入队，`--process-only`处理该用户待办。worker不是daemon。API diagnosisRequest只入队，不自动运行Python；对照http/results可看到独立job、原run/case/thread、inputDigest和原message证据。质量失败unknown和工具失败needs_review都是预期弃权，不能解读成确认内部模块根因。

## 回归与证据实验

最终选定945项的准确命令在REGRESSION_SUMMARY.json所列报告对应 `results/*-command.json` 中，含cwd、参数、退出码及耗时。root results/core-final-command.json、db-final-command.json、router-final-command.json、attribution-reviewed-final-command.json，increment1/results/final-lifecycle-regression-command.json、modal-render-command.json，以及计算器和实验各results目录可完整复现；输出路径改为新的replay文件，保留原件。部分模型数据库组件测试使用既有PGlite，不混称为真实PG；真实PG在HTTP层验证。

Python在platform根目录运行：

```powershell
& 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -m unittest discover -s scripts/eval-attribution -p 'test_*.py' -v
```

12例三方案实验的完整三个命令见increment3/experiment/REPORT.md，须启动加载新增Mock分支的18088服务。它仅回显合成候选。结果包含每例规则/direct/review，失败与未提升案例不可删除。真实模型没有可确认配置，本轮未运行。

全库类型复查在platform根目录 `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`，需约8GB Node堆，可设置 `NODE_OPTIONS=--max-old-space-size=8192`。预期仍exit2，历史295个诊断位置；不能用Vitest成功代替类型通过。

## 停止与补丁

先在serve_local终端Ctrl+C，再从项目根执行：

```powershell
& ./local_checks/2026-11-08_phase2/stop_postgres.ps1
```

保留数据库供下次查看，不清库、不注册系统服务。CLEANUP.json记录本次结束后监听状态。

`platform-phase2.patch`以冻结第一阶段源码为基线，当前工作副本已应用，**不要重复应用**。迁移到另一份相同第一阶段源码时，先检查再应用：

```powershell
git apply --check --ignore-space-change 本轮补丁绝对路径
git apply --ignore-space-change 本轮补丁绝对路径
```

本轮已在隔离副本实际检查、应用并逐文件比对，见PATCH_VERIFICATION.json。新旧代码和SHA见SOURCE_CHANGES.json；原96份source-reference不改。本轮包另含changed-source供审阅，不含完整恢复环境。报告中的本机绝对路径换电脑需要按实际安装位置调整。
