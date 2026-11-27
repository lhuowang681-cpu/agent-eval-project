# 增量1合同与边界

1. 保留原平台、ModelRuntime、评分库、RunTopic/Thread JSON结果及编排。没有新增数据库表/迁移、模型供应商、Python Judge、队列或自动重试。
2. llm-rubric与answer-relevance都发送Question、Expected（存在时）、Actual、Criteria；已有choices/category显式传入。answer-relevance继续严格二值；llm-rubric允许0–1连续分。
3. 显式criteria优先；旧judgePrompt作为criteria别名兼容。model/provider必须由用户显式选择，没有默认付费模型。四个模态共用Judge字段，不再通过judgePrompt决定整份配置是否保存。
4. TestCase evalConfig仍整份覆盖Dataset evalConfig，不悄悄逐字段继承；单独配置需包含model/provider，错误明确judge_config。规则模式覆盖语义不变。
5. timeoutMs为整数100–60000，默认60000，API和服务边界校验。Promise.race提供返回时限，AbortController请求取消，初始化纳入期限；初始化迟到不会再开始模型请求；race注册的rejection handler处理迟到失败。具体供应商远端是否停止计算/计费不在本地保证内。
6. 合法0分是正常failed；空/非法JSON、空reason、非finite/越界分、binary非0/1都是error。纯评分库旧clamp兼容合同保留；平台adapter严格拒绝。scoringSource表示配置的评分来源rule/llm，rubricScores和threads也保留来源；程序产生errorCode，模型reason原样保留，不把模型文字当错误分类。
7. 新错误代码：judge_config、judge_timeout、judge_parse、judge_invalid_result、judge_provider、evaluation_config。旧JSON结果字段全部可选兼容，不要求迁移历史行。
8. 只在本模块评分/telemetry/聚合点调用updateIfUnfinished，已passed/failed/error/timeout/external不被迟到写入替换；原updateByRunAndTopic保留。线程结果使用短事务，锁顺序RunTopic→Thread，不在模型IO期间持锁，重复completedAt不替换。
9. pass@k保持原语义：至少一线程通过则Topic通过；一个线程通过加另一个Judge错误时，Topic通过、线程错误明细保留。没有任何通过且含错误时Topic error。没有把topic errorCases偷改成thread错误数。
10. Offline Mock按模型名逐请求决定，不切换全局scenario。mock-judge-valid/zero/empty/invalid-json/out-of-range/error/timeout/empty-reason/binary-half；必须是真实json_schema请求且含问题/输出/标准。stats只保留最多1000条模型名与context存在性布尔，不保存正文/凭据。它验证工程链路，不宣称Judge语义质量。
11. 真实供应商当前未验证：只查当前process变量名存在性，未读取凭据、未查key vault、未发付费调用。HTTP/PostgreSQL/UI验收由主任务单独执行，本目录单元/服务回归不能替代。
12. 真实验收后补run级finalize CAS：completed/failed/aborted不得被重复finalize改变metrics或duration；external、idle、pending、running保持可合法完成，retry先重新激活。通用update默认语义不变。K2 local hook及startup failure都走既有聚合和finalize，不新增编排。

## 影响检查

审计目录保存逐项upstream impact。共享EvalConfig/EvalRunTopicResult被图标为CRITICAL1064；match、matchLLMRubric、matchLLMEq、evaluate以及RunTopicModel为HIGH。主agent在解锁前已向用户告知；仅可选字段追加、兼容旧接口和局部新方法。Modal图UNKNOWN，结合文件调用位置静态核查，不认为0就无影响。旧图是原ZIP索引下界，不含第一阶段evaluateOutput或本轮新增函数；其直接caller已静态核实并分析原评分方法。没有提交。
