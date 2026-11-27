"""New single-author synthetic catalog; no attribution/model imports."""
import json,hashlib,datetime
from pathlib import Path
B=Path(__file__).resolve().parent
CATALOG=[
 ('只查2027财年收入','parameter',2027,2023),('比较2027与2026销售额','legal_base',2027,2026),('查询最近一段时间库存','ambiguous',None,2024),('先查2027，再明确改成2028','changed',2028,2027),
 ('支付工具显示未支付但回答已支付','answer','unpaid','paid'),('仓库结果可用数9，回答90','answer',9,90),('图书记录未借出但回答已借出','answer','available','borrowed'),('新结果已取消，仍用旧成功值','stale','cancelled','confirmed'),
 ('天气工具超时，换源后正确完成','recovered','rain','rain'),('第一次库存查询失败，重试成功','recovered',17,17),('航班记录和答案均为延误','normal','delayed','delayed'),('支付状态查询正常完成','normal','paid','paid'),
 ('当前成功，仅history里有失败','nested','pending','pending'),('旧诊断文本包含失败，当前成功','nested','ready','ready'),('工具调用明确不可用','explicit',None,None),('外部服务返回执行失败','explicit',None,None),
 ('短摘录不足以独立复述整字段但封装完整','short',None,None),('失败引文只有关键词，仍保留同字段上下文','short',None,None),('只有最终答案，没有工具结果','missing','pending','sent'),('工具结果有文本但Call身份丢失','unpaired','pending','sent'),
 ('两份结果同调用身份且内容冲突','conflict','pending','sent'),('多个结果是相同事件重复上报','duplicate','pending','sent'),('引用真实但声称内部planner根因','root','pending','sent'),('用户意图是比较多期，不允许只因年份不同报错','legal_base',2028,2026),
 ('退款被工具拒绝却回答退款成功','answer','rejected','approved'),('数量从6更新到3，答案仍6','stale',3,6),('失败后后续正确，但评分质量标准未通过','recovered_quality','ok','ok'),('正常业务success=true，嵌套业务success=false','nested','active','active'),
 ('参数与最终答案两处偏差','multi',2027,2023),('两个工具分别成功，只有最后答案误读','multi_call','not_shipped','shipped'),('正常表达包含timeout单词','normal_text','ok','ok'),('没有任务边界，不能断言具体责任','ambiguous',None,2025),
 ('工具结果是中文尚未派送，最终已签收','natural_result','not_delivered','delivered'),('工具明确待审核，最终中文说审核通过','natural_answer','pending','approved'),('以2019为基期分析2027增长','legal_base',2027,2019),('执行失败后恢复，不归因成最终任务失败','recovered','available','available'),
 ('确实执行失败但观测不到内部责任','explicit',None,None),('一个外部错误与答案矛盾同时存在','explicit_semantic','pending','sent'),('关闭工具来源信息，证据不足','unknown_source','pending','sent'),('多个模型步骤使用相同工具，均成功且答对','normal_multi','ready','ready')]
