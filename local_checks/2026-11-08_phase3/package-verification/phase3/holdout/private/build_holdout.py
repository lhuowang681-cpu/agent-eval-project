"""Human-authored synthetic cards; helpers only assemble v1 identity and digests.
Do not inspect this private oracle until the optimization plan is frozen.
No production reviewer/classifier is imported or called.
"""
from pathlib import Path
import copy
import hashlib
import json
import random

HOME = Path(__file__).resolve().parents[1]
CATEGORIES = ['context_window_exceeded', 'provider_payload_invalid', 'thinking_type_invalid', 'model_missing', 'builtin_tool_contract_invalid', 'builtin_tool_unavailable', 'builtin_result_parse_failed', 'builtin_tool_failure_unclassified', 'external_permission', 'external_credential', 'external_quota', 'external_timeout', 'external_transport', 'external_tool_failure']

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

def row(role, content='', **kwargs):
    return dict(role=role, content=content, **kwargs)

def flow(source, name, args, result, error=None):
    return [row('user', '查阅订单 A17 的当前状态。'), row('assistant', '先查询记录，再依据返回信息回答。'),
            row('call', toolSource=source, toolName=name, arguments=args, toolCallId='tc-1', parent=1),
            row('tool', result, error=error, toolSource=source, toolName=name, arguments=args, toolCallId='tc-1', parent=1)]

def ref(index, quote, field='content'):
    return (index, field, quote)

def observed(category, summary, refs, module=None):
    return dict(status='resolved', category=category, moduleId=module, claimLevel='observation', summary=summary, evidenceRefs=refs, reasonCodes=['evidence_observed'])

def cause(category, module, summary, refs):
    return dict(status='resolved', category=category, moduleId=module, claimLevel='root_cause', summary=summary, evidenceRefs=refs, reasonCodes=['candidate_causal_claim'])

def abstain(summary):
    return dict(status='unknown', category=None, moduleId=None, claimLevel='observation', summary=summary, evidenceRefs=[], reasonCodes=['insufficient_evidence'])

def unknown_root(why):
    return dict(known=False, moduleId=None, category=None, rationale=why)

def known_root(module, category, why):
    return dict(known=True, moduleId=module, category=category, rationale=why)

CARDS = []
def card(rows, candidate, observations, root, correct, supported, rationale, complete=True, warnings=None, task=None, expected='订单状态', actual='暂未取得订单状态'):
    # All labels and candidates below were specified manually, never inferred by helpers.
    CARDS.append(dict(rows=rows, candidate=candidate, labels=dict(observationCategories=observations, observationEligible=bool(observations), root=root, candidateCorrect=correct, candidateSupported=supported, labelRationale=rationale), complete=complete, warnings=warnings or [], task=task or '查阅订单 A17 的当前状态。', expected=expected, actual=actual))

# 01: bounded observation; external name resembles a builtin name.
r = flow('mcp', 'lobe-orders____lookup', '{"id":"A17"}', '{"success":false,"status":503,"message":"upstream unavailable"}')
card(r, observed('external_transport', '这个 MCP 调用的结果报告 503，上游本次未能完成响应；不能据此定位参数生成方。', [ref(3, '503')]), ['external_transport'], unknown_root('只注入一次503失败响应，未提供服务内部或请求加工链；不将响应状态提升为唯一根因。'), True, True, '来源元数据明确MCP，结果明确失败；整段候选限定为观察，没有强加内部责任。')

# 02: legal quote, wrong responsibility; controlled fault exists only in private oracle.
r = flow('mcp', 'orders____lookup', '{"id":"A17"}', '{"success":false,"status":503,"message":"upstream unavailable"}')
r.append(row('error', error={'message':'Request validation completed', 'requestId':'req-b', 'checkedArguments':{'id':'A17'}, 'outboundArguments':{'id':'A17'}}))
card(r, cause('external_transport', 'L2.2', '503 已经证明 GeneralChatAgent 生成了错误订单参数，必须修改其参数规划。', [ref(3, '503')]), ['external_transport'], known_root(None, 'external_transport', '合成注入器仅在远端响应出口强制503；参数输入与出站保持一致，未注入内部参数故障。'), False, False, '引文真的存在，但它不证明参数规划错误；原文字义还与参数校验记录冲突。')

