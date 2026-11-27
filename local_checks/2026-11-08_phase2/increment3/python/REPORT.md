# 增量3正式激活后的组件验证

启用依据：phase2/INCREMENT_GATES.json记录increment1/2验收及increment3AllowedToActivate=true；正式门禁时间2026-11-08T09:19:16.741661+00:00。门禁之前staged及旧review-regression/all-regression日志只作为准备过程，未冒算正式通过。

本轮正式结果：Python36/36，包含原15项及21项审核/stdio回归；原TS↔Python42/42，局部strict tsc退出0。机器摘要及源码hash在formal-results.json；真实Python日志formal-regression.log；TS日志和机器结果在../ts-bridge/。

新增平台固定程序evidence_review.py/review_cli.py；adapter保留纯analyze，新增analyze_reviewed供main调用。独立review_cli接受固定envelope，保留sourceDigest/scope，只给规约safeCandidate或null。未调用网络、dotenv、LLM，未写TS业务代码或新UI。

通过范围包括：引用真实存在却不能支持root cause、伪造ID/quote、跨scope声明、非法模块/类别/状态、覆盖真实error_type/工具来源、缺证据根因声明、unknown来源、自由摘要偷换因果、源coverage不完整、source与原评分不变、保留原observations、不将needs_review升级resolved、拒绝候选时不透传非法字段、真实review_cli单JSON输出及坏/大输入安全错误。

审核通过只说明明确事故观察可核查，不说明上游根因责任已得到证明。root_cause责任当前一律保守insufficient，safeCandidate仍needs_review/moduleId=null。自由摘要只接受规则模板，可能拒绝正确但未机械验证的语义候选；这项限制需要在对比实验中公开，不能称语义准确率改善。

TS桥接回归唯一更新是阶段2的“结果不带review”断言；按正式新功能改为检查existence valid/support supported具体结构，其他边界断言不变。未为通过测试放松校验。新功能需导致engine revision改变，engine-version.json已记录新版本和hash。

复现：在platform目录用固定Python执行 `-B -m unittest discover -s scripts/eval-attribution -p 'test_*.py' -v`；TS配置仍用increment2/bridge-tests/vitest.config.mts，但reporter输出重定向到increment3/ts-bridge，保留阶段2原件。完整三方案模型/规则/审核对比由主流程单独执行，本报告不声称该实验已经完成，也不声称真实供应商模型通过。
