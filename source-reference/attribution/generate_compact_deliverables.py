from pathlib import Path
import os, json, math
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
from openpyxl.styles import Font,PatternFill,Alignment
from trace_denoiser import denoise_trace_nodes

BASE=Path(os.getenv('ANALYSIS_OUTPUT_DIR','output/real_analysis')); OUT=BASE/'compact_deliverables'; OUT.mkdir(parents=True,exist_ok=True)
df=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')))
mask=df.module_id.eq('L8.3')|df.badcase_kind.eq('observability_gap')|df.module_id.eq('UNCLASSIFIED')
dev=df[~mask].copy(); total=len(df)
cat=(dev.groupby(['error_category','error_category_zh','layer_id','layer_name','module_id','module_name']).size().reset_index(name='count').sort_values('count',ascending=False).reset_index(drop=True)); cat['pct_all']=(cat['count']/total*100).round(1)
mod=(dev.groupby(['module_id','module_name','layer_id','layer_name']).size().reset_index(name='count').sort_values('count',ascending=False).reset_index(drop=True)); mod['pct_dev']=(mod['count']/len(dev)*100).round(1)
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']: matplotlib.rcParams['font.family']=f; break
matplotlib.rcParams['axes.unicode_minus']=False
COL=['#D92D20','#F79009','#1570EF','#12B76A','#7A5AF8','#06AED4','#EE46BC','#6172F3','#F63D68','#2E90FA','#039855','#DC6803','#475467']

# Chart 1: Top 5 only, no title/banner, annotation data only.
d=cat.head(5).iloc[::-1]; fig,ax=plt.subplots(figsize=(12,5.8)); bars=ax.barh(range(5),d['count'],color=COL[:5][::-1],height=.58)
ax.set_yticks(range(5)); ax.set_yticklabels(d.error_category_zh,fontsize=12); ax.set_xlabel('Trace',fontsize=10)
for b,(_,r) in zip(bars,d.iterrows()): ax.text(b.get_width()+.3,b.get_y()+b.get_height()/2,f"{int(r['count'])} ({r.pct_all:.1f}%)",va='center',fontsize=12,fontweight='bold')
ax.set_xlim(0,d['count'].max()*1.28); ax.spines[['top','right','left']].set_visible(False); ax.grid(axis='x',alpha=.13); ax.tick_params(axis='y',length=0)
plt.tight_layout(); fig.savefig(OUT/'01_top5_badcase.png',dpi=200,bbox_inches='tight',facecolor='white'); plt.close(fig)

# Chart 2: module-level pie, top modules + other; labels are module IDs/names, not layers.
topn=8; pie=mod.head(topn).copy(); rest=int(mod.iloc[topn:]['count'].sum())
labels=[f"{r.module_id} {r.module_name}" for _,r in pie.iterrows()]; vals=pie['count'].astype(int).tolist()
if rest: labels.append('其他模块'); vals.append(rest)
fig,ax=plt.subplots(figsize=(12,8)); wedges,texts,autos=ax.pie(vals,labels=None,autopct=lambda p:f'{p:.1f}%' if p>=2 else '',startangle=90,colors=COL[:len(vals)],pctdistance=.72,wedgeprops={'linewidth':1.5,'edgecolor':'white'},textprops={'fontsize':10})
for a in autos:a.set_fontweight('bold');a.set_color('white')
legend=[f"{lab}  {v}" for lab,v in zip(labels,vals)]; ax.legend(wedges,legend,loc='center left',bbox_to_anchor=(.98,.5),frameon=False,fontsize=10); ax.axis('equal')
plt.tight_layout(); fig.savefig(OUT/'02_module_distribution_pie.png',dpi=200,bbox_inches='tight',facecolor='white'); plt.close(fig)

# Excel for highest developer error category.
top=cat.iloc[0]; cases=dev[dev.error_category.eq(top.error_category)].copy().sort_values(['confidence','event_count'],ascending=False)
src=Path(os.environ['SOURCE_XLSX'])
raw=pd.read_excel(src,sheet_name='RAW_NODES'); events=pd.read_excel(src,sheet_name='ERROR_EVENTS'); manifest=pd.read_excel(src,sheet_name='TRACE_MANIFEST')
# Usage aggregation
def usage(v):
 try:m=json.loads(v) if isinstance(v,str) else {}
 except:m={}
 keys=['totalInputTokens','totalOutputTokens','inputCachedTokens','inputCacheMissTokens','inputWriteCacheTokens','cost'];return {k:pd.to_numeric(m.get(k),errors='coerce') for k in keys}
