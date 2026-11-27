"""Independent label-based statistics. Abstention never counts as a correct root."""
import json,math,statistics


def ratio(numerator,denominator):return None if not denominator else numerator/denominator


def claim(value):
    return isinstance(value,dict) and (value.get('category') is not None or value.get('moduleId') is not None or value.get('claimLevel')=='root_cause')


def root_claim(value):
    return isinstance(value,dict) and (value.get('moduleId') is not None or value.get('claimLevel')=='root_cause')


def valid_references(trajectory,value):
    refs=value.get('evidenceRefs') if isinstance(value,dict) else None
    if not isinstance(refs,list):return {'references':0,'valid':0,'claimHasValidEvidence':False}
    nodes={node['id']:node for node in trajectory['nodes']}
    valid=0
    for ref in refs:
        if not isinstance(ref,dict):continue
        node=nodes.get(ref.get('nodeId'))
        field=ref.get('field');quote=ref.get('quote')
        if node is not None and isinstance(field,str) and field in {'content','error','arguments'} and isinstance(quote,str) and quote:
            text=node[field] if isinstance(node[field],str) else json.dumps(node[field],sort_keys=True,ensure_ascii=False,allow_nan=False)
            valid+=int(quote in text)
    return {'references':len(refs),'valid':valid,'claimHasValidEvidence':bool(refs) and valid==len(refs)}


def correctness(row,value,method):
    if not claim(value):return None
    labels=row['labels']
    # Raw candidate labels are independently authored and may explicitly be null
    # when a root owner cannot be adjudicated. Unsupported is not synonymous wrong.
    if method in {'direct','structured','citations'}:
        return labels['candidateCorrect']
    if root_claim(value):
        root=labels['root']
        if not root['known']:return None
        return value.get('moduleId')==root['moduleId'] and value.get('category')==root['category']
    # Raw LLM arms keep every original assertion; judge the whole candidate text.
    # Rule/full outputs contain only the engine's fixed bounded observation text.
    return value.get('category') in labels['observationCategories'] and labels['observationEligible']


def support(row,value,method):
    if not claim(value):return None
    refs=valid_references(row['trajectory'],value)
    if not refs['claimHasValidEvidence']:return False
    if root_claim(value):return row['labels']['candidateSupported'] if method!='rules' else False
    if method in {'direct','structured','citations'}:return row['labels']['candidateSupported']
    # Local canonical claims still require independent observation labels. Reference
    # sufficiency is case-annotated, never inferred from the gate's own verdict.
    if value.get('category') not in row['labels']['observationCategories']:return False
    if method=='full':return row['labels'].get('safeCanonicalSupported',row['labels']['candidateSupported'])
    return row['labels'].get('ruleCanonicalSupported',row['labels']['observationEligible'])


def summarize(cases,result):
    by_id={x['id']:x for x in cases}
    metrics={};details=[]
    n=len(cases)
    eligible=sum(x['labels']['observationEligible'] for x in cases)
    roots=sum(x['labels']['root']['known'] for x in cases)
    for method in ['rules','direct','structured','citations','full']:
        rows=[]
        for record in result['records']:
            row=by_id[record['id']];outcome=record['outcomes'][method];value=outcome['output']
            refs=valid_references(row['trajectory'],value)
            correct=correctness(row,value,method);supported=support(row,value,method)
            rows.append({'id':row['id'],'method':method,'claim':claim(value),'rootClaim':root_claim(value),'correct':correct,'supported':supported,'references':refs,'executionError':outcome['executionError'],'localSeconds':outcome['localSeconds'],
                'knownRootCorrect':bool(root_claim(value) and row['labels']['root']['known'] and value.get('moduleId')==row['labels']['root']['moduleId'] and value.get('category')==row['labels']['root']['category'] and correct is True),
                'effectiveObservation':bool(claim(value) and not root_claim(value) and row['labels']['observationEligible'] and correct is True and supported is True),
                'falseRefusal':bool(method=='full' and claim(row['candidate']) and row['labels']['candidateCorrect'] is True and row['labels']['candidateSupported'] is True and not claim(value))})
        claims=sum(x['claim'] for x in rows);judged=sum(x['claim'] and x['correct'] is not None for x in rows)
        correct=sum(x['claim'] and x['correct'] is True for x in rows)
        wrong=sum(x['claim'] and x['correct'] is False for x in rows)
        unsupported=sum(x['claim'] and x['supported'] is False for x in rows)
        unknown=sum(x['claim'] and x['correct'] is None for x in rows)
        attempts=sum(x['rootClaim'] for x in rows)
        known_attempts=sum(x['rootClaim'] and by_id[x['id']]['labels']['root']['known'] for x in rows)
        root_correct=sum(x['knownRootCorrect'] for x in rows)
        reference_count=sum(x['references']['references'] for x in rows)
        accepted_supported=sum(x['claim'] and x['supported'] is True for x in rows)
        latency=sorted(x['localSeconds'] for x in rows)
        metrics[method]={'cases':n,'claims':claims,'claimCoverage':ratio(claims,n),'abstentions':n-claims-sum(bool(x['executionError']) for x in rows),'executionErrors':sum(bool(x['executionError']) for x in rows),'abstentionRate':ratio(n-claims-sum(bool(x['executionError']) for x in rows),n),
            'judgedClaims':judged,'correctClaims':correct,'wrongClaims':wrong,'unjudgedClaims':unknown,'acceptedAccuracy':ratio(correct,judged),'knownWrongAttributionRate':ratio(wrong,n),'selectiveKnownErrorRisk':ratio(wrong,judged),'unsupportedClaims':unsupported,'unsupportedClaimRate':ratio(unsupported,n),'acceptedSupportPrecision':ratio(accepted_supported,claims),
            'references':reference_count,'validReferences':sum(x['references']['valid'] for x in rows),'evidenceReferenceValidity':ratio(sum(x['references']['valid'] for x in rows),reference_count),'claimsWithValidEvidence':sum(x['claim'] and x['references']['claimHasValidEvidence'] for x in rows),
            'observationEligibleCases':eligible,'effectiveObservationCases':sum(x['effectiveObservation'] for x in rows),'effectiveObservationCoverage':ratio(sum(x['effectiveObservation'] for x in rows),eligible),
            'knownRootCases':roots,'rootClaims':attempts,'knownRootClaims':known_attempts,'correctKnownRoots':root_correct,'rootClassificationAccuracyAllKnown':ratio(root_correct,roots),'selectiveKnownRootAccuracy':ratio(root_correct,known_attempts),'rootClaimCoverage':ratio(attempts,n),'rootAbstentionRate':ratio(n-attempts,n),'falseRefusals':[x['id'] for x in rows if x['falseRefusal']],
            'localLatencySeconds':{'median':statistics.median(latency) if latency else None,'p95NearestRank':latency[max(0,math.ceil(.95*len(latency))-1)] if latency else None},'llmTokens':None,'llmLatencySeconds':None,'supplierCost':None}
        details.extend(rows)
    return {'metrics':metrics,'caseMetrics':details,'riskCoveragePoints':[{'gate':m,'coverage':v['claimCoverage'],'knownErrorRisk':v['selectiveKnownErrorRisk'],'judgedClaims':v['judgedClaims'],'unjudgedClaims':v['unjudgedClaims'],'supportRisk':ratio(v['unsupportedClaims'],v['claims'])} for m,v in metrics.items()],
        'confidenceInterval':'None: small, authored fixtures; no iid or generalization assumption. Zero observed errors is not proof of zero real risk.'}
