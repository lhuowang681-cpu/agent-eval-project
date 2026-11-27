from pathlib import Path
import collections,csv,hashlib,json
base=Path(__file__).resolve().parent
labels={'rules':'规则Baseline','direct':'直接候选（离线）','structured':'候选＋结构','citations':'候选＋引用有效性','full':'候选＋完整审核'}
reports={split:json.loads((base/'results'/split/'comparison-adjudicated.json').read_text(encoding='utf-8')) for split in ['development','controlled','holdout']}


def fraction(a,b):return 'NA（0分母）' if not b else f'{a}/{b}'


def table(report,engine):
 lines=['| 方法 | 输出/全部 | 正确/错误/不可判 | 引文有效 | 有效观察/可观察例 | 根因命中/已知例 | 有支持根因命中 | 弃权 |',
 '| --- | --- | --- | --- | --- | --- | --- | --- |']
 for method,m in report['engines'][engine]['metrics'].items():
  lines.append(f"| {labels[method]} | {m['claims']}/{m['cases']} | {m['correctClaims']}/{m['wrongClaims']}/{m['unjudgedClaims']} | {fraction(m['validReferences'],m['references'])} | {fraction(m['effectiveObservationCases'],m['observationEligibleCases'])} | {fraction(m['correctKnownRoots'],m['knownRootCases'])} | {fraction(m['supportedCorrectKnownRoots'],m['knownRootCases'])} | {m['abstentions']}/{m['cases']} |")
 return '\n'.join(lines)


holdout=reports['holdout']
full_before=holdout['engines']['baseline']['metrics']['full']
full_after=holdout['engines']['optimized']['metrics']['full']
ablations=['# 五组离线对照与消融结果\n',
 '所有“LLM”组均为固定人工候选回放，真实模型调用0。不能把下面数字称为真实LLM效果。原/候选算法、相同输入和候选、逐例输出、执行收据和source SHA均保存。最终使用comparison-adjudicated；首次comparison保留未审阅rule支持性和初始分类假设的过程结果，不能拿它作为最终事实错误率。\n',
 '## 独立作者合成holdout：28例\n',
 '单作者合成oracle：24例可观察事故、12例预设已知合成机制；不是生产分布或真实根因gold。\n',
 '### 原版\n',table(holdout,'baseline'),'\n### 候选版\n',table(holdout,'optimized'),
 '\n原版/候选完整审核都0输出：接受准确率和选择性风险都是NA，不能写100%准确或0风险。13个正确且证据支持的原候选仍全部被拒，12个已知合成根因均无root输出。根因命中7/12来自预设直接候选，只有6/12同时被原作者认为证据充分；这不是模型测出来的根因能力。\n',
 '规则的12条泛化fallback与具体类别之间粒度未定义：代理裁决保留不可判，不能当12条事实错误，也不能当12条正确。规则20输出中只有8条可明确判对，12条不可判；按全部输出的错误风险范围为0—60%，不能只展示8/8后宣传100%。\n',
 '## 固定审核强度的风险—覆盖操作点（候选版，holdout）\n',
 '| 方法 | 作答覆盖 | 可判覆盖 | 不可判输出 | 可判输出错误 | 全输出错误风险界 |\n| --- | --- | --- | --- | --- | --- |']
for method,m in holdout['engines']['optimized']['metrics'].items():
 low,high=m['allClaimErrorRiskBounds']
 bounds='NA' if low is None else f'{low:.1%}—{high:.1%}'
 ablations.append(f"| {labels[method]} | {m['claims']}/28 | {m['judgedClaims']}/28 | {m['unjudgedClaims']} | {fraction(m['wrongClaims'],m['judgedClaims'])} | {bounds} |")
ablations.extend(['\n这些是离散政策点，不是调置信度阈值得到的连续曲线。root/observation各层风险保存在JSON.stratifiedRiskCoverage，不混成一种任务。引用组38/38引用有效却仍有10条事实错误、11条不支持，显示“能找到原文”不等于“结论成立”。结构组未过滤任何holdout候选，因为这些错误本来就是结构合法的；没有收益照实保留。\n',
 '## 已披露开发集：12例\n',table(reports['development'],'optimized'),
 '\n完整审核原版1/9有效观察，候选2/9；改善的是missing_parent有限观察，supported_paraphrase仍拒。开发改善不作为独立验收。\n',
 '## 保存的真实执行、合成任务回放：4例\n',table(reports['controlled'],'optimized'),
 '\n唯一结构化Calculator失败：原版审核0/1，候选1/1；另外三题质量失败无运行失败证据，合理无结论。它们来自上一轮真实PG运行保存的bundle，本轮未新开HTTP/PG，也不是自然用户根因数据。\n',
 '## 未提升、退步与代价\n',
 '独立集未显示完整审核覆盖或根因质量提升；合法短摘录在测试后兼容探针中出现候选退步。候选未推广，默认平台已恢复原版，详情PROMOTION_DECISION.md。所有统计都未将弃权简单算正确。Token、真实模型延迟和供应商成本均null；JSON仅保留本地每例规则/审核与子进程耗时，不从微秒级单次差异推断性能收益。'])
(base/'ABLATION_RESULTS.md').write_text('\n'.join(ablations)+'\n',encoding='utf-8')

case_rows=[];rejection_summaries={}
for split,report in reports.items():
 for engine in ['baseline','optimized']:
  raw=json.loads((base/'results'/split/(engine+'-outputs.json')).read_text(encoding='utf-8'))
  by_id={x['id']:x for x in raw['records']}
  rejection_summaries[split+'-'+engine]=dict(collections.Counter(code for x in raw['records'] for code in x['outcomes']['full']['issues']))
  for metric in report['engines'][engine]['caseMetrics']:
   method=metric['method'];outcome=by_id[metric['id']]['outcomes'][method]
   case_rows.append({'split':split,'engine':engine,'id':metric['id'],'method':method,'claim':metric['claim'],'rootClaim':metric['rootClaim'],'correct':metric['correct'],'supported':metric['supported'],'validReferences':metric['references']['valid'],'references':metric['references']['references'],'effectiveObservation':metric['effectiveObservation'],'knownRootCorrect':metric['knownRootCorrect'],'executionError':metric['executionError'],'issues':'|'.join(outcome['issues']),'localSeconds':metric['localSeconds']})
with (base/'CASE_RESULTS.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(case_rows[0]));writer.writeheader();writer.writerows(case_rows)
summary={'candidatePromoted':False,'defaultPlatform':'Restored byte-identical Phase2 baseline','allRunsOffline':True,'realModelCalls':0,'modelEffectMeasured':False,'caseCounts':{key:value['cases'] for key,value in reports.items()},'casesKeptSeparate':True,'engines':{split:report['engines'] for split,report in reports.items()},'rejectionIssueCounts':rejection_summaries,'holdoutFalseRefusals':{'baseline':full_before['falseRefusals'],'candidate':full_after['falseRefusals']},'posthocCompatibility':'results/posthoc-compatibility.json','supplierCost':None,'llmTokens':None,'llmLatencySeconds':None,'candidateSourceManifestSha256':hashlib.sha256((base/'optimized/MANIFEST.json').read_bytes()).hexdigest(),'holdoutSplitManifestSha256':hashlib.sha256((base/'holdout/split-manifest.json').read_bytes()).hexdigest()}
(base/'QUALITY_RESULTS.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'caseMetricRows':len(case_rows),'holdoutFullBefore':full_before['claims'],'holdoutFullCandidate':full_after['claims'],'rejectionIssueCounts':rejection_summaries['holdout-optimized']}))
