from pathlib import Path
import json, re
import pandas as pd
from PIL import Image, ImageDraw, ImageFont
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.drawing.image import Image as XLImage
from trace_denoiser import denoise_trace_nodes

BASE=Path('output/real_analysis'); OUT=BASE/'compact_deliverables'; IMG=OUT/'three_case_trace_images'; IMG.mkdir(parents=True,exist_ok=True)
SRC=Path(r'D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx')
classified=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')))
raw=pd.read_excel(SRC,sheet_name='RAW_NODES')
events=pd.read_excel(SRC,sheet_name='ERROR_EVENTS')
category='stream_connection_aborted'
cases=classified[classified.error_category.eq(category)].copy().sort_values(['event_count','chain_node_count'],ascending=False)

# Three explicitly different samples: typical, repeated failures, cross-provider.
typical=cases.iloc[(cases.event_count-1).abs().argsort()].iloc[0]
repeated=cases.sort_values(['event_count','chain_node_count'],ascending=False).iloc[0]
other=cases[(cases.provider.ne(repeated.provider)) & (~cases.trace_id.isin([typical.trace_id,repeated.trace_id]))]
if other.empty: other=cases[~cases.trace_id.isin([typical.trace_id,repeated.trace_id])]
chosen=pd.DataFrame([typical,repeated,other.iloc[0]]).drop_duplicates('trace_id')
if len(chosen)<3:
 chosen=pd.concat([chosen,cases[~cases.trace_id.isin(chosen.trace_id)].head(3-len(chosen))]).drop_duplicates('trace_id')
chosen=chosen.head(3).reset_index(drop=True)
roles=['典型 Case','重复失败 Case','跨 Provider Case']

FONT=r'C:\Windows\Fonts\msyh.ttc'; BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
def ft(n,b=False):
 try:return ImageFont.truetype(BOLD if b else FONT,n)
 except:return ImageFont.load_default()
def txt(v,n=160):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip();return s[:n]+('…' if len(s)>n else '')
def wrap(draw,s,font,maxw):
 lines=[]
 for para in str(s).splitlines() or ['']:
  cur=''
  for ch in para:
   if draw.textbbox((0,0),cur+ch,font=font)[2]<=maxw:cur+=ch
   else:
    if cur:lines.append(cur)
    cur=ch
  if cur:lines.append(cur)
 return lines
