# 平台、测评与接口：本机测试及完善工作量

日期：2026-11-08。目标：评估“配置Agent→测试运行→评测归因→报告→修改后重测”的可实现程度。本轮测试与诊断，不修改业务功能。

## 结论先行

原始平台有较成熟的Agent运行和内置评测基础，不能把当前学习包的零散片段当作全部工程。内置配置、评测数据模型、运行服务和接口已经有实现，不应重写整个大平台。新增重点是独立归因工具接入、LLM judge实际启用、异常处理和可重复环境；完整页面操作、真实模型质量及生产级部署尚未验收。

“平台端和测评端都有70%”没有统一分母，不能据测试数量给精确百分比。598/602是本次选定原始测试的执行结果，不是项目99%完整度，也不是全部代码覆盖率。以下按目标功能和证据分层判断。

## 一、范围、环境与原件保护

- 从原ZIP恢复11256个文件到本报告目录下platform/；排除.env、包仓库凭据、缓存及部分数据/大文件，共33个排除条目，见extraction.json。
- Node v24.19.0、pnpm按项目声明使用10.33.4；frozen-lockfile安装成功，约6分38秒。锁定解析约3909项，不能以依赖数量衡量业务成熟度。
- 禁止安装生命周期脚本。使用原项目已有8个私有包替身，不访问企业包仓库。生产QStash/QWorkflow、云沙箱、私有模型Provider等真实行为不在验证范围。
- 本机约32GB内存、16逻辑CPU，无需GPU完成本轮路径。模型用原项目本机Mock HTTP服务，另有明确标记的服务执行替身；不测真实LLM任务质量或费用。
- 数据库单元/集成测试使用原PGlite测试实现。启动使用PGlite Socket：107项迁移执行、2项BM25/pg_search迁移跳过，共110张表。不是生产PostgreSQL/Redis并发测试。
- 原始ZIP不改；恢复的11256文件逐字节与ZIP比较无差异，原96参考文件hash也未改变。Next生成的.next、测试产物和node_modules不属于原始源码。
- 测试以运行所需的最小环境启动，没有加载原.env或真实API密钥。服务只绑定127.0.0.1，创建合成用户及RBAC；内部JWT用临时测试密钥。所启后台进程在各轮结束时关闭。
- 原AGENTS要求的GitNexus查询工具本会话不可用，使用直接源码/调用点核对；没有编辑原工程业务函数、类或方法，没有提交。

## 二、实际执行结果

| 原始测试组 | 通过/总数 | 环境与结果 |
| --- | --- | --- |
| Agent Runtime | 254/258 | 原包Vitest配置，4项压缩阈值预期漂移 |
| 评分rubric | 73/73 | 规则和注入式Mock judge的库级测试，不证明服务已接真实judge |
| 数据集解析 | 16/16 | 原版CSV/JSON/JSONL/XLSX解析测试，XLSX使用项目指定0.20.3 |
| 评测数据库模型 | 132/132 | 原PGlite测试数据库，5个模型测试文件 |
| 评测运行服务 | 69/69 | 原PGlite与现有Mock，含完成回写、超时、线程、重试/生命周期等 |
| 评测路由/工作流集成 | 54/54 | 原2个集成测试文件，PGlite/Mock；不等于真实HTTP所有路径 |
| 合计（去掉首轮重叠测试） | 598/602 | 不是全库测试通过率或完整度 |

补充测试：

1. **原始HTTP冒烟27/27通过**。默认Turbopack＋PGlite Socket＋本机Mock模型/工具＋合成S3配置。验证健康、开发态认证/无认证拒绝、内置Agent、topic/消息落库、createOperation、实际Runtime推进、SSE正文及结束事件、真实本地计算器工具调用、最后done状态。证据：logs/api-smoke-api-configured.log、results/startup-api-configured.json。这里的模型是替身，Agent执行框架/HTTP/数据库并未整体替换。
2. **新增三题服务层闭环1项通过**。实际解析/模型/评测服务/规则评分/完成回调，AiAgentService.execAgent是明确的执行替身。V1两题通过、一题失败；保存V2配置后另建run，三题通过；两轮agentSnapshot分别保留v1/v2。它验证版本、回写和比较机制，不是模型优化效果。证据：results/three-case-flow-detail.json和tooling/flow.test.ts。
3. **5项新增边界复现全部触发预期异常行为**，不是5项业务质量通过，见下文。
4. **已有CPU归因实测**：原JSONL入口、去噪、收敛/medoid及聚合绘图跑通；1000条短合成记录约1.05秒，含启动。另复现空结果、坏行、无关恢复3项问题。详见[CPU报告](../2026-11-08_cpu_smoke/REPORT.md)。