# 03: permission observation, not a claim about who set the policy.
r = flow('plugin', 'warehouse____read', '{"order":"A17"}', '{"ok":false,"code":403,"message":"access denied by policy"}')
card(r, observed('external_permission', '插件端返回策略拒绝访问。当前记录没有说明策略配置者或拒绝是否合理。', [ref(3,'access denied by policy')]), ['external_permission'], unknown_root('403是注入的可见现象；授权意图和策略版本没有记录。'), True, True, '候选没有将权限拒绝误说成Agent内部逻辑错误。')

# 04: revoked credential is not a locally malformed token.
r = flow('mcp', 'inventory____read', '{"sku":"S8"}', '{"success":false,"code":401,"message":"token_expired"}')
r.append(row('error', error={'message':'Credential forwarding audit', 'configuredFingerprint':'fp-17', 'sentFingerprint':'fp-17'}))
card(r, cause('external_credential','L8.6','凭证审计已经证明本地把令牌字符串拼错，因此401由本地Credentials管理代码损坏造成。',[ref(3,'token_expired')]), ['external_credential'], known_root(None,'external_credential','合成服务端在正确凭证被转发后撤销其有效期；转发器未变换令牌。'), False, False, '整个候选断言本地改坏令牌，既不由401推出，又被一致的指纹记录反驳。')

# 05: rate/credit exhaustion observed without inventing a model bug.
r = flow('plugin','search____query','{"q":"A17"}','{"success":false,"code":429,"message":"monthly quota exhausted"}')
card(r, observed('external_quota','外部搜索接口报告月配额耗尽；本记录没有显示是谁消耗了配额。',[ref(3,'monthly quota exhausted')]), ['external_quota'], unknown_root('只构造配额拒绝，不构造调用预算或账户历史。'), True, True, '观察配额拒绝有支持，不能顺势归因UsageCounter。')

# 06: useful timeout evidence but explicit abstention about cause.
r = flow('mcp','orders____lookup','{"id":"A17"}','', {'name':'TimeoutError','message':'No response before 8000ms deadline'})
card(r, abstain('观察到调用等待超时，但缺少服务端接收与处理记录，不能确定网络、排队还是执行阶段的根因。'), ['external_timeout'], unknown_root('故意只保留客户端deadline事件；没有注入能唯一识别归因模块的事实。'), None, False, '这是无正向归因命题的合理弃权；超时观察另由observation标签表达。')

# 07: unknown source plus a suggestive name is not proof of an external MCP failure.
r = flow('unknown','mcp-looking-orders','{"id":"A17"}','',{'message':'ECONNRESET while reading stream'})
card(r, cause('external_transport','L6.3','工具名含mcp已经证明是MCP服务器崩溃，而且本地执行器一定没有问题。',[ref(3,'ECONNRESET','error')]), [], unknown_root('来源被故意截断，只保留未知来源节点的reset；没有服务器退出事件。'), False, False, '名字相似不能替代toolSource；reset也不能证明服务器崩溃或排除本地错误。', complete=False, warnings=['tool_source_unavailable'])

# 08: generic external failure remains generic.
r = flow('mcp','archive____fetch','{"order":"A17"}','{"success":false,"message":"operation rejected; reason unavailable"}')
card(r, observed('external_tool_failure','MCP返回操作失败，具体原因未提供，不能把它细化为权限、凭证或超时。',[ref(3,'operation rejected')]), ['external_tool_failure'], unknown_root('泛化失败信封不包含底层原因。'), True, True, '有限观察准确且有逐字证据。')

# 09: builtin validator rejection does not name the faulty producer.
r = flow('builtin','catalog____search','{"limit":"several"}','', {'code':'SCHEMA_VALIDATION','message':'limit must be integer'})
card(r, cause('builtin_tool_contract_invalid','L2.2','limit必须是整数这条验证错误已经证明规划器故意忽略了工具Schema。',[ref(3,'limit must be integer','error')]), ['builtin_tool_contract_invalid'], unknown_root('只记录最终参数和校验拒绝，参数曾否经过模板、转换器或规划器不得而知。'), False, False, '校验错误可观察，但故意忽略及GeneralChatAgent责任均超出证据。')

# 10: missing builtin registration, actor unknown.
r = flow('builtin','reports____render','{"order":"A17"}','',{'message':'No runtime registered for reports.render'})
card(r, observed('builtin_tool_unavailable','内置reports.render在当前执行环境没有已注册运行时。谁删掉注册项仍不清楚。',[ref(3,'No runtime registered','error')]), ['builtin_tool_unavailable'], unknown_root('环境缺少运行时的原因没有暴露。'), True, True, '候选把不可用现象与注册丢失的根因分开。')

