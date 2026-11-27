# TypeScript 295项诊断：历史对照审计

## 结论

在相同TypeScript 5.9.3、锁定依赖/原有私包存根、tsconfig和Next生成类型环境下，原ZIP源码与冻结的round1源码都产生295项诊断。规范化副本绝对路径后，295项的文件、行列、TS代码和诊断首行完全一致：round1新增0项、消除0项。两次真实tsc均退出2，项目整体类型检查仍未通过。

因此本轮证据支持“这295项在原源和本机当前依赖环境已存在，round1未新增可见类型诊断”。不应称其为295个独立业务Bug，也不代表企业原私包环境必然产生同样诊断；其中一些明确来自本地存根类型不完整。没有以修改断言、放宽tsconfig或把类型错误屏蔽来取得该结论。

## 对照方法与隔离局限

- baseline：从原ZIP逐字节恢复9308个源码/配置/资源文件；只省略先前恢复件中的1948个`.pglite-data`数据文件及既有排除的凭据文件，编译相关源未裁剪。
- round1-snapshot：独立物理复制上述当前文件与5个新增测试，共9313个源文件；不是硬链接。冻结后重新比对当前源，变化0项，见snapshot-freeze-check.json。
- 两份副本各重建805条依赖junction，其中211条指向workspace的链接改指各自副本；422条workspace链接实际解析核对全部匹配。第三方pnpm包存储共享，不做新的安装。
- 两份使用同样4个Next生成类型文件；这是环境上下文，单独记录generated-type-context.json，没有假称这些是ZIP原件。
- 原源和冻结源tsconfig SHA256同为`1e50a70fc6446523aa06933ff90d72a8677c0c9793d57391a9349d7a2f38c259`。使用各自全新的tsBuildInfoFile，不复用旧增量诊断缓存。
- 用`--listFiles`核对真实输入：baseline列出24050个文件，round1列出24055个，差5个新增测试。完整日志与解析清单保留；其中各有3个JS输入另记additional-js-inputs.json。

发现并明确保留的隔离边界：共享第三方依赖中的全局debug覆盖，仍反向引用当前平台`packages/debug/src/index.ts`和`stubs/ctrip-vampire-core/src/index.ts`。两文件在ZIP副本、round1冻结副本、当前平台的hash逐字节相同，见shared-workspace-leak-hashes.json；未观察到其他当前workspace源反向加载。因此此次对照的实际源内容可以比较，但不宣称是完全独立的依赖安装或零跨目录引用。依赖版本差异、生产私包和不同Next生成类型环境的结果尚未验证。

## 真实命令与结果

在两份副本目录分别执行（仅tsBuildInfoFile路径不同）：

```powershell
$env:NODE_OPTIONS='--max-old-space-size=8192'
node node_modules/typescript/bin/tsc --noEmit --pretty false --tsBuildInfoFile <独立审计缓存路径> --listFiles
```

| 输入 | 诊断数 | 实际退出码 | 耗时 |
| --- | --- | --- | --- |
| ZIP原源baseline | 295 | 2 | 218.49秒 |
| round1冻结副本 | 295 | 2 | 220.25秒 |

完整命令、配置hash和结果位于baseline-command.json与round1-snapshot-command.json。可从agent-eval-project目录执行`python local_checks/2026-11-08_phase2/audit/types/run_tsc.py baseline`或`round1-snapshot`复跑。每次上限600秒，原始platform不作为编译输入根。

## 分布

295项涉及116个文件：产品源码229项、测试56项、脚本10项。完整文件与目录分布见round1-summary.json、distributions.json。

| TS代码 | 数量 | 含义 |
| --- | --- | --- |
| TS2339 | 99 | 缺少属性/方法 |
| TS2345 | 63 | 实参与声明类型不符 |
| TS2322 | 39 | 赋值类型不符 |
| TS2554 | 25 | 参数数量不符 |
| TS2353 | 18 | 对象包含未声明字段 |
| TS18046 | 13 | 未收窄unknown |
| 其余18类 | 38 | 详见机器分布 |

集中区域：server/services 65项、主页面routes 59项、discover/social客户端各18项、discover store 15项、database包13项、model-runtime包13项。最大单文件是market/sandboxToolClient.ts的30项，不能因此推断核心评测有30个错误。

## 关键链路的诊断与影响

| 位置 | 诊断 | 判断与后续 |
| --- | --- | --- |
| agentEvalRun服务、agentEval路由、eval-rubric、eval-dataset-parser、agent-runtime包 | 本次完整日志无诊断 | round1关键改动未新增类型报错；仍需运行测试验证业务，不能把0诊断当成全链正确 |
| src/server/modules/ModelRuntime/index.ts:579 | TS2322，凭据apiKey为unknown | 原Tripflow私有凭据路径；Peta存根PetaGatewayResult仅声明baseUrl/token，其余索引是unknown，gateway.apiKey/petaKeyId传播后与ClientSecretPayload不符。该项不直接证明OpenAI Judge调用失败；全库构建仍会受阻 |
| src/server/services/ctripLobehubConfig/getZtripRuntimeOverrides.ts:48 | TS2322，unknown→string | 同一Peta存根契约；真实私包类型未验，不用any消除问题 |
| src/server/services/agentRuntime/hooks/__tests__/HookDispatcher.test.ts:150 | TS2739 | 测试模拟Client只有publishJSON，而本地类型还要求messages/batchJSON；是测试替身契约问题，不能称生产hook回调必败 |
| src/instrumentation.node.ts:17 | 2项TS18046 | vampire存根request回调参数unknown，调试监听直接读method/url。涉及观测初始化，但与已验证的评测逐题回写不同；真实遥测能力未验证 |
| packages/model-runtime providers测试 | 13项 | ada参数签名6项、Tripflow图片输入6项、newapi模拟变量名1项；均在测试，不把它们记为实际Judge错误率 |
| src/services/chat/mecha/contextEngineering.ts:653；src/store/chat/slices/aiChat/actions/streamingExecutor.ts | 1+3项 | UI消息/附件结构与上下文、市场元数据契约漂移。后续涉及附件轨迹时应补接口测试；目前类型错误本身不证明纯文本评测运行失败 |

market Sandbox相关错误与缺失的私有云SDK类型/方法直接相关，例如存根Sandbox没有声明业务客户端调用的完整接口；既有存根运行入口也会主动抛“离线不可用”。其余community/market/discover领域存在较多类型契约漂移，应按真实功能范围单独处理，不能为本轮Judge/归因增量顺手修全库。

按文件名trace筛查未发现直接轨迹模块诊断，不代表已有证据可证明轨迹数据完整、归因证据ID有效或跨任务隔离正确；这些需要增量中的数据库及HTTP行为回归。

## 分类与建议范围

1. **已证明历史可复现**：同环境两次tsc共享的295项，精确差分见quick-diagnostic-diff.json及comparison.json。
2. **round1引入**：本次未观察到新增诊断；15个round1改动/新增文件的诊断匹配记录由comparison.json保存。
3. **未验证**：原企业私包、生产构建、独立重新安装依赖、不同Next生成类型下是否相同；不能称其全部为历史业务代码缺陷。
4. **本阶段建议**：继续聚焦Judge结构与失败分类、只读轨迹提取和证据回链的新增测试。若要交付全库类型通过，再开独立任务按私包存根契约、社区/市场客户端、测试替身、脚本分组清理；不以本次审计扩大实现范围。

此目录保留源码hash清单、生成类型hash、junction映射/核对、原始日志、解析诊断及精确差分；审计没有修改当前platform源码、测试断言或tsconfig。
