"""Build the current, documentation-only course in staging; no project imports."""
from pathlib import Path
import ast,hashlib,html,json,os,re,zipfile

BASE=Path(__file__).resolve().parent
ROOT=BASE.parents[1]
APP=ROOT/'local_checks/2026-11-08_platform_audit/platform'
OUT=BASE/'study_pack_next'
OUT.mkdir(parents=True,exist_ok=True)
DATE='2026-11-08'
EVIDENCE=[]

def sha(value):return hashlib.sha256(value).hexdigest()
def read(path):return (ROOT/path).read_text(encoding='utf-8-sig')
def write(name,value):
    target=OUT/name;target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(value.strip()+'\n',encoding='utf-8')
def jwrite(name,value):write(name,json.dumps(value,ensure_ascii=False,indent=2))
def evidence(identifier,path,symbol,needle,meaning,flow,level='A'):
    value=read(path);lines=value.splitlines()
    matches=[i for i,line in enumerate(lines,1) if needle in line]
    if not matches:raise ValueError((identifier,path,needle))
    EVIDENCE.append({'id':identifier,'path':path,'symbol':symbol,'line':matches[0],'anchor':lines[matches[0]-1].strip(),'meaning':meaning,'flow':flow,'level':level,'sha256':sha((ROOT/path).read_bytes())})
def ev(*ids):return '；'.join(f'[{identifier}](03_核心技术与源码证据.md#{identifier.lower()})' for identifier in ids)

