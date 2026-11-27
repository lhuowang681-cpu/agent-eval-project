# 增量二 持久化轨迹到Python独立诊断

已在独立真实PostgreSQL库`agent_eval_phase2`完成：Agent评测失败→按Run/Case/Thread提取已落库轨迹→独立任务→真实Python子进程→结构化诊断→通过原身份关联，并验证原评分、状态和汇总指标不变。真实执行证据为`http/results.json`，不能用纯组件测试替代。

## 关键调用链与改动

```text
agentEvalExternal.diagnosisRequest(runId)
  → AgentEvalAttributionService.enqueueRun
  → extractTrajectory（原run/case/topic/thread + messages/message_plugins）
  → async_tasks（不可变input、版本化ID、独立status/lease）
scripts/local/evalAttribution.ts --process-only
  → processPending → 原子claim → runPython
  → 固定scripts/eval-attribution/adapter.py
  → 既有纯规则函数 → 结构化JSON → schema/身份/引用校验
  → async_tasks.result
agentEvalExternal.diagnosisGet / diagnosisList / diagnosisTrace
```

新增代码集中在`src/server/services/agentEvalAttribution/`、`scripts/eval-attribution/`和单机CLI；原外部路由只增加独立诊断方法。没有调用`reportResult`，没有新增表、Python常驻服务、Redis或分布式队列。原通用AsyncTaskModel的宽范围更新不用于这些任务，诊断查询/写入同时限制userId和任务type。

新增必要持久化修复有两层，均先真实回归失败后最小修复：计算器runtime漏传executor.error，补1行；共享MessageModel.create接收但没写pluginError，补解构和插件error入库2行。其余工具未全量审计。实际SQL错误和修复前HTTP在`tool-error-evidence/`及`http/`，最终真实工具`CalculationError`与原始message/type可从诊断证据回查。

## 合同和生命周期

JSON版本1保留trajectoryId、inputDigest、runId/caseId/topicId/threadId/operationId/traceIds；证据节点保留messageId、父节点、精确toolCallId、实际source/type和sourcePointer。call节点从实际assistant.tools派生并指回原字段，不冒充原始span。k>1必须指定eval thread，不能混合全topic消息。

没有TraceID、Provider请求或完整operation事件时标coverage缺失；未知工具来源不按名字猜builtin/MCP。实际持久化工具类型是type字段，已补type与source兼容及冲突拒绝回归。角色/来源/大小异常明确拒绝或复核，不静默裁剪后宣称完整分析。

输入和输出各最多1MiB、500节点；Python固定程序、无shell、无dotenv，子进程不继承模型密钥。默认15秒硬截止、上限30秒。确定任务ID绑定用户、原始输入和Python代码revision；重复请求不放大任务，lease token隔离并发及崩溃重领后的迟到结果。分析失败只写诊断error，不修改原Case。规则分析完成但无根因证据可为unknown，属于有效分析结果，不等于业务成功。

## 验收结果

- Python纯规则适配组件15项：涵盖14既有类别、原函数AST/SHA一致性及坏输入，全部通过。没有重写原分类器或加载旧LLM模块的dotenv。
- TS↔Python边界42项：13次真实固定子进程成功，另有受控进程错误/超时/输出边界；局部strict tsc通过。
- 轨迹真实DB组件最终15项：只读、用户/Run/Case/Thread隔离、同callId跨case、来源冲突、父/trace/op关系和大小限制通过。
- 独立任务11项：重复enqueue/claim、超时/退出、旧lease迟到、代码版本变化、原评分不变及真实Python任务通过。
- 增量二正式合并gate为68/68，见`gate-final.json`和上层`INCREMENT_GATES.json`。后续审核增量的回归另存，不覆盖这个基线。
- 真实HTTP三道质量失败返回unknown；受控实际计算器失败返回故障观察、moduleId=null、needs_review，证据来自实际落库error。两类诊断都未改变原分数。不能把“工具已失败”说成“已证明Agent内部模块责任”。

首次夹具错读getRunDetails的topic层级、结构化错误丢失、持久化来源type未读取，以及跨语言数值/Unicode表示差异都有修复前日志。没有通过放松引文校验、删除旧业务断言或合成error替代真实error来获得通过。

## 复现

启动命令和合成账号见上层`DEMO.md`。在platform根目录配置隔离DB后运行：

```powershell
$env:EVAL_ATTRIBUTION_PYTHON='C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
node --import tsx scripts/local/evalAttribution.ts --user-id phase2-audit-user --run-id 实际失败runId
node --import tsx scripts/local/evalAttribution.ts --user-id phase2-audit-user --process-only --limit 100
```

CLI默认每批10项，上限100，可重复运行。它是显式单机批处理，不是自动常驻daemon；API只创建/查询任务，用户或本机调度应运行worker。结果按版本保留；改变分析器代码后需重新请求诊断，不将旧版本结果覆盖成新版本。

## 局限

尚无完整持久化operation/span因果图，真实Trace coverage通常不完整。旧动态MCP/plugin来源无法确认时保持unknown。没有真实脱敏标注，不能声称归因准确率或内部根因定位已验证。大轨迹会拒绝而不是自动去噪；诊断快照保留策略、长期清理、跨主机worker和生产部署不在本轮范围。Python可执行文件与脚本需随单机环境正确安装；没有容器化或新的运维组件。