def error_summary(row):
 try:d=json.loads(row.error_raw) if isinstance(row.error_raw,str) else {}
 except:d={}
 vals=[]
 def walk(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k.lower() in {'type','name','code','status','message','reason'} and not isinstance(v,(dict,list)):vals.append(f'{k}: {v}')
    elif isinstance(v,(dict,list)):walk(v)
 walk(d);return txt(' | '.join(dict.fromkeys(vals)),260)

def story(tid):
 g=raw[raw.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last')
 e=events[events.effective_trace_id.eq(tid)].sort_values('created_at')
 den=denoise_trace_nodes(g.to_dict('records'),max_nodes=30)
 first=e.iloc[0]; last=e.iloc[-1]
 user=g[g.role.eq('user')]
 tools=[]
 for n in den['nodes']:tools+=n.get('tool_names',[])
 tools=list(dict.fromkeys(tools))
 before=g[g.created_at<first.created_at]; after=g[g.created_at>last.created_at]
 stages=[
  ('用户请求',txt(user.iloc[0].content if len(user) else '用户请求缺失',130),'normal'),
  ('正常执行',f"Assistant {int((before.role=='assistant').sum())} 轮\nTool {int((before.role=='tool').sum())} 次"+(f"\n{', '.join(tools[:4])}" if tools else ''),'normal'),
  ('首次异常',f"{first.created_at}\n{first.error_type}\n{txt(first.error_message,90)}",'root'),
  ('传播 / 重试',f"失败调用 {len(e)} 次\n首错后 Assistant {int((after.role=='assistant').sum())} 轮\n最后错误 {last.created_at}",'prop'),
  ('最终表现','流式回答中断\n内容可能不完整\n或触发重试','final')]
 return g,e,den,stages,error_summary(first),tools

def draw_trace(stages,meta,path):
 W,H=3000,1120;im=Image.new('RGB',(W,H),'white');d=ImageDraw.Draw(im)
 d.text((70,35),meta,font=ft(40,True),fill='#172033')
 x0=65;y=175;gap=82;bw=(W-130-gap*4)//5;bh=780; title_h=112;foot_h=70;pad=28;lh=39
 colors={'normal':('#EFF8FF','#1570EF'),'root':('#FEE4E2','#D92D20'),'prop':('#FEF0C7','#F79009'),'final':('#F2F4F7','#475467')}
 for i,(title,body,kind) in enumerate(stages):
  x=x0+i*(bw+gap);bg,edge=colors[kind]
  d.rounded_rectangle((x,y,x+bw,y+bh),24,fill=bg,outline=edge,width=5)
  d.rounded_rectangle((x+5,y+5,x+bw-5,y+title_h),19,fill='white')
  d.text((x+pad,y+34),f'{i+1} {title}',font=ft(29,True),fill=edge)
  top=y+title_h+28;bottom=y+bh-foot_h-18;lines=wrap(d,body,ft(24),bw-pad*2);maxlines=(bottom-top)//lh
  if len(lines)>maxlines:lines=lines[:maxlines];lines[-1]=lines[-1][:-1]+'…'
  yy=top
  for line in lines:d.text((x+pad,yy),line,font=ft(24),fill='#344054');yy+=lh
  status={'normal':'正常','root':'异常起点','prop':'异常传播','final':'用户表现'}[kind]
  d.line((x+20,y+bh-foot_h,x+bw-20,y+bh-foot_h),fill=edge,width=2);d.text((x+pad,y+bh-foot_h+22),status,font=ft(20),fill=edge)
  if i<4:
   ax=x+bw+14;ay=y+bh//2;d.line((ax,ay,x+bw+gap-20,ay),fill='#98A2B3',width=7);d.polygon([(x+bw+gap-20,ay),(x+bw+gap-46,ay-15),(x+bw+gap-46,ay+15)],fill='#98A2B3')
 im.save(path)

stories=[];audit=[]
for i,r in chosen.iterrows():
 g,e,den,stages,es,tools=story(r.trace_id);path=IMG/f'case_{i+1}.png';draw_trace(stages,f"{roles[i]}  |  {r.trace_id}  |  {r.provider} / {r.model}",path)
 stories.append({'case_no':i+1,'case_type':roles[i],'trace_id':r.trace_id,'provider':r.provider,'model':r.model,'first_error':str(e.iloc[0].created_at),'last_error':str(e.iloc[-1].created_at),'failed_calls':len(e),'error_type':e.iloc[0].error_type,'key_error':txt(e.iloc[0].error_message,100) or es,'tools':', '.join(tools[:10]),'raw_nodes':len(g),'evidence_nodes':den['stats']['retained_nodes'],'image':path})
 for seq,n in enumerate(den['nodes'],1):audit.append({'case_no':i+1,'trace_id':r.trace_id,'seq':seq,**n})

out=OUT/'03_top_error_cases_3_samples.xlsx';wb=Workbook();ov=wb.active;ov.title='OVERVIEW';blue='1F4E78';light='D9EAF7'
for col,w in {'A':12,'B':20,'C':24,'D':16,'E':24,'F':22,'G':18,'H':38}.items():ov.column_dimensions[col].width=w
for row in [('错误类别','模型流连接中断'),('独立 Badcase Trace',35),('占全部 Badcase','18.9%'),('代表 Case',3),('归因','L5 Model Runtime 层 → L5.5 Stream Processors')]:ov.append(row)
ov['A7']='三个数量的区别';ov['A7'].font=Font(size=14,bold=True)
ov.append(['概念','数量','含义'])
ov.append(['独立 Badcase Trace',35,'该错误类别共有 35 个独立 Trace'])
ov.append(['代表 Case',3,'从 35 个 Trace 中选择 3 个不同形态的样本'])
ov.append(['Trace 内失败调用',None,'单个 Trace 内的失败调用次数，每个 Case 各不相同'])
ov['A13']='代表 Case 对比';ov['A13'].font=Font(size=14,bold=True)
ov.append(['Case','类型','Trace ID','Provider','Model','首次报错','失败调用数（次）','关键错误信息'])
for s in stories:ov.append([s['case_no'],s['case_type'],s['trace_id'],s['provider'],s['model'],s['first_error'],s['failed_calls'],s['key_error']])
for r in [8,14]:
 for c in ov[r]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True);c.alignment=Alignment(horizontal='center')
for s in stories:
 sh=wb.create_sheet(f"CASE_{s['case_no']:02d}");sh.sheet_view.showGridLines=False
 for col,w in {'A':21,'B':36,'C':36,'D':36,'E':72}.items():sh.column_dimensions[col].width=w
 sh.merge_cells('A1:E1');sh['A1']=f"{s['case_type']} · {s['trace_id']}";sh['A1'].fill=PatternFill('solid',fgColor=blue);sh['A1'].font=Font(color='FFFFFF',bold=True,size=17);sh['A1'].alignment=Alignment(horizontal='center')
 info=[('Provider / Model',f"{s['provider']} / {s['model']}"),('错误时间',f"{s['first_error']} → {s['last_error']}"),('Trace 内失败调用数',f"{s['failed_calls']} 次"),('错误类型',s['error_type']),('关键错误信息',s['key_error']),('归因','L5 Model Runtime 层 → L5.5 Stream Processors')]
 for rr,(k,v) in enumerate(info,3):sh.cell(rr,1,k);sh.cell(rr,1).fill=PatternFill('solid',fgColor=light);sh.cell(rr,1).font=Font(bold=True);sh.merge_cells(start_row=rr,start_column=2,end_row=rr,end_column=5);sh.cell(rr,2,v);sh.cell(rr,2).alignment=Alignment(wrap_text=True,vertical='top')
 sh['A11']='Trace 整体构造';sh['A11'].font=Font(size=14,bold=True);pic=XLImage(s['image']);pic.width=1500;pic.height=560;sh.add_image(pic,'A13');sh.row_dimensions[13].height=425
ad=wb.create_sheet('TRACE_AUDIT');headers=list(audit[0].keys());ad.append(headers)
for r in audit:ad.append([json.dumps(r[k],ensure_ascii=False) if isinstance(r[k],(dict,list)) else r[k] for k in headers])
for c in ad[1]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
ad.freeze_panes='A2';ad.auto_filter.ref=ad.dimensions
for ws in wb.worksheets:
 for row in ws.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
wb.save(out)
print(json.dumps({'excel':str(out),'cases':[{k:s[k] for k in ['case_no','case_type','trace_id','provider','model','failed_calls']} for s in stories],'audit_rows':len(audit)},ensure_ascii=False,indent=2))
