from pathlib import Path
import json,re
import pandas as pd
from PIL import Image,ImageDraw,ImageFont
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.drawing.image import Image as XLImage
from trace_denoiser import denoise_trace_nodes
from representative_case_selector import select_representative_trace

BASE=Path('output/real_analysis'); OUT=BASE/'compact_deliverables'; SRC=Path(r'D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx')
df=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8'))); raw=pd.read_excel(SRC,sheet_name='RAW_NODES'); events=pd.read_excel(SRC,sheet_name='ERROR_EVENTS')
selected,audit,rules,cat_rank,sig_rank=select_representative_trace(df,events,raw); tid=selected['trace_id']; g=raw[raw.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last'); e=events[events.effective_trace_id.eq(tid)].sort_values('created_at'); first=e.iloc[0]; before=g[g.created_at<first.created_at]; after=g[g.created_at>first.created_at]; den=denoise_trace_nodes(g.to_dict('records'),max_nodes=35)
FONT=r'C:\Windows\Fonts\msyh.ttc';BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
def ft(n,b=False):
 try:return ImageFont.truetype(BOLD if b else FONT,n)
 except:return ImageFont.load_default()
def clean(v,n=160):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip();return s[:n]+('…' if len(s)>n else '')
def wrap(d,s,f,w):
 out=[]
 for p in str(s).splitlines() or ['']:
  cur=''
  for ch in p:
   if d.textbbox((0,0),cur+ch,font=f)[2]<=w:cur+=ch
   else:
    if cur:out.append(cur)
    cur=ch
  if cur:out.append(cur)
 return out
user=g[g.role.eq('user')]; user_text=clean(user.iloc[0].content if len(user) else '用户请求缺失',180)
before_tool_fail=int(before.content.fillna('').str.contains('success[^a-zA-Z]*false|failed|ERROR_STATE|timeout',case=False,regex=True).sum())
stages=[
 ('1 报错前执行',f"用户：{user_text}\n\nAssistant {int((before.role=='assistant').sum())} 轮\nTool {int((before.role=='tool').sum())} 次\n其中工具失败/超时信号 {before_tool_fail} 次",'#EFF8FF','#1570EF'),
 ('2 发生报错',f"时间：{first.created_at}\n\n{first.error_type}\n{first.error_message}\n\nTypeError: network error",'#FEE4E2','#D92D20'),
 ('3 报错后执行',f"Assistant {int((after.role=='assistant').sum())} 轮\nTool {int((after.role=='tool').sum())} 次\n\n说明：同一 Trace 后续仍有执行；无法仅凭当前数据确认是恢复、重试还是并行分支。",'#F2F4F7','#475467')]
W,H=2400,1050;im=Image.new('RGB',(W,H),'white');d=ImageDraw.Draw(im);d.text((70,35),'模型流连接中断',font=ft(42,True),fill='#172033');d.text((70,100),f"{tid}  |  {first.provider} / {first.model}",font=ft(25),fill='#667085')
x0=70;y=190;gap=90;bw=(W-140-gap*2)//3;bh=700;th=110;pad=34;lh=42
for i,(title,body,bg,edge) in enumerate(stages):
 x=x0+i*(bw+gap);d.rounded_rectangle((x,y,x+bw,y+bh),25,fill=bg,outline=edge,width=5);d.rounded_rectangle((x+5,y+5,x+bw-5,y+th),20,fill='white');d.text((x+pad,y+34),title,font=ft(31,True),fill=edge)
 top=y+th+38;bottom=y+bh-35;lines=wrap(d,body,ft(25),bw-pad*2);mx=(bottom-top)//lh
 if len(lines)>mx:lines=lines[:mx];lines[-1]=lines[-1][:-1]+'…'
 yy=top
 for line in lines:d.text((x+pad,yy),line,font=ft(25),fill='#344054');yy+=lh
 if i<2:
  ax=x+bw+16;ay=y+bh//2;d.line((ax,ay,x+bw+gap-22,ay),fill='#98A2B3',width=8);d.polygon([(x+bw+gap-22,ay),(x+bw+gap-52,ay-17),(x+bw+gap-52,ay+17)],fill='#98A2B3')
img=OUT/'single_representative_trace_3_stage.png';im.save(img)
# compact Excel
out=OUT/'03_top_error_single_case_scrollable_v2.xlsx';wb=Workbook();ws=wb.active;ws.title='SUMMARY';blue='1F4E78';light='D9EAF7'
for c,w in {'A':24,'B':72}.items():ws.column_dimensions[c].width=w
summary=[('最高频错误类别','模型流连接中断'),('Trace 数',35),('占全部 Badcase','18.9%'),('归因','L5 Model Runtime 层 → L5.5 Stream Processors'),('代表 Trace',tid),('主流错误形态',selected['signature']),('该形态 Trace 数',selected['signature_frequency'])]
ws.append(['指标','数据'])
for c in ws[1]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
for r in summary:ws.append(r)
case=wb.create_sheet('TRACE_CASE');case.sheet_view.showGridLines=False;case.sheet_view.zoomScale=75
wb.views[0].showVerticalScroll=True;wb.views[0].showHorizontalScroll=True
for c,w in {'A':24,'B':40,'C':40,'D':40,'E':64}.items():case.column_dimensions[c].width=w
info=[('Trace ID',tid),('Provider / Model',f"{first.provider} / {first.model}"),('报错时间',first.created_at),('错误类型',first.error_type),('错误信息',first.error_message),('归因','L5 Model Runtime 层 → L5.5 Stream Processors')]
for rr,(k,v) in enumerate(info,1):case.cell(rr,1,k);case.cell(rr,1).fill=PatternFill('solid',fgColor=light);case.cell(rr,1).font=Font(bold=True);case.merge_cells(start_row=rr,start_column=2,end_row=rr,end_column=5);case.cell(rr,2,v)
case['A8']='Trace 三段结构';case['A8'].font=Font(size=14,bold=True);pic=XLImage(img);pic.width=1500;pic.height=656;case.add_image(pic,'A10')
# Keep normal row heights. The floating image spans rows 10-42, so wheel scrolling remains continuous.
for rr in range(10,44):case.row_dimensions[rr].height=20
case['A44']='';case.row_dimensions[44].height=20
ad=wb.create_sheet('TRACE_AUDIT')
# Put denoising statistics and rule definitions in the same audit sheet.
ad.append(['去噪统计','数据'])
ad.append(['原始节点数',den['stats']['raw_nodes']])
ad.append(['去重后节点数',den['stats']['deduplicated_nodes']])
ad.append(['保留证据节点数',den['stats']['retained_nodes']])
ad.append(['移除节点数',den['stats']['removed_nodes']])
ad.append(['错误节点数',den['stats']['error_nodes']])
ad.append([])
ad.append(['去噪规则','说明'])
rule_rows=[
 ('节点去重','相同 node_id 仅保留最后一条记录'),
 ('移除展示噪音','移除大段系统指令、工具 Manifest、Base64/Data URI；超长内容显式截断'),
 ('保留错误节点','所有 is_error/Error Body 节点必须保留'),
 ('保留父链','保留错误节点指向根节点的完整 Parent 祖先链'),
 ('保留错误时间窗口','保留错误节点前后相邻节点，便于理解报错前后执行'),
 ('保留直接子节点','保留错误节点的直接 Child 节点'),
 ('保留关键角色','保留报错前最近的 User、Assistant、Tool、Task 节点'),
 ('审计口径','下方每一行是一个证据节点，不代表一轮对话或一次模型调用'),
]
for r in rule_rows:ad.append(r)
ad.append([])
heads=['证据节点序号']+list(den['nodes'][0].keys());ad.append(heads)
header_row=ad._current_row
for i,n in enumerate(den['nodes'],1):ad.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(dict,list)) else n[k] for k in den['nodes'][0].keys()])
for row_idx in [1,8,header_row]:
 for c in ad[row_idx]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
ad.freeze_panes=f'A{header_row+1}';ad.auto_filter.ref=f'A{header_row}:{ad.cell(ad.max_row,len(heads)).coordinate}'
for sh in wb.worksheets:
 for row in sh.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
wb.save(out);print(json.dumps({'excel':str(out),'image':str(img),'trace_id':tid,'before':{'assistant':int((before.role=='assistant').sum()),'tool':int((before.role=='tool').sum()),'tool_failure_signals':before_tool_fail},'after':{'assistant':int((after.role=='assistant').sum()),'tool':int((after.role=='tool').sum())}},ensure_ascii=False,indent=2))