所有原始Vitest机器结果在results/*-original.json，命令与耗时在对应*-command.json，日志在logs/。audit-summary.json保留计数、失败测试名和原件比较结果。

## 三、启动与自动运行的阻塞，不混作业务缺陷

| 尝试 | 实测结果 | 判断 |
| --- | --- | --- |
| 手动指定Webpack | Markdown Skill加载缺规则，后续触及本轮4GB堆上限 | 项目仅在Turbopack配置了md loader；该模式不作为默认启动故障结论，资源上限也需单列 |
| 项目默认Turbopack | Ready约25.5秒，PGlite和合成用户建立成功 | 开发服务可启动；该时间不是生产性能指标 |
| 请求首页和/eval | 最终返回登录页HTTP 200，日志有signin重定向 | 登录页可响应，不能说评测页面已完成浏览器验收 |
| 第一次真实HTTP冒烟 | 健康、认证、内置Agent和topic成功；发送文本时S3环境缺失报错 | 纯文本聊天也会初始化FileService；属配置耦合。补合成本机S3配置后27/27通过，不等于真实文件存储已验证 |
| 自动三题HTTP评测 | 成功创建题目/run并启动真实Agent；轮询时PGlite Socket报bind参数数量、portal等协议错误，HTTP 500，中止 | 本地替代数据库的多连接/协议限制，未认定为真实PostgreSQL下的业务代码缺陷；该路径尚未通过 |

自动三题HTTP路径已使用临时JWKS和明确INTERNAL_APP_URL，不把缺JWT配置当业务缺失。证据：http_eval.py、results/http-three-case-eval.json、logs/next-startup-api-eval.log。此轮并非全闭环通过，也没有完成第二轮HTTP重测；服务层两轮对照已通过。

后续优先用真实本地PostgreSQL（或经验证的单连接诊断环境）复测该批量路径，再讨论并发。当前没有安装Docker/独立PostgreSQL/Redis，不以PGlite结果推断生产吞吐、锁或多实例可靠性。

## 四、代码不完善之处

### P1：LLM评分在服务链中缺少judge上下文

src/server/services/agentEvalRun/index.ts在evaluateThread和evaluateCase中调用evaluate时只传passThreshold，没有matchContext.generateObject。库matchLLMRubric没有该上下文就返回score=0、passed=false、reason=LLM judge not available。

本轮新增服务层三题都提供正确答案，切换dataset.evalMode为llm-rubric后，三题仍全部failed，原因均为judge不可用。证据：results/three-case-flow-detail.json的judgeRun。它不是实际模型答错，而是能力未接入；把基础设施不可用算成答错会污染结果。

建议：注入可控judge适配器，区分judge_error/待复核与任务答错；加入超时、调用失败、非法分数和结构校验。库级Mock judge测试通过不能代替此服务集成验收。

### P1/P2：评分输入缺少必要的防护

tooling/audit-boundaries.test.ts对原函数直接复现：

| 行为 | 源码位置 | 风险与建议 |
| --- | --- | --- |
| expected为字符串[]时空候选reduce抛错 | packages/eval-rubric/src/evaluate.ts | 空候选应定义合法失败/配置错误，不能无保护抛出。服务虽捕获部分异常，仍需定义题目状态/诊断 |
| regex模式[引发SyntaxError | matchers/regex.ts | 配置保存时预编译校验，运行时逐题隔离 |
| numeric把1e3清洗成13，并错误匹配expected=13 | matchers/numeric.ts | 数值提取不应破坏科学计数法；明确严格数值和文本提取合同 |
| 负权重产生score=2 | evaluate.ts | weight、threshold、score应校验范围；createBenchmark目前rubrics接受z.any，不能只依赖前端 |
| JSONL先移除空行，错误实际在第3行却报告第2行 | eval-dataset-parser/src/parsers/jsonl.ts | 保留原始行号，提高导入定位准确性 |

这些是库/入口边界，不据此声称每个正常评测都会失败。原有正常样例大多通过，新增检查用于补充其盲区。

### P2：压缩策略、文档和测试漂移

packages/agent-runtime/src/utils/tokenCounter.ts实际DEFAULT_THRESHOLD_RATIO=0.65，附近注释仍写50%，接口说明还写0.75；4个测试仍按0.5断言。已用原包配置重复得到同样4项失败。

建议先确定产品策略再同步注释/测试；不能为了全绿把实现随意改回0.5，也不能把这4项直接称为运行引擎整体失效。

### P1/P2：独立Python归因的3项已实测问题

- 全成功输入产生无列DataFrame，CLI访问actionability报KeyError。
- 非法JSON行未隔离，整批中断。
- 后续无关工具成功被标为原任务恢复。

文件：source-reference/attribution/structured_jsonl_attribution.py。处理完还需明确事件/任务/Session统计口径；恢复要绑定原目标，未知不得当已恢复。

### 待验证的实现边界

- 独立归因normalize_result的证据ID有效性和责任语义仍欠严格；本轮只静态核对，不宣称已测其真实模型准确率。
- dataset/benchmark评分规则变更如何影响历史run，需要独立快照/版本验证；agentSnapshot已实际存在且通过本轮保存测试，不能再将其一概列为缺失。
- 多线程完成、重复回调和并发最终聚合在本地Mock测试有覆盖，仍需真实PG/Redis和持久队列的故障注入。
- 源码中存在Langfuse配置/trace设施；评测服务也有external接口，但不能据此认定已与外部Python诊断脚本自动连通。

## 五、三个模块的完整度判断

| 模块 | 已有且本轮支持的能力 | 缺口/未验收 | 判断 |
| --- | --- | --- | --- |
| 平台端 | 按锁安装、默认开发服务启动、数据迁移与用户、配置持久化/快照、HTTP Agent纯文本/工具/SSE闭环 | 正常登录后页面完整操作、真实外部工具和模型、真实PG/Redis、生产构建/部署/权限全面验收 | 主体已有且核心本地可运行；不需要重新开发整个平台 |
| 测评端（内置） | 多格式解析、确定性规则、数据模型、创建run、完成回写/超时/重试、线程聚合测试、服务层两版对照 | LLM judge服务缺上下文，若干边界评分问题，真实模型质量与UI验收 | 规则评测链较完善；“支持LLM评测”不能只看枚举和库函数 |
| 测评端（独立归因） | CPU规则分析、去噪、收敛、统计及图表 | 3个实测缺陷、严格证据门禁、标注与真实语义评测 | 可复用分析原型，尚非可信自动归因产品 |
| 中间接口/编排 | 内置tRPC、异步调用、回调与external结果回写源码；原54项集成测试通过；真实Agent API27项通过 | 自动HTTP批量评测受PGlite阻塞；外接Python归因的字段适配、身份回链、触发/回写及失败策略未完成验收 | 内置连接已有；外部归因桥接是主要新增工程，不能把两者都说成空白 |

按目标功能的验收卡：

- 已验证（有条件）：本机启动与API、配置保存和agentSnapshot、实际Runtime/工具/SSE（Mock模型）、规则评测、服务层报告数据及改配置重测。
- 部分验证：自动测试编排（原集成通过，真实HTTP批量受替代DB阻塞）、报告查看（JSON/服务通过，登录后页面未测）。
- 明确待完善：服务链LLM judge、评分和归因边界、独立归因自动桥接及验证集。
- 未验证：真实LLM质量、生产数据库/队列并发、真实对象存储、完整UI操作和生产构建。

## 六、完善工作量：按范围估算，不用百分比包装

下面为一名熟悉TS/Python工程师的有效人日，约6小时/人日；不是日历承诺，不含学习者补基础的时间、等凭据或审批。基于本轮证据仍需预留未知，取得真实PG/Redis与模型接口后应重新估算。

| 工作包 | 预估人日 | 可验收产物 |
| --- | --- | --- |
| 可重复本地环境、S3/JWKS/内部URL说明、真PG复测 | 1—3 | 一套命令恢复；自动三题HTTP批量不再靠PGlite推断 |
| 修复评分/解析/归因边界及压缩策略漂移 | 2—4 | 新旧回归均有明确预期，judge不可用不计成任务答错 |
| 接通LLM judge并做受控验证 | 2—4 | 服务级适配、预算/超时/结构与分数校验；Mock与真实模型证据分开 |
| 外部归因接口与统一身份/结果回链 | 3—6 | 测试run→真实轨迹导出→Python分析→证据/候选回写，异常可见 |
| 页面链路及配置/数据版本对照验收 | 2—4 | 登录后配置/发测/报告/重测；稳定显示变化与未知 |
| 固定样例、基线对照和错误分析 | 2—4 | 数据范围/人工预期/指标分母/错误Case，真实效果不靠展示几条样例 |

分阶段目标：

1. **规则评测的单用户面试演示版：约5—9人日。**复用原平台及内置评测，优先本地环境、必要边界、UI和规则重测。暂不承诺独立语义归因和生产多租户。
2. **加可信归因桥接与LLM judge、形成可讲的个人改进：整体约12—25人日。**上表有工作可并行/复用，不机械求和；范围以明确支持的一类Agent/工具和有限问题机制为起点，全部56模块的高质量归因不在此估计。
3. **企业级多用户上线：当前不能可靠估算。**需补齐真实私包/认证/对象存储/PG/Redis/持久工作流、权限和故障注入，不能用本轮替身测试套一个百分比。

建议优先级：先真PG复测自动评测，再修评分错误分类与边界；保留成熟平台核心，随后以“独立归因桥接＋证据校验＋回归实验”形成个人贡献，不先重写平台。

## 七、重复方法与遗留项

- 完整安装记录：logs/full-install.log；原包只读恢复元数据：extraction.json。
- 原始测试命令：results/*-command.json；先运行局部组，不跑全库大测试。
- 新边界：tooling/audit-boundaries.test.ts；三题服务闭环：tooling/flow.test.ts。
- 启动/API：probe_startup.py，依次记录webpack、turbopack、api、api-configured、api-eval条件；所有结果保留，不能只挑成功一轮。
- UI HTTP 200曾跟随登录重定向；没有浏览器点击验收。不存在“评测页面测试已全通过”的结论。
- HTTP三题用真实Runtime＋Mock模型但未通过；服务层三题用执行替身且已通过，两份结果不能互相替代。
- 未修复任何业务代码。后续修复应建立单独变更及回归记录，不能把测试夹具补配置算成平台产品修复。
