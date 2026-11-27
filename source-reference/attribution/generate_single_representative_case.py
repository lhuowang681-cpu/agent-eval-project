from pathlib import Path
import json,re
import pandas as pd
from PIL import Image,ImageDraw,ImageFont
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.drawing.image import Image as XLImage
from trace_denoiser import denoise_trace_nodes
from representative_case_selector import select_representative_trace
BASE=Path('output/real_analysis');OUT=BASE/'compact_deliverables';SRC=Path(r'D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx')
df=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')))
raw=pd.read_excel(SRC,sheet_name='RAW_NODES');events=pd.read_excel(SRC,sheet_name='ERROR_EVENTS')
selected,score_audit,selection_rules,category_rank,signature_rank=select_representative_trace(df,events,raw)
TID=selected['trace_id'];rec=df[df.trace_id.eq(TID)].iloc[0]
g=raw[raw.effective_trace_id.eq(TID)].sort_values('created_at').drop_duplicates('id',keep='last');e=events[events.effective_trace_id.eq(TID)].sort_values('created_at');den=denoise_trace_nodes(g.to_dict('records'),max_nodes=35)
FONT=r'C:\Windows\Fonts\msyh.ttc';BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
def ft(n,b=False):
 try:return ImageFont.truetype(BOLD if b else FONT,n)
 except:return ImageFont.load_default()
def clean(v,n=220):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip();return s[:n]+('…' if len(s)>n else '')
def wrap(d,s,f,w):
 out=[]
 for para in str(s).splitlines() or ['']:
  cur=''
  for ch in para:
   if d.textbbox((0,0),cur+ch,font=f)[2]<=w:cur+=ch
   else:
    if cur:out.append(cur)
    cur=ch
  if cur:out.append(cur)
 return out
def error_detail(v):
 try:d=json.loads(v) if isinstance(v,str) else {}
 except:d={}
 vals=[]
 def walk(x):
  if isinstance(x,dict):
   for k,z in x.items():
    if k.lower() in {'type','name','code','status','message','reason'} and not isinstance(z,(dict,list)):vals.append(f'{k}: {z}')
    elif isinstance(z,(dict,list)):walk(z)
 walk(d);return clean(' | '.join(dict.fromkeys(vals)),420)
first=e.iloc[0];user=g[g.role.eq('user')];before=g[g.created_at<first.created_at];after=g[g.created_at>first.created_at]
tools=[]
for n in den['nodes']:tools+=n.get('tool_names',[])
tools=list(dict.fromkeys(tools));ebody=error_detail(first.error_raw)
stages=[('用户请求',clean(user.iloc[0].content if len(user) else '用户请求缺失',180),'normal'),('正常执行',f"Assistant {int((before.role=='assistant').sum())} 轮\nTool {int((before.role=='tool').sum())} 次\n{', '.join(tools[:5])}",'normal'),('首次异常',f"{first.created_at}\n{first.error_type}\n{first.error_message}\nTypeError: network error",'root'),('异常传播',f"流式连接中断\n首错后 Assistant {int((after.role=='assistant').sum())} 轮\nTool {int((after.role=='tool').sum())} 次",'prop'),('最终表现','模型流未正常完成\n回答可能不完整或停止','final')]
# image
W,H=3000,1120;im=Image.new('RGB',(W,H),'white');dr=ImageDraw.Draw(im);dr.text((70,35),f"模型流连接中断  |  Trace {TID}",font=ft(40,True),fill='#172033');dr.text((70,98),'ada / claude-sonnet-4-6',font=ft(26),fill='#667085')
x0=65;y=175;gap=82;bw=(W-130-gap*4)//5;bh=780;th=112;fh=70;pad=28;lh=39;colors={'normal':('#EFF8FF','#1570EF'),'root':('#FEE4E2','#D92D20'),'prop':('#FEF0C7','#F79009'),'final':('#F2F4F7','#475467')}
for i,(title,body,kind) in enumerate(stages):
 x=x0+i*(bw+gap);bg,edge=colors[kind];dr.rounded_rectangle((x,y,x+bw,y+bh),24,fill=bg,outline=edge,width=5);dr.rounded_rectangle((x+5,y+5,x+bw-5,y+th),19,fill='white');dr.text((x+pad,y+34),f'{i+1} {title}',font=ft(29,True),fill=edge)
 top=y+th+28;bottom=y+bh-fh-18;lines=wrap(dr,body,ft(24),bw-pad*2);mx=(bottom-top)//lh
 if len(lines)>mx:lines=lines[:mx];lines[-1]=lines[-1][:-1]+'…'
 yy=top
 for line in lines:dr.text((x+pad,yy),line,font=ft(24),fill='#344054');yy+=lh
 status={'normal':'正常','root':'异常起点','prop':'异常传播','final':'用户表现'}[kind];dr.line((x+20,y+bh-fh,x+bw-20,y+bh-fh),fill=edge,width=2);dr.text((x+pad,y+bh-fh+22),status,font=ft(20),fill=edge)
 if i<4:
  ax=x+bw+14;ay=y+bh//2;dr.line((ax,ay,x+bw+gap-20,ay),fill='#98A2B3',width=7);dr.polygon([(x+bw+gap-20,ay),(x+bw+gap-46,ay-15),(x+bw+gap-46,ay+15)],fill='#98A2B3')