ur=[]
for _,r in raw[raw.effective_trace_id.isin(cases.trace_id)].iterrows():
 u=usage(r.metadata)
 if any(pd.notna(x) for x in u.values()):ur.append({'trace_id':r.effective_trace_id,'node_id':r.id,**u})
if ur:
 u=pd.DataFrame(ur).drop_duplicates('node_id'); ug=u.groupby('trace_id').agg(rounds=('node_id','size'),input_tokens=('totalInputTokens','sum'),output_tokens=('totalOutputTokens','sum'),cached_tokens=('inputCachedTokens','sum'),miss_tokens=('inputCacheMissTokens','sum'),write_tokens=('inputWriteCacheTokens','sum'),cost=('cost','sum')).reset_index(); ug['cache_hit_pct']=(ug.cached_tokens/ug.input_tokens*100).round(1)
else:ug=pd.DataFrame(columns=['trace_id'])
cases=cases.merge(ug,on='trace_id',how='left').merge(manifest,left_on='trace_id',right_on='effective_trace_id',how='left').drop(columns=['effective_trace_id'],errors='ignore')
# All highest-category cases and denoised causal trace, not only representative cases.
trace_rows=[]
for case_no,tid in enumerate(cases.trace_id,1):
 den=denoise_trace_nodes(raw[raw.effective_trace_id.eq(tid)].to_dict('records'),max_nodes=30)
 for seq,n in enumerate(den['nodes'],1):
  trace_rows.append({'case_no':case_no,'trace_id':tid,'seq':seq,'time':n['created_at'],'role':n['role'],'is_error':n['is_error'],'node_id':n['node_id'],'parent_id':n['parent_id'],'keep_reason':','.join(n['retention_reason']),'provider':n['provider'],'model':n['model'],'error_type':n['error_type'],'error_message':n['error_message'],'error_detail':n['error_detail'],'content':n['content'],'reasoning':n['reasoning'],'tools':','.join(n['tool_names']),'tool_signals':' | '.join(n['tool_signals'])})
trace=pd.DataFrame(trace_rows)
summary=pd.DataFrame([
 ['error_category',top.error_category_zh],['trace_count',int(top['count'])],['pct_all_badcase',f'{top.pct_all:.1f}%'],['layer',f'{top.layer_id} {top.layer_name}'],['module',f'{top.module_id} {top.module_name}']
],columns=['metric','value'])
case_cols=[c for c in ['trace_id','trace_timestamp','provider','model','agent_id','original_error_type','all_error_types','confidence','event_count','chain_node_count','first_error_at','last_error_at','error_count','node_count','rounds','input_tokens','output_tokens','cached_tokens','miss_tokens','write_tokens','cache_hit_pct','cost','reason','evidence'] if c in cases]
for c in ['all_error_types','evidence']:
 if c in cases:cases[c]=cases[c].apply(lambda x:json.dumps(x,ensure_ascii=False) if isinstance(x,(list,dict)) else x)
xlsx=OUT/'03_top_error_cases.xlsx'
with pd.ExcelWriter(xlsx,engine='openpyxl') as w:
 summary.to_excel(w,sheet_name='SUMMARY',index=False)
 cases[case_cols].to_excel(w,sheet_name='CASES',index=False)
 trace.to_excel(w,sheet_name='DENOISED_TRACE',index=False)
wb=__import__('openpyxl').load_workbook(xlsx); fill=PatternFill('solid',fgColor='1F4E78'); font=Font(color='FFFFFF',bold=True)
for ws in wb.worksheets:
 ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 for c in ws[1]:c.fill=fill;c.font=font;c.alignment=Alignment(horizontal='center')
 for col in ws.columns:
  vals=list(col);ws.column_dimensions[vals[0].column_letter].width=min(45,max(10,max(len(str(x.value or '')) for x in vals[:400])+2))
 for row in ws.iter_rows(min_row=2):
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
wb.save(xlsx)
cat.head(5).to_csv(OUT/'top5_badcase_data.csv',index=False,encoding='utf-8-sig');mod.to_csv(OUT/'module_pie_data.csv',index=False,encoding='utf-8-sig')
print(json.dumps({'top5':cat.head(5)[['error_category_zh','count','pct_all']].to_dict('records'),'pie_modules':len(vals),'top_error':top.error_category_zh,'top_cases':len(cases),'denoised_trace_rows':len(trace),'outputs':[str(OUT/'01_top5_badcase.png'),str(OUT/'02_module_distribution_pie.png'),str(xlsx)]},ensure_ascii=False,indent=2))
