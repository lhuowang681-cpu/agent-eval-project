# 第二阶段增量设计和验收

本阶段在第一阶段平台工作副本上继续增量实现；原ZIP、96个参考快照和第一阶段结果不覆盖。先完成Judge与归因任务桥整体验收，再启用证据审核与比较实验。Mock实验不能替代真实模型质量或真实标注准确率。

## 现状审计入口

- `audit/judge/AUDIT.md`：配置被judgePrompt门控、任务input缺失、软超时、二值结构校验与结果来源缺口。
- `audit/attribution/AUDIT.md`：既有规则、56模块、旧LLM normalize宽松、JSONL与平台消息合同差异；证据存在不等于责任命题成立。
- `audit/types/AUDIT.md`：原ZIP隔离源与第一阶段冻结源真实tsc逐条对照，295条完全共享。两处反向共享源hash相同，第三方依赖为同一锁定环境，不能称完全独立依赖安装。
- `audit/platform/`：GitNexus真实查询/impact及其缺图、FTS和下界限制。现成外部reportResult会覆盖评分，不用于诊断。

## 增量一 LLM Judge

复用现有matcher→evaluateOutput→initModelRuntimeFromDB→generateObject，不建设第二套模型客户端。输入明确task/expected/actual/criteria与已有choices/category；兼容旧judgePrompt作为criteria别名。保留题目整份覆盖数据集配置的旧语义，不静默改变所有规则继承。

四个现有配置表单补齐同一组字段，修复实际保存条件，不改整体UI。硬截止包含runtime初始化，错误使用稳定代码、与合法零分分开。评分来源在顶层、rubric和thread注明。Topic/Thread原子条件写保护终态；真实HTTP发现的本地K=2汇总缺口复用现有finalize修补。

验收：库及服务回归、四表单真实保存/API读回、真实PostgreSQL+HTTP+模型SDK至本地结构化Mock；正常/零分/空/坏JSON/越界/空reason/二值非法值/503/timeout/K2均有证据。有确认可用配置才做少量真实模型调用，当前隔离环境未配置真实供应商。

## 增量二 Python归因

| 选择 | 比较与决定 |
| --- | --- |
| 常驻Python HTTP服务 | 会新增部署与生命周期；本阶段不用 |
| 评分回调reportResult兼存诊断 | 会改变correct/score/status；与诊断失败隔离目标冲突，不用 |
| 直接在runTopic.evalResult增量JSON写 | 与评分/线程回调存在并发覆盖，且重试身份不独立，不用 |
| 复用async_tasks+固定Python子进程 | 使用已有表，无迁移/新队列；存不可变证据快照、版本化任务ID和独立输出，采用此方案 |

入口在现有`agentEvalExternal`增加diagnosisRequest/Get/List/Trace，全部使用真实用户范围。单机CLI取pending/过期lease任务，固定脚本、JSON stdin/stdout，无shell，无.env/模型凭据继承。1MiB/500节点限制明确拒绝，不静默裁证据。

Run/Case/Topic/Thread/Operation/Langfuse Trace保留各自身份。K2逐thread提取，按toolCallId配对，同名不替代身份；source使用持久化结构类型，未知不猜。缺少持久化完整operation事件/Provider请求/TraceID时记录coverage，不能假装有完整因果链。

独立任务ID绑定用户、输入digest和Python代码revision；数据库唯一键去重，原子lease token隔离重试及迟到结果。诊断服务不写评测表、messages或评分回调；失败/超时只改变诊断任务。原纯规则逐函数AST/hash对照复用，stdlib适配不安装pandas、Langfuse或新SDK。

验收：真实DB只读提取、身份隔离、同callId跨case、重复enqueue/worker、进程异常/超时/坏输出、lease恢复、旧attempt迟到无覆盖；真实Agent工具失败落库→真实Python→独立诊断→原评分不变。纯质量失败若无故障证据返回unknown。

## 增量三 证据审核和小规模比较

前两增量整体稳定后启用。首先验证分类/模块词典、原节点存在、字段quote真实；再验证引用是否支持具体命题。事故现象可以有证据，不能直接证明内部模块责任。低证据或自由文本越界声明弃权/复核；保留原错误来源。

比较规则、直接LLM候选与证据约束方案。无可用真实供应商/可靠标注时，先用明确标注的离线模型候选和合成合同案例；记录每例、未提升、错误拒绝、弃权覆盖率，禁止将Mock差异包装成真实模型准确率提升。已有可信脱敏标注再补真实案例，不捏造标注。

## 教学决策记录

每个增量的REPORT/DECISIONS保留：为什么复用现有组件、为什么分开score与diagnosis、错误与业务失败的区别、为什么使用版本化快照/lease/CAS、Unicode与数字序列化为何属于跨语言合同、为什么引用存在仍须审核支持性。后续课程可据真实失败→回归→最小修复→验收顺序逆向构建。
