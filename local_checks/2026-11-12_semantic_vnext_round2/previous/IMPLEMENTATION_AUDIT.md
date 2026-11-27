# VNext 实现审计（2026-11-10）

当前实际平台是 `../2026-11-08_platform_audit/platform`。本轮新实现全部位于 `2026-11-10_semantic_vnext`，没有替换平台默认归因器，也没有把历史 LLM 脚本接到线上链路。结论：语义观察的独立原型已实现并做了少量真实模型验证；生产推广条件尚不满足。

## 工作副本与历史材料

| 位置（相对 local_checks） | 身份与本轮处理 |
| --- | --- |
| `2026-11-08_platform_audit/platform` | 实际开发和运行副本，读取源码、执行相关回归，业务代码未改 |
| `2026-11-08_phase2` | 第二阶段设计、补丁和测试证据，未修改 |
| `2026-11-08_phase3/baseline`、`optimized`、`platform-phase3.patch` | 冻结原版、被否决候选和补丁，未修改、未重新应用 |
| `2026-11-08_phase3/ATTRIBUTION_QUALITY_REPORT.md`、`PROMOTION_DECISION.md` | 历史负结果与回滚依据，作为审计输入 |
| 项目根 `source-reference/attribution/llm_classifier.py` | 历史独立分类器，参考而非当前默认功能；本轮未导入执行 |
| 本目录 `shadow/` | 新语义合同、模型传输和独立审核，无平台注册入口 |
| 本目录 `baseline/` | 为便携复现复制的三个原版 Python 文件；逐字快照，不是另一个工作平台 |

## 默认链路与合同

`agentEvalExternal` 扩展 → TS attribution service → 提取已有数据库 Trace → 独立 async_tasks/worker → 固定 Python 子进程 → `adapter.analyze_reviewed` → 独立诊断结果。

TS 源码位于平台 `src/server/services/agentEvalAttribution/{contracts,index,trace,python}.ts`。已有任务身份、lease、重复回调/过期任务保护和 Python 进程边界，本轮不重建。原评测评分、Judge 和 Case 状态没有进入新实验的写入链路。

`scripts/eval-attribution/adapter.py` 的 v1 输入带 trajectoryId、inputDigest、Run/Case/Topic/Thread/Operation/Trace scope、原节点和 coverage。`analyze` 复用 `rules_pure.py` 的 14 类显式异常规则；不识别“用户要 2025，调用 2024”等成功工具调用中的语义偏差。默认 `analyze_reviewed` 保留规则观察，附加审核并可能将诊断标为 needs_review；不能把 safeCandidate=null 解释成原规则记录被删除。

现有 Trace 有 message/parent/toolCallId 和部分 operation/trace 身份；provider 请求、完整 span 和真实内部责任链不足。因此新实现只接受局部结构化观察，不确认内部模块和最终任务失败的唯一原因。

## 原审核为何不适合直接承载新候选

源码 `scripts/eval-attribution/evidence_review.py`：

- `review_candidate` 校验旧单条诊断合同、节点字段和原文摘录。
- 第 110–111 行拒绝 root/module 推断；这项约束应保留。
- 第 113 行用整节点 `observed_category` 匹配旧异常分类，无法验证新语义关系。
- 第 118–120 行摘要逐字白名单，合理改写也可能被拒。
- 第 122–123 行全局 complete 门禁，把局部事实与全链完整性混为一谈。

第三轮冻结报告中，28 例独立作者合成集的 24 个观察正例，完整审核原版/候选均为 0/24；候选还因隔离引文丢失同字段封装，误拒合法短摘录。该候选已回滚。本轮没有修改这些记录，也没有用旧 28 例调参。

## 模型设施与方案选择

平台已有 ModelRuntime；第二阶段 `increment3/experiment/direct.ts` 用 `initializeWithProvider` / `generateObject` 到本地 Mock，但脚本显式禁止真实模型，不可误称已有真实 LLM 平台归因。历史 llm_classifier 具备分类提示、跨信息分析与格式归一化思路，其分类树和自由根因模块输出不等于本轮证据合同，也没有独立引用支持性证明。

本轮复用：原 Trace 形状、身份和纯规则 baseline、OpenAI-compatible 请求协议与结构化输出思路。没有复制旧 56 类分类树，也没有启动带 dotenv/外部配置副作用的历史脚本。

没有直接调用平台 ModelRuntime：独立 Python Shadow 用标准库短 HTTP 适配层，避免为离线实验启动 Node/数据库和引入新依赖。代价是供应商请求选项需单独维护，尚未证明与平台 SDK 的功能完全一致。以后集成应优先把 generate 替换为平台已有模型入口，保留独立候选与审核合同。

## 本轮新增与兼容验证

新增调用链：`run_experiment → 原 adapter.analyze + shadow.client.generate/fixture → shadow.semantic_review.review → 本目录 results`。独立 CLI 为 `python -m shadow.cli`，无网络和数据库写入。

`SOURCE_FREEZE.json` 记录 10 个关键原文件 SHA；`results/default_unchanged.json` 确认全部未变。该快照是在本轮过程中记录，不夸大为整个历史仓库的完整不可变证明。新目录外没有实施业务修改。

本轮实际复测：新增 15 项 unittest、原 Python 36 项、原 TS 归因桥接 71 项通过。没有重新执行历史全部 945 项、真实 PostgreSQL/UI 或全库类型检查；第二阶段记录的 295 个历史类型诊断不能宣称已修复。本轮未新增 TS 文件。

## 可审计的限制

开发集 12 条、holdout 24 条均为新构造合成数据，但同一作者知道所有模板；初次测试前哈希冻结命令失败，后续有契约健壮性补强。`ALGORITHM_FREEZE.json` 如实记录。不能将新 holdout 宣称为独立作者、严格未见或生产 gold。

真实模型 6 次调用已经完成，全部只使用本轮合成轨迹；与人工候选回放分开保存。未发送真实用户 Trace。密钥未写入代码、数据、报告或压缩包。
