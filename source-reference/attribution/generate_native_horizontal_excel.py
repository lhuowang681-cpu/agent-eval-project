from pathlib import Path
import os,json,re
import pandas as pd
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment,Border,Side
from openpyxl.utils import get_column_letter
from trace_denoiser import denoise_trace_nodes
from representative_case_selector import select_representative_trace
BASE=Path(os.getenv('ANALYSIS_OUTPUT_DIR','output/real_analysis'));OUT=BASE/'compact_deliverables';SRC=Path(os.environ['SOURCE_XLSX'])
df=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')));raw=pd.read_excel(SRC,sheet_name='RAW_NODES');events=pd.read_excel(SRC,sheet_name='ERROR_EVENTS');selected,audit,selection_rules,category_rank,signature_rank=select_representative_trace(df,events,raw);tid=selected['trace_id'];g=raw[raw.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last');e=events[events.effective_trace_id.eq(tid)].sort_values('created_at');first=e.iloc[0];before=g[g.created_at<first.created_at];after=g[g.created_at>first.created_at];den=denoise_trace_nodes(g.to_dict('records'),max_nodes=35)
def clean(v,n=380):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip();return s[:n]+('…' if len(s)>n else '')
user=g[g.role.eq('user')];user_text=clean(user.iloc[0].content if len(user) else '用户请求缺失',280)
def is_actual_tool_failure(content):
 if content is None or (isinstance(content,float) and pd.isna(content)):return False
 s=str(content).strip()
 try:
  obj=json.loads(s);data=obj.get('data') if isinstance(obj.get('data'),dict) else {}
  return obj.get('success') is False or str(obj.get('status','')).upper() in {'FAILED','ERROR'} or str(data.get('currentStatus','')).upper() in {'FAILED','ERROR_STATE'}
 except Exception:
  return bool(re.fullmatch(r'.*(?:request|execution|tool) failed.*',s,re.I|re.S)) and len(s)<1000
before_fail=int(before[before.role.eq('tool')].content.map(is_actual_tool_failure).sum())
BLUE='1570EF';RED='D92D20';GRAY='475467';DARK='172033';BORDER='D0D5DD';WHITE='FFFFFF';HEADER='1F4E78';thin=Side(style='thin',color=BORDER)
wb=Workbook();wb.views[0].showVerticalScroll=True;wb.views[0].showHorizontalScroll=True
ws=wb.active;ws.title='SUMMARY';ws.column_dimensions['A'].width=25;ws.column_dimensions['B'].width=80
summary=[('最高频错误类别','模型流连接中断'),('Trace 数',35),('占全部 Badcase','18.9%'),('归因','L5 Model Runtime 层 → L5.5 Stream Processors'),('代表 Trace',tid),('主流错误形态',selected['signature']),('该形态 Trace 数',selected['signature_frequency'])]
ws.append(['指标','数据']);
for c in ws[1]:c.fill=PatternFill('solid',fgColor=HEADER);c.font=Font(color=WHITE,bold=True)
for r in summary:ws.append(r)
# Native horizontal cards
case=wb.create_sheet('TRACE_CASE');case.sheet_view.showGridLines=False;case.sheet_view.zoomScale=70
widths={'A':3,'B':18,'C':18,'D':18,'E':5,'F':18,'G':18,'H':18,'I':5,'J':18,'K':18,'L':18,'M':3}
for c,w in widths.items():case.column_dimensions[c].width=w
info=[('Trace ID',tid),('Provider / Model',f"{first.provider} / {first.model}"),('报错时间',str(first.created_at)),('错误类型',first.error_type),('错误信息',first.error_message),('归因','L5 Model Runtime 层 → L5.5 Stream Processors')]
for rr,(k,v) in enumerate(info,1):
 case.merge_cells(start_row=rr,start_column=2,end_row=rr,end_column=3);case.cell(rr,2,k);case.cell(rr,2).fill=PatternFill('solid',fgColor='D9EAF7');case.cell(rr,2).font=Font(bold=True)
 case.merge_cells(start_row=rr,start_column=4,end_row=rr,end_column=12);case.cell(rr,4,v);case.cell(rr,4).alignment=Alignment(wrap_text=True,vertical='top');case.row_dimensions[rr].height=24
