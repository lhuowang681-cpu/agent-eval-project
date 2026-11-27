write('00_阅读指南.md', '''# 阅读指南：当前工程版教学蓝图

版本：2026-11-08。用途是交给新对话逐节互动教学，当前只制作课程，不代表已授课。V0—V9是教学模拟的开发顺序，不是原作者Git历史。

这个项目现在包括：已有Agent工作空间中的评测主链、已接入的单机Python诊断，以及独立的旧归因/报表参考与质量实验。旧学习包的“桥接尚未实现”已经过时，本包按当前默认源码重新核对。第三轮候选没有推广，默认审核已恢复第二阶段版本。

## 先读哪些

1. 读01建立用户、输入输出、8个核心模块及三条实际路线的全景。
2. 读02的版本总览，然后由网页端按V0→V9展开；主要单元60—90分钟，复杂点可分两次，不为每个基础定义单独停课提问。
3. 03是证据和A级深入路线，随当前单元选2—3个关键位置核对，不要求通读源码。
4. 05先划清事实、模拟和实验边界；06可直接交给接手教师。
5. 07记录真实学习和验收，初始全部未开始。V9后用04做项目讲述、追问和闭卷重建。
6. 08列出精简源码副本及分单元上传清单；09是脱离旧日志也能理解的实验事实卡。

建议首轮10个单元约10—15小时，只是教学主线；A级深化和复述通常还需额外时间，不能把课时预算当掌握证明。有20分钟就完成一个设计片段，有60分钟走通一段，有90分钟再加源码/验收。不要求每天5小时，也不因中断就从总介绍重讲。

## 四种事实标签

- **真实实现**：当前默认源码能定位的行为。函数/字段存在不等于所有入口都会调用。
- **模拟推演**：为理解需求而构造的V0、故障情境、替代设计，不冒充开发事故或真实历史。
- **真实实验**：有保存的执行结果；必须同时说清Mock、PGlite/真实PG、合成标签及验证范围。
- **尚未核实**：缺真实供应商、完整轨迹、可信gold或生产验证，明确留空。

每单元的G节会把已有实验与尚未执行的学习练习分开。作业是流程图、合同、算例、决策卡或复述，不以重写庞大平台作为前提。

## 网页端交接

把study_pack.zip作为课程资料交给能读取文件的新对话。如果当前界面不能读取ZIP，先解压，上传00、01、02、05、06、07；03、04及本单元源码按需补充。新对话不能凭本机路径访问源码，没收到文件就明确说未核对。复制06末尾的启动文本即可，不用重新规划课程。

包内index.html是离线跳转阅读入口，文档和源码链接无需网络；它是蓝图阅读器，不自动记录掌握度。跨电脑带整个ZIP或解压目录，Markdown/HTML都可阅读。进度以07及LEARNING_PROGRESS.json手动回传，不承诺跨对话自动记忆。

本包不含.env、真实凭据、用户历史报表、模型权重、依赖或大日志；key_sources是教学只读副本，不是完整可部署工程，不运行旧入口来“验证读过”。旧版study_pack另存档，旧学习记录未覆盖。
''')