P='local_checks/2026-11-08_platform_audit/platform/'
L='source-reference/attribution/'
Q='local_checks/2026-11-08_phase3/'
specs=[
 ('P01',P+'packages/database/src/schemas/agentEvals.ts','agentEvalRuns','export const agentEvalRuns','评测资产、运行和题目关系的真实表结构','Benchmark→Dataset→TestCase；Run→RunTopic→Topic/Thread','B'),
 ('P02',P+'src/server/routers/lambda/agentEval.ts','startRun','startRun: agentEvalProcedure','认证、启动请求和异步受理的边界','页面/客户端→agentEval.startRun→asyncCaller.eval.runBenchmark','B'),
 ('P03',P+'src/server/services/agentEvalRun/index.ts','createRun','async createRun(','记录Agent快照并预建pending题目','createRun→snapshotAgentConfig→runModel.create→Topics/RunTopics','A'),
 ('P04',P+'src/server/services/agentEvalRun/index.ts','snapshotAgentConfig','private async snapshotAgentConfig','可审计快照，不能等同执行时冻结配置','createRun→snapshotAgentConfig；执行另由execAgent读取配置','A'),
 ('P05',P+'src/server/services/aiAgent/index.ts','execAgent','async execAgent(','Agent执行入口重新读取当前配置','executeTrajectory→AiAgentService.execAgent→AgentRuntimeService','A'),
 ('P06',P+'packages/agent-runtime/src/core/runtime.ts','AgentRuntime.step','async step(','Brain产生指令，Runtime选择Executor推进状态','runtime.step→agent.runner→executor→state/events/nextContext','A'),
 ('P07',P+'packages/agent-runtime/src/agents/GeneralChatAgent.ts','GeneralChatAgent.runner','async runner(','按phase决定模型/工具/完成与压缩指令','user_input/llm_result/tools_batch_result→指令','A'),
 ('P08',P+'packages/agent-runtime/src/utils/tokenCounter.ts','shouldCompress','export function shouldCompress(','token预算触发压缩，默认窗口比例0.65','GeneralChatAgent→shouldCompress→getCompressionThreshold','B'),
 ('P09',P+'src/server/services/agentEvalRun/orchestrator.ts','runBenchmark','async runBenchmark(','分页、分批、K条轨迹与完成聚合','runBenchmark→paginateTestCases→executeTestCase→trajectory/completion→finalize','A'),
 ('P10',P+'src/server/services/agentEvalRun/index.ts','executeTrajectory','async executeTrajectory(','评测任务发起Agent执行并设置完成钩子','Orchestrator→executeTrajectory→execAgent→onComplete→evaluateCase/finalize','A'),
 ('P11',P+'src/server/services/agentEvalRun/index.ts','aggregateThreadResults','private async aggregateThreadResults','K样本至少一次通过、全部通过、最佳分及资源汇总','recordThreadCompletion→aggregateThreadResults→runTopic.updateIfUnfinished','A'),
 ('P12',P+'packages/eval-rubric/src/evaluate.ts','evaluate','export const evaluate','抽取/匹配、权重与阈值校验、加权评分','evaluateOutput→evaluate→extract/match→weightedScore','A'),
 ('P13',P+'packages/eval-rubric/src/matchers/llmRubric.ts','matchLLMRubric','export const matchLLMRubric','模型评分提示、schema和任务/标准上下文','match→llm-rubric matcher→generateObject','A'),
 ('P14',P+'src/server/services/agentEvalRun/judge.ts','generateJudgeObject','export async function generateJudgeObject','含初始化的硬截止、结构化分数和错误分类','evaluateOutput→generateJudgeObject→原ModelRuntime.generateObject','A'),
 ('P15',P+'src/server/services/agentEvalRun/index.ts','evaluateCase','private async evaluateCase','Case优先配置、最后Assistant输出及external分流','完成钩子→evaluateCase→evaluateOutput→条件回写','A'),
 ('P16',P+'packages/database/src/models/agentEval/runTopic.ts','updateIfUnfinished','updateIfUnfinished','终态条件写，不让迟到评分覆盖超时/终止','评分/完成聚合→updateIfUnfinished→数据库原子条件','A'),
 ('P17',P+'packages/database/src/models/agentEval/run.ts','finalizeIfActive','finalizeIfActive','运行级终态聚合的条件更新','orchestrator.finalizeRun→finalizeIfActive','A'),
 ('P18',P+'src/server/services/agentEvalRun/index.ts','getRunDetails','async getRunDetails(','报告读回与超时处理，不是新评分模型','agentEval.getRunDetails→runService→run/topics/metrics','B'),
 ('B01',P+'src/server/routers/lambda/agentEvalExternal.ts','diagnosisRequest','diagnosisRequest:','原扩展路由新增独立诊断，区别外部评分回调','diagnosisRequest→归因service；reportResult仍属评分生命周期','A'),
 ('B02',P+'src/server/services/agentEvalAttribution/trace.ts','extractTrajectory','export async function extractTrajectory','按用户、Run/Case/Thread只读导出证据和缺失覆盖','enqueue→extractTrajectory→messages/message_plugins→规范nodes','A'),
 ('B03',P+'src/server/services/agentEvalAttribution/contracts.ts','validateDiagnostic','export function validateDiagnostic','严格schema、身份、coverage和原字段引文核验','runPython→validateDiagnostic→独立诊断结果','A'),
 ('B04',P+'src/server/services/agentEvalAttribution/index.ts','enqueue','async enqueue(','确定ID、版本、输入快照与去重','diagnosisRequest→enqueueRun→enqueue→async_tasks','A'),
 ('B05',P+'src/server/services/agentEvalAttribution/index.ts','processJob','async processJob(','原子claim、lease token和迟到结果隔离','CLI.processPending→processJob→runner→按lease写result','A'),
 ('B06',P+'src/server/services/agentEvalAttribution/python.ts','runPython','export async function runPython','固定Python子进程、截止/输出上限和最小环境','processJob→runPython→adapter.py stdin/stdout→合同验证','A'),
 ('B07',P+'scripts/eval-attribution/adapter.py','analyze','def analyze(','重用原规则，仅生成有限故障观察，不自动推内部模块','analyze_reviewed→analyze→failure_envelope/分类→observations','A'),
 ('B08',P+'scripts/eval-attribution/evidence_review.py','review_candidate','def review_candidate(','当前默认原版审核：存在、支持、根因拒绝、摘要/覆盖门禁','adapter.analyze_reviewed/review_cli→audited_candidate→review_candidate','A'),
 ('B09',P+'scripts/eval-attribution/rules_pure.py','failure_envelope / classify_builtin / classify_external','def failure_envelope(','当前桥接实际复用的失败封装与规则类别；与旧快照分开','adapter.analyze及evidence_review共享纯分类函数→观察类别','A'),
 ('L01',L+'badcase_analysis.py','run_pipeline','def run_pipeline','旧模型离线分析路线，offline不保证无模型调用','拉取/缓存→可选补充→classify_batch→聚合/报告','B'),
 ('L02',L+'structured_jsonl_attribution.py','scan','def scan(','旧JSONL确定性规则路线，独立于旧模型入口','messages→tool_call_id关联→失败封装/分类→事件表','B'),
 ('L03',L+'trace_denoiser.py','denoise_trace_nodes','def denoise_trace_nodes','保留错误/祖先/邻域的证据视图，不等于模型上下文压缩','enrich路径→denoise_trace_nodes→带来源ID的视图','B'),
 ('L04',L+'llm_classifier.py','classify_batch','def classify_batch','旧提示分类56模块，输出normalize不证明引用支持','run_pipeline→classify_batch→classify_single→normalize','B'),
 ('L05',L+'reattribution_validator.py','validate','def validate(','单独存在的责任验证，不是所有入口必经','部分报表调用validate；run_pipeline没有统一调用','A'),
 ('L06',L+'development_priority.py','calculate_priority','def calculate_priority','启发式开发优先分，与证据正确性和评分不同','可用分类/证据字段→evidence_score→calculate_priority','B'),
 ('L07',L+'cause_convergence.py','converge','def converge(','按签名分簇、严重度/影响排序及medoid代表','调用方rows→converge→signature/severity/score→medoid','B'),
 ('L08',L+'cause_convergence.py','medoid','def medoid(','词袋/TF-IDF余弦距离选真实代表，不是向量库检索','胜出簇→medoid→实际trace代表','B'),
 ('L09',L+'representative_case_selector.py','select_representative_trace','def select_representative_trace','另一路按类别/签名与完整度选代表，非同一算法','classified/events/raw_nodes→候选→完整度排序','B'),
 ('L10',L+'aggregator.py','aggregate','def aggregate(','旧离线聚合指标，需核对计数口径','run_pipeline→aggregate→类别/模块表','B'),
 ('L11',L+'high_frequency_case_report.py','build_report','def build_report','旧Excel代表Case报告，不是当前UI诊断页','classified+原工作簿→build_report→Case工作簿','B'),
 ('R01',Q+'experiment/metrics.py','summarize','def summarize(','弃权/未知/错误、root与观察、风险上下界','固定oracle+保存输出+单独裁决→summarize','A'),
 ('R02',Q+'experiment/engine_worker.py','evaluate','def evaluate(','同一人工候选五组政策，不作真实模型推理','标签盲worker→rules/direct/structured/citations/full','A'),
]
for spec in specs:evidence(*spec)

UNITS=[]
def U(n,title,pre,delta,background,naive,risks,options,real,ids,knowledge,verify,questions,rubric,artifact,next_):
    UNITS.append(dict(id=f'V{n}',title=title,pre=pre,delta=delta,background=background,naive=naive,risks=risks,options=options,real=real,ids=ids,knowledge=knowledge,verify=verify,questions=questions,rubric=rubric,artifact=artifact,next=next_))

# Unit declarations and document rendering follow in the adjacent content module.
exec((BASE/'course_content.py').read_text(encoding='utf-8'),globals())