stages=[
 ('1  报错前执行',BLUE,'EFF8FF',f"用户请求\n{user_text}\n\nAssistant：{int((before.role=='assistant').sum())} 轮\nTool：{int((before.role=='tool').sum())} 次",2,4),
 ('2  发生报错',RED,'FEE4E2',f"时间\n{first.created_at}\n\n错误类型\n{first.error_type}\n\n错误信息\n{first.error_message}\nTypeError: network error",6,8),
 ('3  报错后执行',GRAY,'F2F4F7',f"Assistant：{int((after.role=='assistant').sum())} 轮\nTool：{int((after.role=='tool').sum())} 次\n\n同一 Trace 后续仍有执行。\n当前数据无法确认属于恢复、重试或并行分支。",10,12)]
header_top=9;header_bottom=11;body_top=12;body_bottom=34
for title,color,bg,body,cs,ce in stages:
 case.merge_cells(start_row=header_top,start_column=cs,end_row=header_bottom,end_column=ce);h=case.cell(header_top,cs);h.value=title;h.fill=PatternFill('solid',fgColor=color);h.font=Font(color=WHITE,bold=True,size=16);h.alignment=Alignment(horizontal='center',vertical='center')
 case.merge_cells(start_row=body_top,start_column=cs,end_row=body_bottom,end_column=ce);b=case.cell(body_top,cs);b.value=body;b.fill=PatternFill('solid',fgColor=bg);b.font=Font(color=DARK,size=12);b.alignment=Alignment(wrap_text=True,vertical='top');b.border=Border(left=thin,right=thin,bottom=thin)
# arrows in independent columns
for col in [5,9]:
 case.merge_cells(start_row=19,start_column=col,end_row=23,end_column=col);a=case.cell(19,col);a.value='→';a.font=Font(size=24,bold=True,color='98A2B3');a.alignment=Alignment(horizontal='center',vertical='center')
for r in range(9,36):case.row_dimensions[r].height=22
case['B38']='';case.row_dimensions[38].height=20
# Rules separate
rules=wb.create_sheet('RULES');rules.column_dimensions['A'].width=22;rules.column_dimensions['B'].width=90
rules.append(['去噪统计','数据']);stats=[('原始节点数',den['stats']['raw_nodes']),('去重后节点数',den['stats']['deduplicated_nodes']),('保留证据节点数',den['stats']['retained_nodes']),('移除节点数',den['stats']['removed_nodes']),('错误节点数',den['stats']['error_nodes'])]
for r in stats:rules.append(r)
rules.append([]);rules.append(['去噪规则','说明']);denoise_rules=[('节点去重','相同 node_id 仅保留最后一条记录'),('移除展示噪音','移除系统指令、工具 Manifest、Base64/Data URI；超长内容显式截断'),('保留错误节点','所有 is_error/Error Body 节点保留'),('保留父链','保留错误节点至根节点的 Parent 祖先链'),('保留错误时间窗口','保留错误节点前后相邻节点'),('保留直接子节点','保留错误节点的直接 Child 节点'),('保留关键角色','保留报错前最近的 User、Assistant、Tool、Task'),('审计口径','TRACE_AUDIT 每行是证据节点，不是一轮对话或模型调用')]
for r in denoise_rules:rules.append(r)
rules.append([]);rules.append(['代表 Trace 选择规则','说明'])
for _,r in selection_rules.iterrows():rules.append((r.selection_gate,r.definition))
for hr in [1,8,18]:
 for c in rules[hr]:c.fill=PatternFill('solid',fgColor=HEADER);c.font=Font(color=WHITE,bold=True)
# Audit
ad=wb.create_sheet('TRACE_AUDIT');heads=['证据节点序号']+list(den['nodes'][0].keys());ad.append(heads)
for i,n in enumerate(den['nodes'],1):ad.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(dict,list)) else n[k] for k in den['nodes'][0].keys()])
for c in ad[1]:c.fill=PatternFill('solid',fgColor=HEADER);c.font=Font(color=WHITE,bold=True)
ad.freeze_panes='A2';ad.auto_filter.ref=ad.dimensions;ad.sheet_view.zoomScale=80
for sh in wb.worksheets:
 for row in sh.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
 if sh.title not in {'TRACE_CASE'}:
  for col in sh.columns:
   vals=list(col);sh.column_dimensions[get_column_letter(vals[0].column)].width=min(48,max(10,max(len(str(x.value or '')) for x in vals[:300])+2))
out=OUT/'03_top_error_single_case_hard_errors_only.xlsx';wb.save(out);print(json.dumps({'excel':str(out),'trace_id':tid,'layout':'horizontal_native_cells','images':len(case._images),'trace_rows':case.max_row,'rules_rows':rules.max_row,'audit_nodes':ad.max_row-1},ensure_ascii=False,indent=2))
