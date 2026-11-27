# 回归与执行总账

| 范围 | 本轮真实结果 | 证据 |
| --- | --- | --- |
| 指标测试 | 4通过 | quality-tests.log、new-quality4.log |
| System VNext Python | 14通过 | previous14.log |
| 第二轮Shadow Python | 18通过 | previous18.log |
| 原始Shadow Python | 15通过（在原版） | previous15.log |
| 原平台Python诊断 | 36通过 | originalPython36.log |
| 原评分+归因TS子树 | 225/225，21文件 | ts-regression.json、ts-score-and-attribution.log |
| ModelRuntime HTTP Mock+Python审核 | 10项通过，最终套件7个localhost请求 | provider-test.json、provider-test-final.log |
| Provider配置边界 | 4通过，零网络 | provider-config4.log |
| 隔离runner | 5通过 | runner-tests.log |
| 真实PG/tRPC/Worker | 11场景通过，含2个通过轨迹策略跳过 | postgres-e2e.json、postgres-e2e-isolation-final.log |
| 后验审核探针/历史重现 | 5探针、12旧判决一致 | review-probes.json |

测试计数按各范围实际执行，不把多轮重复跑、样本与测试项相加声称总覆盖率。225项包括原归因71和评分服务子树，不等于历史945全量。原Shadow15换新约束曾有3项旧假设不适配，历史记录仍在快照，本轮没有改旧断言去凑全过。

未运行：浏览器登录/UI、HTTP会话身份链、新Agent Runtime真实模型任务、全库TS类型检查、历史945全量、真实供应商请求和真实模型效果。部分历史源码是导出目录无.git，Git状态/worktree信息无法验证；用Hash检查当前平台与上一轮文件未变，不声称没有未提交改动。

PG基于真实PostgreSQL16.15独立集群，107迁移应用、2个BM25缺依赖迁移跳过。测试期间保留所有准备失败；Node进程用真实实现路径兼容层和Markdown原文加载，不Mock数据库/路由/诊断服务，但仍有项目既有私有依赖stub。最终库已停止，未删除数据。

ModelRuntime Mock初次超时测试引发本机HTTP服务器ECONNRESET未捕获，已修复测试服务器对预期连接中断的处理；没有关闭真实超时断言。全部本机预算账本记录18次请求尝试含准备失败/重复验收；新增付费请求0。Mock Token字段不是实测消耗。

真实PG验证原评分、Judge预置元数据、Run终态与消息不变；真实外部LLM Judge未再次运行。所有日志、执行命令和退出码见regression.json。原平台核心和完整上一轮Hash在BASELINE.json，最终校验收据随交付。
