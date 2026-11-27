# 真实 PostgreSQL 诊断联调

**最终11场景通过。数据库真实，轨迹为人工构造并真实持久化的合成记录；不是新跑的Agent模型任务，也不是生产业务轨迹。**

使用项目已有PostgreSQL16.15二进制，新建专用临时集群，监听127.0.0.1:15435，数据库vnext_acceptance_20261114。107个项目迁移应用，110表，pgvector0.8.6可用；两个pg_search/BM25迁移缺依赖而跳过，没有伪造已应用记录。它们不参与已验证的诊断查询。

## 实际执行链

真实Run/Case/Topic/Thread与messages/message_plugins → 原tRPC diagnosisRequest（server-side caller）→ 原extractTrajectory → 原async_tasks → 原AgentEvalAttributionService.processJob/lease → 原runPython → 可选persistedShadowRunner → 可选原ModelRuntime调用localhost HTTP Mock → Python review_candidate/原Evidence Review候选模块 → 独立async_tasks制品 → tRPC diagnosisGet与数据库查询读回。

没有Mock数据库、SQL查询、原诊断服务或tRPC处理函数。调用者直接提供测试用户上下文，通过真实鉴权middleware；匿名被拒、其他user读不到诊断。不是HTTP登录/UI测试，不宣称验证了浏览器会话或线上部署。

## 场景与结果

| 场景 | 最终结果 |
| --- | --- |
| normal_passed | 原入口跳过，无诊断任务，符合只诊断失败的原策略 |
| recovered_passed | 工具曾失败后通过，同样跳过，不改评分强行入队 |
| explicit_off | 原任务success，没有sidecar或模型调用；结果与原runPython逐字对象相等 |
| explicit_on | 原任务success；global complete=false，局部工具失败仍受支持并单独落库 |
| recovered_quality_failed | 工具重试后内容正确但预置rubric未通过；记录中间异常，不推最终失败根因 |
| multi | 多调用结果按toolCallId与消息字段关联，任务与sidecar成功 |
| missing_call | 来源配对不足，sidecar零观察，原诊断不被污染 |
| worker_failure | 真Python不存在可执行文件，原诊断任务error/python_spawn，评分保持 |
| worker_timeout | 真实受控子进程sleep触发截止，任务error/python_timeout，评分保持；不是原adapter自然慢超时的性能实验 |
| semantic_on | 原ModelRuntime→本机HTTP Mock→Python语义审核→sidecar落库，原诊断仍为原结果 |
| shadow_timeout | sidecar真实子进程超时单独记error；原诊断仍success |

11例中2个已通过轨迹按原策略跳过；9个原诊断任务中7成功、2预期error。6次sidecar尝试，其中5成功、1预期超时；1次ModelRuntime本机Mock，付费模型请求0。

每个入队请求重复调用diagnosisRequest得到相同ID且created=false；完成后再次processJob不被claim。Trace scope/inputDigest/Thread关联正确。所有接受EvidenceRefs通过平台evidenceText对原消息或插件字段逐条核验；局部支持、观察和needs_review/unknown诊断不升级成Root Cause，moduleId/rootCause均null。

操作前后比较Run、RunTopic、Thread、messages和message_plugins完整JSON快照，评分、Judge预置元数据、Run终态与源消息完全不变。这里保护的是持久化的合成Judge结果，不是重新执行真实LLM Judge；评分计算另由225项TS回归覆盖。

## 失败、修复与环境边界

- Node直接加载应用时，依赖包存在错误CJS导出、仅ESM入口和Markdown原文资源加载差异。测试进程用validator-compat.cjs指向已安装真实实现并按原文加载.md，不修改node_modules、不模拟认证/DB/路由；项目原有私有依赖stub仍存在，因此不是完整生产依赖验收。
- 前7次准备/联调日志保留。一次引文断言错误使用JSON.stringify，忽略既有Python兼容序列化；改为复用平台evidenceText，保留同样严格的原文字段检查。
- 发现验收runner若直接await sidecar异常会改变原诊断任务状态，已改用上一轮隔离包装器，记录独立成功/失败结果；保留修复前脚本/结果，新增5项wrapper回归并增加shadow_timeout真实数据库场景。
- pg_ctl首次继承进程管道影响启动控制返回；改为隐藏Start-Process并只等待控制进程。专用集群已实际停止、重启验证，再停止；数据目录保留，可复现，不删除旧集群。

最终证据为results/postgres-e2e.json、postgres-e2e-isolation-final.log。之前postgres-e2e-error.json是早期失败，不代表最终状态；所有失败均保留。sidecar从数据库由验收查询器读回，尚未新增线上sidecar查询API或UI。