modules=[
 ('M1','评测资产与配置','Benchmark/Dataset/Case、Run、Agent配置审计','P01 P03 P04','B；可复现边界为A'),
 ('M2','执行编排与生命周期','启动、分页/并发、K线程、超时/取消、终态聚合','P02 P09 P11 P16 P17','A'),
 ('M3','被测Agent运行时','Brain→指令→Runtime/Executor→模型/工具→消息','P05 P06 P07 P08','A；预算细节B'),
 ('M4','规则与LLM评分','任务/标准上下文、加权、结构化分数、评分器错误','P12 P13 P14 P15','A'),
 ('M5','轨迹与证据合同','Run/Case/Thread所属、原message、工具配对、coverage','B02 B03','A'),
 ('M6','跨语言诊断任务','显式请求、async_tasks、固定Python进程、版本与lease','B01 B04 B05 B06 B07','A'),
 ('M7','故障观察与证据审核','失败封装、类别、存在性/支持性、根因边界与弃权','B07 B08 L04 L05','A'),
 ('M8','报告与质量研究','平台指标、旧离线排序/选样、独立标签与五组消融','P18 L06 L07 L08 L09 L10 L11 R01 R02','质量A；旧报表B'),
]
maptext='''# 项目全景地图

## 项目究竟做什么

它面向开发和调试Agent的人：配置/选择被测Agent及测试题，执行任务并评分、查看结果，再对失败执行显式请求轨迹诊断，获得带原始身份、引文和审核状态的故障观察，辅助修改后重新评测。

它是**应用评测平台＋诊断研究的混合工程**。平台承载可配置Agent；Python诊断器分析执行记录；旧Langfuse/JSONL/Excel脚本是另外的分析路线。没有证据表明所有旧脚本已经统一成一个自动产品。

输入包括task、expected、rubric、Agent/provider/model配置和实际执行消息；输出包括Case分数/状态、Run指标、独立diagnosis/observations/review。当前能力重心是故障观察与保守审核，不是已经证明准确的内部根因定位。

当前执行主链读取平台自己保存的Agent配置；agentEvalExternal提供外部评分/诊断扩展，不能据此说“任意外部部署Agent都有通用自动接入协议”。这个范围和归因系统分析已有Trace的研究目标需要区分。

## 实际业务链路

```mermaid
flowchart TD
 A[登录并配置Agent/测试集] --> B[创建Run与pending题目]
 B --> C[启动有界批量与K条轨迹]
 C --> D[Agent Brain / Runtime / Executor]
 D --> E[模型与工具执行]
 E --> F[保存messages与plugin error]
 D --> G[完成或超时钩子]
 G --> H[规则Judge或配置的LLM Judge]
 H --> I[条件回写Case/Thread并聚合Run]
 I --> J[查看评测报告 / 修改后新建运行]
 F --> K[显式diagnosisRequest或CLI]
 I --> K
 K --> L[按Run/Case/Thread提取轨迹]
 L --> M[独立async_tasks与批处理worker]
 M --> N[固定Python规则观察与审核]
 N --> O[关联原身份的诊断查询 / review与coverage]
```

文本替代：配置→创建→执行→保存→评分→报告→重测；诊断支线需显式请求并运行worker。当前没有自动把所有失败评分回调转成Python任务，也未新增完整的诊断专用UI。诊断API/CLI与评测结果页不是同一个已验证页面能力。

## 核心模块：8个教学职责

这8个模块是学习视角的职责拆解，不是8个独立部署服务。

| 模块 | 职责 | 关键证据 | 重点 |
| --- | --- | --- | --- |
'''
for identifier,title,role,refs,level in modules:
    maptext+=f'| {identifier} {title} | {role} | {ev(*refs.split())} | {level} |\n'
maptext+='''
## 必须区分的三条路线

| 路线 | 输入/入口 | 实际产物及边界 |
| --- | --- | --- |
| 当前平台 | agentEval创建/运行/报告；agentEvalExternal诊断扩展 | Agent执行/评分闭环与独立Python观察；使用本机DB消息合同 |
| 旧模型分析 | badcase_analysis.run_pipeline | 拉取或缓存→可选去噪→LLM分类→聚合/报表；offline不保证不调用模型，未统一必经严格validator |
| 旧规则/报表 | structured_jsonl_attribution及多份日报/选样脚本 | 独立JSONL扫描及离线表格，不能自动挂到当前平台每个结果上 |

review_cli.safeCandidate是单独白名单输出；adapter主链即使review不支持仍保留规则诊断/观察并附复核标志。因此“实验完整审核组0安全输出”不等于“平台数据库0诊断记录”。

## 关键对象和状态

Benchmark组织标准，Dataset组织题目，Case定义输入/参考；Run是一次评测，RunTopic关联题目和执行Topic，K>1有eval Thread，operation标识运行操作，TraceID有时缺失，message/toolCallId用于定位事实。普通聊天Topic与评测Case不是同一概念。

Case的passed/failed是评分结论，error/timeout是执行或评分异常。Run的completed表示运行完成，不保证所有Case答对。诊断任务pending/processing/success/error属于另一生命周期；job success只说明分析器执行成功。needs_review/unknown不等于已证根因，也不等于没有业务问题。

配置快照是记录，不是执行冻结：createRun保存snapshot，execAgent重新读当前配置；不能由一个快照字段推出全实验可精确重放。

## 实际技术与学习价值

| 技术 | 实际用途/证据 | 学习等级与边界 |
| --- | --- | --- |
| TypeScript、Next.js/React、tRPC/Zod | 登录后评测界面及实际路由/schema；P02/B01 | B；重点追数据流，不讲完整通用工作空间UI |
| PostgreSQL、Drizzle；测试中PGlite | 表关系、user作用域、条件写和原任务表；P01/P16/B05 | B基础，终态/幂等A；组件用PGlite不冒充真实PG |
| AgentRuntime/GeneralChatAgent | 按phase产指令、执行模型/工具；P06/P07 | A；这是项目实际抽象，不包装成新造大模型 |
| 原ModelRuntime结构化调用、AbortController/硬截止 | LLM Judge；P14/P15 | A；真实模型质量仍未知 |
| tokenx与记录usage | token预算估算、65%默认触发；P08 | B；不是已证最优参数、不是证据去噪 |
| Python标准库子进程＋JSON合同 | 当前桥接/固定审核；B03/B06/B07 | A；主链不新增Python常驻服务或分布式队列 |
| 旧pandas/规则、TF-IDF与余弦medoid | 旧离线表格/代表样例；L07/L08 | B；不称当前RAG向量数据库或已优化的代表算法 |
| Vitest、Python unittest、固定候选五组回放 | 工程与质量分开验证；R01/R02、09实验卡 | A；Mock和合成标签不证明模型效果 |

未把仓库依赖中的所有语音、多模态、向量检索或分布式组件列成本项目教学核心；有入口/调用才讨论实际使用。

## 学习依赖

```mermaid
flowchart LR
 V0[评测问题/Baseline] --> V1[Agent执行]
 V1 --> V2[资产/身份/运行]
 V2 --> V3[并发/K/终态]
 V3 --> V4[Judge]
 V4 --> V5[轨迹证据]
 V5 --> V6[Python任务]
 V6 --> V7[审核/弃权]
 V7 --> V8[统计/代表Case]
 V8 --> V9[实验/全项目面试]
```

首轮顺序依业务生长，不按文件夹排序。A级深入专题在对应V完成后按薄弱处补，不在V0灌入所有技术。
'''
write('01_项目全景地图.md',maptext)

