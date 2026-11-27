"""为结构化 JSONL 日报提取合格代表 Trace 和权重审计。"""
from pathlib import Path
import argparse,json,sys
import pandas as pd
HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from generate_new_export_deliverable_v2 import select_module_top5
from cause_convergence import medoid

def main():
 p=argparse.ArgumentParser();p.add_argument('--input-dir',required=True);p.add_argument('--classified-internal',required=True);p.add_argument('--output-dir',required=True);a=p.parse_args();src=Path(a.input_dir);out=Path(a.output_dir);out.mkdir(parents=True,exist_ok=True);d=pd.read_csv(a.classified_internal)
 rank,audit=select_module_top5(d);selected=[]
 for r in rank.itertuples():
  # 与正式日报渲染器保持严格一致：模块、二级问题、影响状态必须同时匹配，
  # 防止准备阶段选中“已恢复”Trace，而渲染阶段改选“硬失败”Trace，造成审计证据为空。
  q=d[
   (d.category==r.category)
   &(d.module_id==r.module_id)
   &(d.badcase_kind==r.badcase_kind)
  ].to_dict('records')
  if not q:
   raise RuntimeError(f'代表 Case 无严格匹配候选: {r.module_id}/{r.category}/{r.badcase_kind}')
  rep,_=medoid(q,'context')
  selected.append({'module_id':r.module_id,'category':r.category,'badcase_kind':r.badcase_kind,'trace_id':str(rep['trace_id']),'topic_id':str(rep['topic_id']),'score':float(r.development_score)})
 ids={x['trace_id'] for x in selected};found={}
 for fp in sorted(src.glob('part_*.jsonl')):
  with fp.open(encoding='utf-8',errors='replace') as f:
   for line in f:
    if not any(t in line[:500] for t in ids):continue
    x=json.loads(line);tid=str(x.get('id'))
    if tid in ids:found[tid]={'id':tid,'timestamp':x.get('timestamp',''),'name':x.get('name',''),'userId':x.get('userId',''),'sessionId':x.get('sessionId',''),'release':x.get('release',''),'environment':x.get('environment',''),'tags':x.get('tags',[]),'parts':[x.get('input','')]}
 (out/'representative_traces.jsonl').write_text('\n'.join(json.dumps(found[t],ensure_ascii=False) for t in ids if t in found)+'\n',encoding='utf-8');audit.to_csv(out/'weight_audit.csv',index=False,encoding='utf-8-sig');(out/'selection.json').write_text(json.dumps({'rank':rank.to_dict('records'),'selected':selected},ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'top_modules':[x['module_id'] for x in selected],'representatives':len(found)},ensure_ascii=False))
if __name__=='__main__':main()
