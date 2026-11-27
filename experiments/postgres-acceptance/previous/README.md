# System VNext 2026-11-14

先读ARCHITECTURE_VNEXT和FINAL_PROMOTION_DECISION。默认平台未改；这是独立可选runner包装器/sidecar及离线分析的增量包，**不是完整平台或已经上线的改造**。

八份交付报告对应架构、决策、证据、语义、归并、测试、回滚与推广。phases/按阶段冻结设计与输入，results/保存真实输出；baseline/为上一轮完整快照，历史不可覆盖。默认没有模型供应商或Key。

本机目录为`local_checks/2026-11-14_system_vnext`。Python3.10+，普通模式，禁止将继承assert检查的原型以-O当生产安全边界。

```powershell
python -B -m unittest test_review test_system
Get-Content results/demo-input.json -Raw | python -B sidecar.py
python -B verify.py
```

sidecar接收原Trajectory或{trajectory,config,mockCandidate}，只输出新sidecar。enabled省略为关闭；开启还必须显式指定model/maxCalls/maxTokens/timeout/origin及Provider。CLI仅允许显式Mock，没有真实付费Adapter。真实用户数据不得借synthetic标志直接外发，现隐私正则不是完整脱敏系统。

原平台测试`python -B checks.py final`需完整平台node_modules；只写新results。TS演示从实际平台cwd执行：

```powershell
node node_modules/tsx/dist/cli.mjs ../../2026-11-14_system_vnext/integration/test.ts
```

demo.ts另接收输入JSON路径、输出路径、Python解释器三个参数；需配置EVAL_ATTRIBUTION_PYTHON供原runPython使用。已执行收据为results/ts-platform-demo.json。它验证真实代码接口，未创建PG Run。

`experiments.py`离线重放12合同/48旧例及分组，需原source-reference/cause_convergence.py和已有numpy；不安装新依赖、不调用模型。只需看结果无需这些依赖。grouping.analyze本身纯标准库，分组不入数据库。

完整模型质量、真实PG/UI及独立语义验收尚缺，不推广。停止调用新目录即关闭，无DB迁移。交付验证会比对冻结源码、基线和新算法Hash，并扫描高熵Key样式；不等于全面安全认证。
