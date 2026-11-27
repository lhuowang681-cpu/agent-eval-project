# 验收发现后的限定补修

## K2启动失败最后到达

根因：executeThreadTrajectory的execAgent启动reject分支仅直接写metadata，未触发聚合/最终完成。正常回调先到、最后线程启动失败时run可能一直running；全部线程启动失败同样不终结。

修复：该分支复用recordThreadCompletion(status='error')，allRunDone后调用既有finalizeRun。无新增执行器、调度或存储结构。startup-before.json真实结果2失败/1通过（其余8项按名称跳过）；lifecycle-guard-after.json三种先/后/全失败顺序均通过。

## Run终态重复finalize

根因：orchestrator.finalizeRun仅跳过aborted；completed/failed重复调用再次汇总，duration随Date.now变化；在读取running后与abort竞态也能覆盖aborted。

修复：AgentEvalRunModel仅新增finalizeIfActive（idle/pending/running/external），不改变通用update。orchestrator先对completed/failed返回已有结果，最终CAS仅活跃状态可写，CAS冲突重读保留已完成/中止结果。external后合法评分仍可完成；retry明确切回活跃状态后可重新完成。影响分析finalizeRun LOW7，RunModel HIGH48，主agent向用户告知后解锁。

finalize-before.json：7项中4失败/3通过。修复后lifecycle-guard-after.json共18/18通过（含上述7项与K2完整11项），27.65秒。并发测试让两个finalize都先算好不同时长，再按顺序释放，验证真正CAS，不能只靠初始状态判断；另覆盖计算期间abort。

## DatasetEditModal真实页面回归

根因：本轮移除旧Judge字段时错误删除仍被数据集名称输入框使用的Input import，导致Edit页面ReferenceError。这是本轮新增回归；前面的纯helper测试没有渲染组件，不能替代UI验收。

修复：恢复@lobehub/ui Input import，逐个核查四个modal的Input/TextArea引用；judgeLifecycle测试数组补string[]修复本轮类型诊断（不改断言）。新增JudgeModals.render.test.tsx执行四个真实modal组件，用UI primitives替身隔离外部组件；未绑定JSX标识符仍会触发错误，4/4通过（modal-render.json，6.07秒）。完整真实页面复验由主agent保存在ui/；此测试不能代替完整浏览器操作。

## 最后回归

此前final-after-k2.json 147/147通过；本文件追加两处限定修复及渲染后，final-lifecycle-regression.json重新执行完整服务/配置组，157/157通过，17文件，175.06秒。旧失败、旧通过记录全部保留，不覆盖。