def js(v):return v if isinstance(v,str) else json.dumps(v,ensure_ascii=False)
def make(i,title,kind,want,actual):
 ident='fresh-'+str(i);entity='entity-'+str(83*i+7);scope=dict(runId='synth-run-'+str(i),caseId=ident,threadId='thread-'+str(i),topicId='topic-'+str(i),operationId='op-'+str(i),traceIds=[]);nodes=[]
 def n(role,content='',**extra):
  d=dict(id=ident+'-n'+str(len(nodes)),messageId='m'+str(len(nodes)),parentId=nodes[-1]['id'] if nodes else None,role=role,content=js(content),sourcePointer='synthetic/'+ident,error=None,toolCallId=None,toolSource='unknown',toolName=None,arguments=None,traceId=None,sequence=len(nodes),createdAt=None);d.update(extra);nodes.append(d);return d
 task=title if kind in ('ambiguous','natural_answer','natural_result') else {'request':title}
 if kind in ('parameter','multi','changed'):task={'request':title,'parameterConstraints':{'year':{'allowed':[want],'closed':True}}}
 if kind=='legal_base':task={'request':title,'year':want,'parameterConstraints':{'year':{'allowed':[want,actual],'closed':True}}}
 u=n('user',task);gold=[]
 def call(cid,args):return n('call',toolCallId=cid,toolSource='mcp',toolName='inventory.lookup',arguments=js(args))
 def tool(cid,value,failed=False):return n('tool',{'success':False,'error':'service unavailable'} if failed else {'success':True,'data':{'orderId':entity,'state':value}},toolCallId=cid,toolSource='mcp',toolName='inventory.lookup',error={'message':'service unavailable'} if failed else None)
 c=call('attempt-1',{'orderId':entity,'year':actual if isinstance(actual,int) and kind in ('parameter','multi','changed','legal_base') else 2027})
 failed=kind in ('explicit','short','recovered','recovered_quality','explicit_semantic')
 r=tool('attempt-1',actual if kind=='stale' else want,failed);latest=r
 if kind in ('stale','recovered','recovered_quality','multi_call','normal_multi'):
  call('attempt-2',{'orderId':entity,'year':2027});latest=tool('attempt-2',want)
 if kind=='normal_multi':call('attempt-3',{'orderId':entity});latest=tool('attempt-3',want)
 if kind in ('conflict','duplicate'):
  d=tool('attempt-1',want)
  if kind=='conflict':r['content']=js({'success':True,'data':{'orderId':entity,'state':actual}})
  latest=d
 if kind=='nested':r['content']=js({'success':True,'data':{'orderId':entity,'state':want,'history':{'success':False,'error':'service unavailable'}}})
 if kind=='normal_text':r['content']=js({'success':True,'data':{'orderId':entity,'state':want},'note':'timeout is a configuration label, no execution failed'})
 if kind=='natural_result':r['content']='原始工具明确记录：该件尚未派送。'
 if kind=='unknown_source':r['toolSource']='unknown';c['toolSource']='unknown'
 answer=n('assistant',{'orderId':entity,'state':actual if kind in ('answer','stale','multi','multi_call','duplicate','root','explicit_semantic','natural_result','natural_answer') else want})
 if kind=='natural_answer':answer['content']='已经审核通过。'
 if kind=='missing':nodes.remove(r)
 if kind=='unpaired':nodes.remove(c)
 def g(category,refs,key=None,expected=None,used=None):gold.append({'kind':category,'key':key,'expected':expected,'actual':used,'evidenceScope':[(x['id'],f) for x,f in refs],'rootClaimVerified':False})
 if failed:g('execution_failure',[(r,'content')])
 if kind in ('parameter','changed','multi'):g('parameter_task_mismatch',[(u,'content'),(c,'arguments')],'year',want,actual)
 if kind in ('answer','stale','multi_call','duplicate','root','explicit_semantic','natural_result','natural_answer'):
  g('answer_tool_mismatch',[(latest,'content'),(answer,'content')],'state',want,actual)
 if kind=='stale':g('stale_information_use',[(r,'content'),(latest,'content'),(answer,'content')],'state',want,actual)
 for seq,x in enumerate(nodes):x['sequence']=seq
 t={'schemaVersion':1,'trajectoryId':ident,'inputDigest':ident+'-digest','scope':scope,'nodes':nodes,'coverage':{'source':'database_messages','complete':False,'warnings':['synthetic_missing_provider_events']},'evaluation':{'status':'passed' if kind in ('normal','normal_multi','normal_text','nested','recovered','legal_base') else 'failed','score':1 if kind in ('normal','normal_multi','normal_text','nested','recovered','legal_base') else 0,'task':title,'actual':answer['content'],'expected':None,'criteria':None}}
 return {'id':ident,'title':title,'scenario':kind,'origin':'synthetic','trajectory':t,'gold':gold,'forbidden':['unproven root cause','internal module ownership','recovered incident implies final failure'],'abstainAllowed':kind in ('ambiguous','missing','unpaired','conflict','unknown_source'),'rootEvidence':'No independently demonstrated causal root chain; no confirmed-root positive in this corpus.'}
if __name__=='__main__':
 p=B/'holdout.jsonl';assert not p.exists();assert len(CATALOG)==40
 rows=[make(i,*v) for i,v in enumerate(CATALOG)]
 p.write_text(''.join(js(r)+'\n' for r in rows),encoding='utf-8')
 (B/'FREEZE.json').write_text(json.dumps({'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':{q.name:hashlib.sha256(q.read_bytes()).hexdigest() for q in [p,Path(__file__)]},'cases':40,'singleAuthor':True,'independentFromModelOutputs':True,'notIndependentHumanGold':True,'evaluationPerformed':False,'criteria':{'databaseChecks':'all specified isolation and identity assertions pass','reviewFalseSupport':0,'noNewFalseGapOnLocalFacts':True,'normalFinalFailureFalsePositives':0,'promotionRequiresRealLLMIncrement':True,'realLLMQuality':'not measured without authorized budget','latencyTargetMs':15000,'costCeilingPerRequest':'requires approved price/budget, unset means paid blocked'}},indent=2),encoding='utf-8')
 print('40 new synthetic cases frozen before new prompt/provider work')
