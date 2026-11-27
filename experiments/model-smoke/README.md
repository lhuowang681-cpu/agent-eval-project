> 当前目录由日期目录迁移而来。现在从仓库根运行 `python -B scripts/check.py` / `python -B scripts/demo.py`；本文后续为原阶段记录。原路径与冻结哈希对应整理前归档，见[仓库结构说明](../../docs/REPOSITORY_LAYOUT.md)。

# Smoke输出合同修复与真实继续验证

先看RESULTS.md。原授权累计6次已用完，40例正式调用0。v1失败、v2两次及v3三次全部保存；最终只有v3三条完整通过接口，不能宣传6/6成功。

integration/provider.ts是v2，provider-v3.ts是v3；所有版本仍复用原ModelRuntime，不新增供应商SDK。审核源为frozen/reviewer的逐字旧版快照，未放宽规则。v1输入/结果/配置在archive_inputs，旧原目录和ZIP保留；共享预算账本的最终快照为archive_inputs/v1-paid-smoke-ledger.json。

results/analysis.json保存六次原始模型输出、原规则、增强规则与证据审核并列结果；per-call.csv按调用列出，不把重复Trace算独立案例。results/real-smoke-v2.json/v3.json保存供应商脱敏响应、Token和延迟。

仅需Python标准库即可离线重算：

```powershell
python -B analyze.py
python -B test_results.py
```

不需要Key，不产生模型请求。frozen/是便携引用快照，PROVENANCE有SHA，不代表另一个活跃分类器。实际TS/ModelRuntime重跑需原平台依赖，但当前预算已耗尽，不能删账本或覆盖真实结果来再次执行。

FREEZE及FREEZE_V3均在相应真实请求前保存。REVISION_PLAN/V3说明开发修订，AUTHORIZATION保留用户继续指令。程序保持原始身份、枚举和数值类型严格检查，未自动修复模型输出。

默认Shadow未启用，平台评分/诊断源码、原Gold均未修改。Key仅隐藏输入传给已退出的子进程，报告和交付不含凭据。仍缺严格独立人工Gold与真实规则外增量证据，因此不推广。