img=OUT/'single_representative_trace.png';im.save(img)
# Excel
out=OUT/'03_top_error_single_representative_case_no_title.xlsx';wb=Workbook();ws=wb.active;ws.title='SUMMARY';blue='1F4E78';light='D9EAF7'
for col,w in {'A':24,'B':68}.items():ws.column_dimensions[col].width=w
summary=[('最高频错误类别','模型流连接中断'),('类别 Trace 数',35),('占全部 Badcase','18.9%'),('归因层','L5 Model Runtime 层'),('责任模块','L5.5 Stream Processors'),('代表 Trace',TID),('Provider / Model','ada / claude-sonnet-4-6'),('首次报错时间',str(first.created_at)),('Trace 内失败调用数',1),('错误类型',first.error_type),('关键错误信息',first.error_message),('主流错误签名',selected['signature']),('该签名 Trace 数',selected['signature_frequency']),('选择规则','分层筛选：最高频类别 → 最主流错误签名 → 信息最全且可调试 → 主流 Provider/Model → 失败次数众数/链路长度中位数 → 固定并列规则')]
ws.append(['指标','数据'])
for c in ws[1]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
for r in summary:ws.append(r)
case=wb.create_sheet('TRACE_CASE');case.sheet_view.showGridLines=False
for col,w in {'A':22,'B':38,'C':38,'D':38,'E':72}.items():case.column_dimensions[col].width=w
info=[('Trace ID',TID),('用户请求',clean(user.iloc[0].content if len(user) else '',500)),('归因结论','L5 Model Runtime 层 → L5.5 Stream Processors'),('归因理由','模型已开始流式输出，随后发生 TypeError: network error / ConnectionAborted；异常起点位于流处理链路。'),('关键 Error Body',ebody),('涉及工具',', '.join(tools[:15]))]
for rr,(k,v) in enumerate(info,1):case.cell(rr,1,k);case.cell(rr,1).fill=PatternFill('solid',fgColor=light);case.cell(rr,1).font=Font(bold=True);case.merge_cells(start_row=rr,start_column=2,end_row=rr,end_column=5);case.cell(rr,2,v);case.cell(rr,2).alignment=Alignment(wrap_text=True,vertical='top')
case['A8']='Trace 链路图';case['A8'].font=Font(size=14,bold=True);pic=XLImage(img);pic.width=1500;pic.height=560;case.add_image(pic,'A10');case.row_dimensions[10].height=425
rule_ws=wb.create_sheet('SELECTION_RULE');rule_ws.append(list(selection_rules.columns))
for row in selection_rules.itertuples(index=False,name=None):rule_ws.append(list(row))
sig_ws=wb.create_sheet('SIGNATURE_RANKING');sig_ws.append(list(signature_rank.columns))
for row in signature_rank.itertuples(index=False,name=None):sig_ws.append(list(row))
score_ws=wb.create_sheet('CANDIDATE_RANKING');score_ws.append(list(score_audit.columns))
for row in score_audit.itertuples(index=False,name=None):score_ws.append(list(row))
ad=wb.create_sheet('TRACE_AUDIT');headers=['seq']+list(den['nodes'][0].keys());ad.append(headers)
for i,n in enumerate(den['nodes'],1):ad.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(dict,list)) else n[k] for k in den['nodes'][0].keys()])
for tab in [rule_ws,sig_ws,score_ws,ad]:
 for c in tab[1]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
 tab.freeze_panes='A2';tab.auto_filter.ref=tab.dimensions
for sh in wb.worksheets:
 for row in sh.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
wb.save(out);print(json.dumps({'excel':str(out),'image':str(img),'category_traces':35,'representative_trace':TID,'audit_nodes':len(den['nodes'])},ensure_ascii=False,indent=2))