course=['# 从零到一逆向开发课程\n',
'V0—V9共10个主要单元，每单元建议60—90分钟，复杂的V3/V6/V7可分两次。版本是教学推演，不是Git历史；既有事故和真实实验明确标注。这里只给可实施蓝图，正式讲解由后续教师展开。\n',
'贯穿例子【模拟】：查询订单A17，工具可能成功、外部500或无异常但答案错误。同一Case可多轮Run、一个Case可K次执行；此例只是用来设计，具体实验看09，不把教学参数当生产数据。\n',
'| 版本 | 前置能力 | 本版新增 | 验收产物 |\n| --- | --- | --- | --- |']
for unit in UNITS:
    course.append(f"| [{unit['id']}](#{unit['id'].lower()}) {unit['title']} | {unit['pre']} | {unit['delta']} | {unit['artifact']} |")
for unit in UNITS:
    course.extend([f"\n<a id=\"{unit['id'].lower()}\"></a>\n\n## {unit['id']} {unit['title']}\n",f"前置：{unit['pre']}\n\n本版新增：{unit['delta']}\n",
     '### A. 当前开发背景\n',unit['background'],'\n### B. 最朴素实现\n',unit['naive'],'\n### C. 潜在问题与技术挑战\n',unit['risks'],
     '\n### D. 方案探索与比较\n','| 方案 | 适用/收益 | 代价/边界 |\n| --- | --- | --- |'])
    course.extend('| '+' | '.join(value.split('|'))+' |' for value in unit['options'])
    course.extend(['\n### E. 真实项目采取的方案\n',unit['real'],'\n源码核对：'+ev(*unit['ids'])+'。',
       '\n### F. 知识和掌握深度\n','| 等级与知识 | 应掌握什么、为何学、是否看源码 |\n| --- | --- |'])
    course.extend('| '+row.split('|')[0]+' '+row.split('|')[1]+' | '+row.split('|')[2]+' |' for row in unit['knowledge'])
    course.append('\n### G. 实际效果与验证\n')
    course.extend('- '+row for row in unit['verify'])
    course.extend(['\n### H. 学习验收与面试追问\n',*[(str(i)+'. '+q) for i,q in enumerate(unit['questions'],1)],
      '\n教师验收判据：'+unit['rubric'],'\n可复用成果：'+unit['artifact'],
      '\n完成本版的能力变化：'+unit['delta'],'\n下一版：'+unit['next']])
write('02_从零到一逆向开发课程.md','\n'.join(course))

# Remaining documents and source packaging are generated by the adjacent module.
exec((BASE/'course_handoff.py').read_text(encoding='utf-8'),globals())
