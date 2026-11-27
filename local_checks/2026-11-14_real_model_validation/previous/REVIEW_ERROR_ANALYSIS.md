# 审核误接受、误拒与剩余风险

新40例中的三条错误规则观察（fresh-12/13/27）来自嵌套history或业务状态，而顶层执行成功。它们的引用都真实，但不支持当前执行失败。新局部审核拒绝三条，不借用其他字段，也没有将局部见证升级Root Cause。

当前Mock候选已发现的25个正确观察全部保留，FalseGap=0；两条中文自然语言错误没有被增强规则提出，属于发现缺口，不能把它们藏到“审核没有误拒”里。真实LLM是否能提出并可被审核支持，尚未测量。

后验5条诊断探针验证：两个同字段短摘录保留完整顶层执行封装而支持；真实引文但比较值错误被拒；root_cause声明被拒；假引文被拒。它们没有加入40例分数，未用于改规则。旧12例审核输出逐条重现，当前平台原Evidence Review仍未替换。

数据库里missing_call来源不足得到零观察；global complete=false而已配对的显式错误可支持；Shadow超时单独error，原诊断成功。观察、局部支持与needs_review/unknown有明确边界，moduleId/rootCause均null。

## 必要Bug与修复收据

1. 验收脚本对象引用先用JSON.stringify，无法匹配已有Python规范引文；改用现有evidenceText，不放宽“原字段包含摘录”断言。attempt7失败日志与随后成功记录保留。
2. SDK structured-output补max_tokens后沿用旧Content-Length，初期请求中断；统一fetch删除旧长度、重算正文，服务器确认完整消息与800输出上限。两次失败日志、旧预算账本保留，最终10项Provider测试通过。
3. 初期直接await shadow可能把sidecar异常变成原诊断任务error；已复用旧隔离包装器，独立持久化失败。修复前runner源和10场景记录保留，新增5项wrapper测试及第11个数据库超时场景。
4. PostgreSQL启动控制管道继承；隐藏Start-Process、WaitForExit控制进程修复，专用集群重启验证通过。初版脚本和日志保留。

这些均在本轮验收/接入模块内，原平台业务源码未改。Provider/隔离修复未修改已冻结审核规则、Prompt或Gold以提高质量分数。

## 未解决

没有独立人类Gold、真实业务轨迹、根因正例。自然语言/同义字段/单位/真实并发事件顺序等能力未充分覆盖。当前工具来源声明不等于外部世界真值；统计不能证明生产可靠。旧审核继承的assert路径未以Python -O验收。外部真实Provider取消计费、所有供应商响应形状和截断行为未验证。record数据库完全不可用时只能保证原诊断不受影响，不能保证sidecar失败也可持久化。
