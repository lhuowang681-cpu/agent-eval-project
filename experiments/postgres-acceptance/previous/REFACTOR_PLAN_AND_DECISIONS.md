# 分阶段方案与决定

| Phase | 问题证据 | 方案 / 文件 | 验证 / 状态 |
| --- | --- | --- | --- |
| 0 | 平台无.git；存在新旧Shadow及不完整片段 | phases/0-baseline.json，baseline完整副本；只读审计 | 18+15+36+71相关测试通过，13活跃文件冻结 |
| 1 | 旧审核全局coverage、整节点分类、摘要白名单；同字段短摘录历史退步 | phases/1-design.md先写测试，vnext/review.py新合同 | 六条开发测试，冻结12例，局部4/4接受；不推广默认 |
| 2 | 语义原型脱离平台执行器，真实增量未证实 | vnext/provider,pipeline.py；integration runner/demo/test | 原runPython→sidecar真实代码联调；6个TS隔离测试；48旧例Mock回归 |
| 3 | Signature混工具、max severity支配全组 | grouping.py独立事件/模式统计；experiments.py调用真实旧converge对照 | 103原始/102去重事件、旧1组新3组，根因全部未知 |
| 4 | 活跃/历史/归档混淆，无法证明可删除 | ARCHITECTURE地图、接口复用、只隔离新模块 | 不移动历史，不删原文件；以边界而非目录整洁改行为 |
| 5 | 需要联调和真实范围披露 | results/ts-platform-demo，回归总账与最终决定 | 接口联调通过；真实PG Run/UI、新模型、独立人类验收未重跑 |

取舍：不直接改旧Evidence Review合同，避免旧诊断Schema/DB/API兼容风险；新sidecar分五维证据状态。不是简单删除coverage：它仍记录全局因果条件，任何root/module都不能通过。仅局部观察独立判断。

不用通用LLM重判替代证据；复用第二轮参数闭集与双向Call/Result检查，已知八条自然语言误拒不掩盖。模型Provider注入，不读取历史脚本dotenv、Key和默认供应商。默认关闭，通过runner选项显式实例化；尚未向现有路由增加配置入口。

归并保留TF-IDF类medoid，不引入Embedding/LLM聚类。旧算法实际调用作为Baseline，不用重写近似旧输出取代旧版。新模式按更多上下文字段保守拆分，不宣称根因纯度提高；数值优先级权重未校准，先交付分布与源码/业务稳定性两类行动建议。

单作者开发和新合同集在源码冻结后运行，不能称独立盲测。48例为历史回归，第三轮28例未冒充新集。没有独立人类/真实脱敏业务Gold；对应质量推广停止，不强改到通过。