# 11: result parsing observation without protocol-origin speculation.
r = flow('builtin','document____extract','{"document":"D5"}','', {'message':'Result JSON parse failed at position 0','receivedPrefix':'<html>'})
card(r, observed('builtin_result_parse_failed','文档工具的结果JSON解析失败；这里只能看到收到的前缀是HTML。',[ref(3,'Result JSON parse failed','error'),ref(3,'<html>','error')]), ['builtin_result_parse_failed'], unknown_root('未记录HTML由哪个服务、缓存或转换器产生。'), True, True, '完整文字不推断上游一定宕机。')

# 12: recognized builtin failure, no meaningful diagnosis claim.
r = flow('builtin','tasks____launch','{"task":"T9"}','{"success":false,"message":"E_JOB_773"}')
card(r, abstain('当前只记录了内置任务失败代号，缺少其定义和执行阶段，暂不定位责任模块。'), ['builtin_tool_failure_unclassified'], unknown_root('不透明代码由单人合成，不赋予隐藏模块含义。'), None, False, '未知结论不是一个被支持的根因；观察资格仍为真。')

# 13: controlled duplicate system injection with a recorded comparison.
r = [row('user','整理一页项目介绍。'),row('error', error={'message':'request exceeds context limit: 8300 > 8192','checkpoint':{'component':'SystemPromptInjector','entrySystemHashes':['s7'],'exitSystemHashes':['s7','s7'],'entryInputTokens':4160,'exitInputTokens':8300,'limitTokens':8192,'sameInvocation':True}})]
card(r, cause('context_window_exceeded','L4.3','同一次SystemPromptInjector处理把同一个系统段重复加入出站上下文，记录中的窗口超限由该重复注入造成。',[ref(1,'entrySystemHashes','error'),ref(1,'exitSystemHashes','error'),ref(1,'8300 > 8192','error')]), ['context_window_exceeded'], known_root('L4.3','context_window_exceeded','仅对System段注入器启用重复append变异；输入总长由4160变为8300，其他处理保持不变。'), True, True, '候选对应可见的单次处理前后差异与窗口错误，不只是引用超限关键词。', task='整理一页项目介绍。')

# 14: builder conversion creates an empty provider block.
r = [row('user','把订单说明改写成短句。'),row('error',error={'message':'text content blocks must contain non-whitespace text','conversionRecord':{'component':'OpenAIContextBuilder','sourceText':'Ready','convertedBlocks':[{'type':'text','text':''}],'requestTag':'req-14'}})]
card(r, cause('provider_payload_invalid','L5.4','上下文转换记录表明非空源文本在OpenAIContextBuilder内变成空text block，Provider随后拒绝了该块。',[ref(1,'sourceText','error'),ref(1,'convertedBlocks','error'),ref(1,'non-whitespace','error')]), ['provider_payload_invalid'], known_root('L5.4','provider_payload_invalid','合成变异只将转换器的text赋值改为空串，输入保持非空。'), True, True, '该根因标签来自预定局部变异，完整转换对照出现在输入而模块ID不出现在输入。', task='把订单说明改写成短句。')

# 15: thinking-type mutation at the resolver boundary.
r = [row('user','解释计算步骤。'),row('error',error={'message':'thinking.type must be enabled or disabled','parameterAudit':{'stage':'ModelParamsResolver','selectedThinking':'enabled','emittedThinking':'auto','providerSawThinking':'auto'}})]
card(r, cause('thinking_type_invalid','L5.2','ModelParamsResolver把已选择的enabled输出成auto，并且Provider看到的也是auto；这次非法thinking值源自参数解析边界。',[ref(1,'selectedThinking','error'),ref(1,'emittedThinking','error'),ref(1,'thinking.type must','error')]), ['thinking_type_invalid'], known_root('L5.2','thinking_type_invalid','合成变异锁定参数解析器一个枚举赋值，其他阶段不改thinking。'), True, True, '输入保留了选择值、输出值和被拒值，支持有限的边界定位。', task='解释计算步骤。')

# 16: the final missing field is real; blaming the resolver contradicts its recorded output.
r = [row('user','返回一句摘要。'),row('error',error={'message':'model field is required','requestAssembly':{'resolverResult':{'model':'tiny-v2'},'factoryPayload':{'messages':[{'role':'user','content':'返回一句摘要。'}]}}})]
card(r, cause('model_missing','L5.2','model field is required已经证明ModelParamsResolver没有选择模型，应该修改解析器的模型选择逻辑。',[ref(1,'model field is required','error')]), ['model_missing'], known_root('L5.3','model_missing','仅在Provider Factory组装请求时删除model键；解析器原样输出tiny-v2。'), False, False, '合法错误引文不支持错误生产方，且另一个字段明确显示解析器已有模型。', task='返回一句摘要。')

