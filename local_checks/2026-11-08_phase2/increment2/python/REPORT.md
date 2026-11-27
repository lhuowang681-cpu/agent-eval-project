# 增量2 Python适配验收

15/15回归通过，14个现有规则类别均有兼容样例；原纯函数AST与round1来源一致，来源hash校验通过。新入口platform/scripts/eval-attribution/adapter.py只用标准库，不改原件、不读取.env、不调用网络/LLM。

固定JSON stdin/stdout、最大1MiB/500nodes，echo trajectoryId/inputDigest/scope/coverage。正常stdout单JSON；无失败信号unknown，unknown工具来源不判外部，显式失败仅形成观察和needs_review，不写原score。错误字段quote取真实节点error而非生成envelope。

本机默认anaconda shim会向stderr写路径环境警告，首个stdio安静断言因环境失败；固定bundled Python后15项全绿，日志在regression.log。不要将其算成业务修复。results.json记录本阶段文件hash，后续增量3另存测试证据。

仅证明离线适配合同与规则兼容，尚不证明TS异步任务/数据库导出/页面/LLM语义准确率；跨语言集成由主流程独立验收。
