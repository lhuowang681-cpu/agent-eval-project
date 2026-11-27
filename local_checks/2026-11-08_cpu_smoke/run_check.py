"""CPU-only checks against unchanged reference code, using synthetic data only.
Run with: python -B local_checks/2026-11-08_cpu_smoke/run_check.py
No dotenv, credentials, external services, or model calls are used.
"""
from pathlib import Path
import os, sys, json, hashlib, time, subprocess, importlib.util, socket, runpy

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = ROOT / 'source-reference' / 'attribution'
sys.path.insert(0, str(SRC))

def blocked(*args, **kwargs):
    raise RuntimeError('Network disabled for this CPU smoke check')
socket.socket.connect = blocked
socket.socket.connect_ex = blocked
socket.create_connection = blocked

if len(sys.argv) > 1 and sys.argv[1] == '--child':
    sys.argv = [str(SRC / 'structured_jsonl_attribution.py'), '--input-dir', sys.argv[2], '--output-dir', sys.argv[3]]
    sys.path.insert(0, str(SRC))
    runpy.run_path(str(SRC / 'structured_jsonl_attribution.py'), run_name='__main__')
    raise SystemExit(0)

def dump(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

manifest=json.loads((ROOT/'SOURCE_MANIFEST.json').read_text(encoding='utf-8'))
def verify_sources():
    for f in manifest['files']:
        assert hashlib.sha256((ROOT/f['path']).read_bytes()).hexdigest() == f['sha256'], f['path']
verify_sources()

def assistant(cid, name, date='2026-11-08'):
    return {'role':'assistant','tool_calls':[{'id':cid,'function':{'name':name,'arguments':json.dumps({'date':date})}}]}
def result(cid, success, message):
    return {'role':'tool','tool_call_id':cid,'content':json.dumps({'success':success,'message':message})}
def trace(tid, messages, output=None):
    return {'id':tid,'sessionId':'session-'+tid,'timestamp':'2026-11-08T00:00:00Z','input':[{'role':'user','content':'Synthetic order query'}]+messages,'output':output or {}}

good=trace('good',[assistant('g','orders____builtin'),result('g',True,'Documentation about error handling; query succeeded')])
internal=trace('internal',[assistant('i1','orders____builtin','today'),result('i1',False,'invalid_argument: expected YYYY-MM-DD'),assistant('i2','orders____builtin','today'),result('i2',False,'invalid_argument: expected YYYY-MM-DD')])
external=trace('external',[assistant('e1','orders____mcp'),result('e1',False,'service unavailable')])
provider=trace('provider',[],{'errorType':'BadRequest','message':'No model specified'})
recovery=trace('unrelated-success',[assistant('r1','orders____builtin','today'),result('r1',False,'invalid_argument: expected YYYY-MM-DD'),assistant('r2','weather____builtin'),result('r2',True,'Sunny')])
cases=[good,internal,dict(internal),external,provider,recovery]

allowed=['SystemRoot','WINDIR','PATH','TEMP','TMP','COMSPEC','SYSTEMDRIVE']
child_env={k:os.environ[k] for k in allowed if k in os.environ}
child_env.update({'PYTHONUTF8':'1','PYTHONIOENCODING':'utf-8','PYTHONDONTWRITEBYTECODE':'1','MPLBACKEND':'Agg','MPLCONFIGDIR':str(HERE/'mpl-cache'),'OMP_NUM_THREADS':'1','OPENBLAS_NUM_THREADS':'1'})
os.environ.update({k:v for k,v in child_env.items() if k.startswith(('MPL','OMP','OPENBLAS'))})

def cli(name, rows=None, bad_line=False):
    data=HERE/'inputs'/name; data.mkdir(parents=True,exist_ok=True)
    lines=[json.dumps(x,ensure_ascii=False) for x in (rows or [])]
    if bad_line: lines.append('{not valid JSON')
    (data/'part_000.jsonl').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    out=HERE/'outputs'/name; out.mkdir(parents=True,exist_ok=True)
    start=time.perf_counter()
    p=subprocess.run([sys.executable,'-B',str(Path(__file__).resolve()),'--child',str(data),str(out)],env=child_env,cwd=HERE,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)
    elapsed=round(time.perf_counter()-start,3)
    (out/'stdout.log').write_text(p.stdout,encoding='utf-8')
    (out/'stderr.log').write_text(p.stderr,encoding='utf-8')
    return {'name':name,'exitCode':p.returncode,'seconds':elapsed,'output':str(out.relative_to(ROOT))},out,p

checks=[]; findings=[]
res,out,p=cli('basic',cases)
assert p.returncode==0, p.stderr
summary=json.loads((out/'summary.json').read_text(encoding='utf-8'))
assert summary['input_traces']==6 and summary['failure_events']==5,summary
assert summary['internal_events']==4 and summary['external_events']==1,summary
classified=json.loads((out/'classified_all.json').read_text(encoding='utf-8'))
assert not any(r['trace_id']=='good' for r in classified)
assert sum(r['trace_id']=='internal' for r in classified)==2
checks.append({**res,'status':'passed','summary':summary,'notes':'Real reference CLI. Duplicate input exported twice; two actual retries preserved. These are narrow behavior checks, not attribution accuracy.'})
assert next(r for r in classified if r['trace_id']=='unrelated-success')['recovered'] is True
findings.append({'name':'unrelated_tool_success_mislabels_recovery','observed':'Order failure followed by weather success is marked recovered=True.','severity':'semantic limitation','reproduced':True})

batch=[]
for i in range(1000):
    cid=f'c-{i}'
    batch.append(trace(f'batch-{i}',[assistant(cid,'orders____builtin'),result(cid,i%4==0,'Success' if i%4==0 else 'invalid_argument: expected YYYY-MM-DD')]))
res,out,p=cli('batch_1000',batch)
assert p.returncode==0,p.stderr
batch_summary=json.loads((out/'summary.json').read_text(encoding='utf-8'))
assert batch_summary['input_traces']==1000 and batch_summary['failure_events']==750,batch_summary
checks.append({**res,'status':'passed','summary':batch_summary,'notes':'Synthetic short records, subprocess startup included. Not a production benchmark or model test.'})

res,out,p=cli('no_failures',[good])
assert p.returncode!=0 and 'actionability' in p.stderr,p.stderr
findings.append({**res,'name':'empty_failure_result_crashes_cli','observed':'All-success input causes KeyError: actionability when main accesses missing DataFrame columns.','reproduced':True})
res,out,p=cli('malformed_json',[good],bad_line=True)
assert p.returncode!=0 and 'JSONDecodeError' in p.stderr,p.stderr
findings.append({**res,'name':'bad_json_line_aborts_batch','observed':'Malformed line raises JSONDecodeError; no per-line quarantine.','reproduced':True})

def load(name):
    spec=importlib.util.spec_from_file_location('cpu_check_'+name,SRC/(name+'.py'))
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

den=load('trace_denoiser')
nodes=[{'id':'n1','parent_id':'','created_at':'2026-11-08T00:00:01Z','role':'user','content':'Query orders for 2026-11-08'},
       {'id':'n2','parent_id':'n1','created_at':'2026-11-08T00:00:02Z','role':'assistant','content':'date=today'},
       {'id':'n3','parent_id':'n2','created_at':'2026-11-08T00:00:03Z','role':'tool','is_error':True,'content':'invalid_argument'}]
d=den.denoise_trace_nodes(nodes,max_nodes=10)
assert {n['node_id'] for n in d['nodes']}=={'n1','n2','n3'}
dump(HERE/'outputs'/'denoised.json',d)
checks.append({'name':'original_denoiser','status':'passed','retainedNodes':len(d['nodes']),'notes':'Small synthetic ancestor chain only.'})

conv=load('cause_convergence')
rows=[{'trace_id':f'rep-{i}','session_key':f'task-{i}','trace_summary':text,'reason':'invalid argument','impact_status':'hard_failed'} for i,text in enumerate(['invalid date argument','invalid date argument','invalid date argument additional context'])]
c=conv.converge(rows)
assert c['representative']['trace_id'] in {r['trace_id'] for r in rows}
dump(HERE/'outputs'/'convergence.json',c)
checks.append({'name':'original_convergence_and_medoid','status':'passed','selectedTrace':c['representative']['trace_id'],'notes':'Three synthetic samples; no model or external embedding.'})

import pandas as pd
agg=load('aggregator')
df=pd.DataFrame(classified).rename(columns={'category':'error_category','category_zh':'error_category_zh'})
df['layer_id']=df['module_id'].str.split('.').str[0];df['layer_name']=df['layer_id'];df['needs_review']=df['needs_causal_review'];df['confidence']=0.0
cat,mod=agg.aggregate(df)
assert int(cat['count'].sum())==5
report_dir=HERE/'outputs'/'reports';report_dir.mkdir(parents=True,exist_ok=True)
agg.save_csv(cat,mod,str(report_dir),source_df=df)
vis=load('visualizer')
vis.chart1_error_category(cat,top_n=10,output_path=str(report_dir/'categories.png'))
vis.chart2_module_distribution(mod,top_n=10,output_path=str(report_dir/'modules.png'))
for name in ['categories.png','modules.png']:
    b=(report_dir/name).read_bytes();assert b.startswith(b'\x89PNG\r\n\x1a\n') and len(b)>1000
checks.append({'name':'original_aggregation_and_charts','status':'passed','output':str(report_dir.relative_to(ROOT)),'notes':'Original aggregator/visualizer on adapted rule-output columns. No claim that independent historical entrypoints were originally integrated.'})

import psutil, platform
verify_sources()
report={'date':'2026-11-08','machine':{'os':platform.platform(),'python':sys.version.split()[0],'logicalCPUs':os.cpu_count(),'ramGiB':round(psutil.virtual_memory().total/1024**3,1)},'gpuRequiredForExecutedPath':False,'network':'socket connections disabled in harness and CLI child; no external model/observability client imported','credentials':'No .env loaded; CLI child receives hardware/runtime allowlist env only','checks':checks,'limitationsReproduced':findings,'sourceHashesUnchanged':len(manifest['files']),'notTested':['full Agent web platform (no full app/build manifests or dependencies in selected reference package)','configuration to live Agent to evaluation integrated product','real LLM classification; openai/langfuse packages absent','PostgreSQL/Redis/remote tools','local LLM inference and any GPU performance'],'status':'CPU analysis smoke checks passed; three implementation limitations reproduced'}
dump(HERE/'RESULTS.json',report)
text=['# 本机CPU离线实测','日期：2026-11-08。只使用合成记录；运行原始JSONL CLI和已检查的纯处理模块，未修改参考源码。',f"环境：{report['machine']}。执行路径无需GPU；不代表已验证本地大模型推理。",'## 实测通过']
text += [f"- {x['name']}：通过"+(f"，耗时{x['seconds']}秒（含子进程启动）" if 'seconds' in x else '') for x in checks]
text += ['## 实际复现的局限']+[f"- {x['name']}：{x['observed']}" for x in findings]
text += ['## 未验证范围']+['- '+x for x in report['notTested']]
text += ['## 如何重复','在项目根运行：`python -B local_checks/2026-11-08_cpu_smoke/run_check.py`。此脚本阻止socket连接，子进程不传入模型凭据。输出覆盖本文件夹的合成测试产物，不访问用户数据。','报告文件为RESULTS.json，CLI标准输出与错误在outputs各场景目录，图表在outputs/reports。分类结果由旧启发式产生，不是人工确认根因或准确率。原始96文件hash检查前后一致。']
(HERE/'REPORT.md').write_text('\n\n'.join(text)+'\n',encoding='utf-8')
print(json.dumps({'passedChecks':len(checks),'reproducedLimitations':len(findings),'timing':{x['name']:x.get('seconds') for x in checks if 'seconds' in x},'unchangedReferences':len(manifest['files']),'report':str(HERE/'REPORT.md')},ensure_ascii=True,indent=2))