# 17: executor serialization breaks otherwise valid model arguments.
r = flow('builtin','orders____lookup','{"id":"A17"','',{'message':'tool arguments JSON parse failed: missing closing brace','serializationAudit':{'stage':'InstructionExecutor','modelArguments':'{"id":"A17"}','emittedArguments':'{"id":"A17"'}})
card(r, cause('builtin_tool_contract_invalid','L2.5','InstructionExecutor序列化记录中合法模型参数少了末尾大括号，内置工具因此在解析入口拒绝参数。',[ref(3,'modelArguments','error'),ref(3,'emittedArguments','error'),ref(2,'{"id":"A17"','arguments')]), ['builtin_tool_contract_invalid'], known_root('L2.5','builtin_tool_contract_invalid','合成变异仅截断InstructionExecutor输出的末尾字符。'), True, True, '不仅是工具拒参，还有生产链中明确的前后参数对照。')

# 18: account-to-credential selection mismatch.
r = flow('mcp','billing____read','{"account":"acct-A"}','{"success":false,"code":401,"message":"credential does not belong to account"}')
r.append(row('error',error={'message':'Credential selection audit','account':'acct-A','configuredFingerprint':'fp-A','selectedFingerprint':'fp-B','stage':'CredentialSelector'}))
card(r, cause('external_credential','L8.6','CredentialSelector为acct-A选择了与配置不一致的fp-B，外部服务报告账户凭证不匹配；记录支持本地凭证选择错误。',[ref(4,'configuredFingerprint','error'),ref(4,'selectedFingerprint','error'),ref(3,'credential does not belong')]), ['external_credential'], known_root('L8.6','external_credential','单人合成变异交换本地账户到凭证指纹映射；工具端校验仍正常。'), True, True, '这里确有本地选择方证据，与只见401的情况不同。')

# 19: builtin runtime registry constructed incorrectly despite an available manifest.
r = flow('builtin','calculator____calculate','{"expression":"6*7"}','',{'message':'No executor found for calculator.calculate','registryConstruction':{'component':'BuiltinToolsExecutor','manifestEntries':['calculator.calculate'],'constructedEntries':[]}})
card(r, cause('builtin_tool_unavailable','L6.2','BuiltinToolsExecutor已有calculator清单，却构建出空执行注册表，导致这次内置调用找不到executor。',[ref(3,'manifestEntries','error'),ref(3,'constructedEntries','error'),ref(3,'No executor found','error')]), ['builtin_tool_unavailable'], known_root('L6.2','builtin_tool_unavailable','只注入BuiltinToolsExecutor注册表构建丢项，manifest输入保持存在。'), True, True, '根因不靠工具名猜测，而有实际清单与注册表差异。')

# 20: valid parse-error quotation does not establish an MCP transport cause.
r = flow('builtin','reports____build','{"order":"A17"}','',{'message':'JSON parse failed on [object Object]','conversionAudit':{'component':'BuiltinToolsExecutor','receivedValueType':'object','decodeAppliedAgain':True}})
card(r, cause('external_transport','L6.3','JSON parse failed已经确认MCP网络连接断开；因此应修MCP Service的网络重连。',[ref(3,'JSON parse failed','error')]), ['builtin_result_parse_failed'], known_root('L6.2','builtin_result_parse_failed','仅对内置结果执行重复JSON解码，网络与MCP未参与该调用。'), False, False, '引用真实，但完整候选同时错来源、错现象类别、错模块。')

# 21: oracle-correct cause can still lack support in a partial trace.
r = [row('tool','{"success":false,"status":503,"message":"temporarily unavailable"}', toolSource='mcp',toolName='orders____lookup',toolCallId='tc-older',parent=None)]
card(r, cause('external_transport',None,'根因就是上游连接端故障，与本地请求加工无关。',[ref(0,'503')]), ['external_transport'], known_root(None,'external_transport','合成实验在服务连接出口注入故障，但故意删除请求及端侧记录；该机制只写在私有标签。'), True, False, '机制真值使候选碰巧正确，局部输入却不足以排除其他原因；truth与support必须分别计量。', complete=False,warnings=['request_and_runtime_events_missing'])

# 22: assistant summary is a real quote but not an authoritative causal record.
r = flow('plugin','orders____lookup','{"id":"A17"}','{"success":false,"code":403,"message":"policy blocked account"}')
r.append(row('assistant','已确认是AgentStateManager内存状态被破坏，绝非权限策略。'))
card(r, cause('external_permission','L3.1','assistant的总结已经证明AgentStateManager状态损坏才是根因，权限错误只是伪装。',[ref(4,'AgentStateManager内存状态被破坏')]), ['external_permission'], known_root(None,'external_permission','外部策略注入拒绝；另单独注入一条错误assistant总结，未修改任何Agent状态。'), False, False, '候选逐字引用存在，但原assistant总结本身是误导性生成文本，不是状态损坏证据。')

# 23: successful document contents contain error vocabulary as examples.
r = flow('mcp','docs____read','{"document":"authentication-guide"}','{"success":true,"data":"Examples: 401 invalid API key; 429 quota exceeded. These are documentation examples."}')
card(r, observed('external_credential','这个MCP调用失败且凭证无效，因为工具内容出现401 invalid API key。',[ref(3,'401 invalid API key')]), [], unknown_root('成功文档返回未注入调用失败；错误词仅作为文档内容。'), False, False, '合法引文来自成功payload的普通文本，不能把词语出现当错误事件。', actual='已读取认证文档')

# 24: error terms in a system instruction are not runtime incidents.
r = [row('system','When a remote server says 429 quota exceeded, report the limit and do not retry forever.'),row('user','6乘7是多少？'),row('assistant','43')]
card(r, cause('external_quota','L5.3','系统提示中的429 quota exceeded证明本次Provider配额耗尽，Provider Factory应承担回答错误责任。',[ref(0,'429 quota exceeded')]), [], unknown_root('无Provider或工具失败注入，只构造语义答错；系统文本是策略说明。'), False, False, '提示词不是执行事件，且数字回答错误没有通过这些证据定位生产模块。', task='6乘7是多少？',expected='42',actual='43')

# 25: mixed faults invalidate an otherwise locally valid fragment.
r = flow('plugin','search____query','{"q":"A17"}','{"success":false,"code":429,"message":"quota exhausted"}')
r.append(row('error',error={'message':'maximum context length 8192 exceeded by 9216 input tokens','requestId':'req-other'}))
card(r, observed('external_quota','本次唯一故障就是外部配额不足，Provider调用完全正常，没有任何上下文超限。',[ref(3,'quota exhausted')]), ['external_quota','context_window_exceeded'], unknown_root('注入两个独立阶段错误，不提供唯一主因排序。'), False, False, '候选前半句有局部支持，但完整文字排除另一个明示故障，不能按关键词片段给正确标签。')

# 26: unrelated success does not recover an older objective.
r = flow('mcp','orders____lookup','{"id":"A17"}','{"success":false,"status":502,"message":"bad gateway"}')
r.extend([row('user','另外问一下上海天气。'),row('assistant','切换到天气查询。'),row('call',toolSource='mcp',toolName='weather____lookup',toolCallId='tc-2',arguments='{"city":"Shanghai"}',parent=5),row('tool','{"success":true,"temperature":22}',toolSource='mcp',toolName='weather____lookup',toolCallId='tc-2',arguments='{"city":"Shanghai"}',parent=5)])
card(r, observed('external_transport','订单调用返回502；后来的成功属于另一个天气调用，不足以证明订单任务已恢复。',[ref(3,'502'),ref(7,'"success":true')]), ['external_transport'], unknown_root('只注入订单外部失败及无关成功，未暴露订单根因。'), True, True, '候选明确区分两个toolCallId及用户目标，没有把后续任意成功当恢复。')

# 27: semantic bad answer with no contract-level failure should permit abstention.
r = flow('builtin','calculator____calculate','{"expression":"6*7"}','{"success":true,"result":42}')
r[0]['content']='6乘7是多少？';r.append(row('assistant','答案是43。'))
card(r, abstain('工具结果是42而最后回答为43，说明答案不正确；现有记录不足以确定是哪个内部阶段造成，暂不指定根因模块。'), [], unknown_root('没有注入任何14类契约/外部故障，只合成末端语义偏差，缺少生产链中间状态。'), None, False, '合理弃权不应被记成确认根因，也不应因为eval.failed就凭空生成工具故障观察。', task='6乘7是多少？',expected='42',actual='43')

# 28: foreign-node citation and fabricated database deletion claim.
r = flow('mcp','orders____lookup','{"id":"A17"}','{"success":false,"message":"record unavailable"}')
c = cause('external_tool_failure','L8.1','当前轨迹已有数据库删除订单的记录，证明数据库层把A17删掉了。',[])
c['evidenceRefs']=[('foreign-node','error','DELETE order A17')]
card(r,c,['external_tool_failure'],unknown_root('只有外部record unavailable响应，没有数据库删除事件。'),False,False,'候选使用输入范围之外的证据ID，并虚构当前轨迹存在删除事件。')

# Separate human labels for canonical bounded observations. These do not relabel
# the original candidate text and do not call a reviewer or classifier.
SAFE_CANONICAL = [True,True,True,True,True,False,False,True,True,True,True,False,
                  True,True,True,True,True,True,True,False,True,False,False,False,
                  True,True,False,False]
RULE_CANONICAL = [True,True,True,True,True,True,False,True,True,True,True,True,
                  True,True,True,True,True,True,True,True,True,True,False,False,
                  True,True,False,True]
assert len(SAFE_CANONICAL)==len(RULE_CANONICAL)==len(CARDS)==28
for spec, safe, rule in zip(CARDS, SAFE_CANONICAL, RULE_CANONICAL):
    spec['labels']['safeCanonicalSupported'] = safe
    spec['labels']['ruleCanonicalSupported'] = rule

def assemble(index, spec):
    cid = f'ho-{index:03}'
    scope = dict(runId=f'run-{cid}',caseId=f'case-{cid}',topicId=f'topic-{cid}',threadId=None,operationId=f'op-{cid}',traceIds=[f'trace-{cid}'])
    nodes=[]
    for sequence, data in enumerate(spec['rows']):
        data=copy.deepcopy(data)
        parent=data.pop('parent',None)
        node=dict(id=f'{cid}:n{sequence:02}',messageId=None if data['role']=='call' else f'msg-{cid}-{sequence:02}',parentId=None if parent is None else f'{cid}:n{parent:02}',role=data.pop('role'),content=data.pop('content',''),sourcePointer=f'messages/msg-{cid}-{sequence:02}',errorSourcePointer=None,toolCallId=None,toolSource='unknown',toolName=None,arguments=None,error=None,traceId=f'trace-{cid}',sequence=sequence,createdAt=f'2026-11-09T00:00:{sequence:02}Z')
        node.update(data)
        if node['role']=='call' and parent is not None:
            node['messageId']=f'msg-{cid}-{parent:02}'
            node['sourcePointer']=f'messages/msg-{cid}-{parent:02}/tools/0'
        if node['error'] is not None:node['errorSourcePointer']=node['sourcePointer']+'/error'
        nodes.append(node)
    trajectory=dict(schemaVersion=1,trajectoryId=f"eval:{scope['runId']}:{scope['caseId']}:{scope['topicId']}:main",scope=scope,nodes=nodes,coverage=dict(source='database_messages',complete=spec['complete'],warnings=spec['warnings']),evaluation=dict(status='failed',score=0,task=spec['task'],expected=spec['expected'],actual=spec['actual'],criteria=None))
    trajectory['inputDigest']=hashlib.sha256(canonical(trajectory).encode()).hexdigest()
    candidate=copy.deepcopy(spec['candidate'])
    candidate['evidenceRefs']=[dict(nodeId=(f'{cid}:n{node:02}' if isinstance(node,int) else f'{cid}:{node}'),field=field,quote=quote) for node,field,quote in candidate['evidenceRefs']]
    return dict(id=cid,origin='synthetic',trajectory=trajectory,candidate=candidate,labels=copy.deepcopy(spec['labels']))

def main():
    cases=[assemble(i+1,spec) for i,spec in enumerate(CARDS)]
    assert len(cases)==28
    random.Random(613709).shuffle(cases)
    (HOME/'private').mkdir(parents=True,exist_ok=True)
    (HOME/'private'/'cases.jsonl').write_text(''.join(canonical(case)+'\n' for case in cases),encoding='utf-8',newline='\n')
    (HOME/'inputs.jsonl').write_text(''.join(canonical({key:value for key,value in case.items() if key!='labels'})+'\n' for case in cases),encoding='utf-8',newline='\n')
    print('Authored 28 cases. No production classifier/reviewer was called.')

if __name__=='__main__':main()
