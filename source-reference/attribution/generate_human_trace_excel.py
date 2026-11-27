from pathlib import Path
import json, re, textwrap
import pandas as pd
from PIL import Image,ImageDraw,ImageFont
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment,Border,Side
from openpyxl.drawing.image import Image as XLImage
from trace_denoiser import denoise_trace_nodes

BASE=Path('output/real_analysis'); OUT=BASE/'compact_deliverables'; IMG=OUT/'trace_images'; IMG.mkdir(parents=True,exist_ok=True)
SRC=Path(r'D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx')
classified=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')))
cases=classified[classified.error_category.eq('stream_connection_aborted')].copy()
raw=pd.read_excel(SRC,sheet_name='RAW_NODES'); events=pd.read_excel(SRC,sheet_name='ERROR_EVENTS'); manifest=pd.read_excel(SRC,sheet_name='TRACE_MANIFEST')
# Representative cases: high event count, diverse provider/model, then fill.
cases=cases.sort_values(['event_count','chain_node_count'],ascending=False)
reps=cases.drop_duplicates(['provider','model']).head(5)
if len(reps)<5: reps=pd.concat([reps,cases[~cases.trace_id.isin(reps.trace_id)].head(5-len(reps))]).drop_duplicates('trace_id')
reps=reps.head(5).reset_index(drop=True)

FONT_PATH=r'C:\Windows\Fonts\msyh.ttc'; FONT_BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
def font(size,bold=False):
 try:return ImageFont.truetype(FONT_BOLD if bold else FONT_PATH,size)
 except:return ImageFont.load_default()
def clean(s,n=180):
 if s is None or (isinstance(s,float) and pd.isna(s)):return ''
 s=re.sub(r'<[^>]+>',' ',str(s));s=re.sub(r'\s+',' ',s).strip()
 return s[:n]+('…' if len(s)>n else '')
def err_detail(v):
 try:d=json.loads(v) if isinstance(v,str) else {}
 except:d={}
 vals=[]
 def walk(x):
  if isinstance(x,dict):
   for k,z in x.items():
    if k.lower() in {'type','name','code','status','message','reason'} and not isinstance(z,(dict,list)): vals.append(f'{k}: {z}')
    elif isinstance(z,(dict,list)):walk(z)
  elif isinstance(x,list):
   for z in x[:5]:walk(z)
 walk(d);return ' | '.join(dict.fromkeys(vals))[:360]
def wrap(draw,text,ft,maxw):
 words=list(str(text)); lines=[]; cur=''
 for ch in words:
  if draw.textbbox((0,0),cur+ch,font=ft)[2]<=maxw:cur+=ch
  else:
   if cur:lines.append(cur)
   cur=ch
 if cur:lines.append(cur)
 return lines

def build_story(tid):
 g=raw[raw.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last')
 eg=events[events.effective_trace_id.eq(tid)].sort_values('created_at')
 den=denoise_trace_nodes(g.to_dict('records'),max_nodes=30)
 user=g[g.role.eq('user')]
 user_text=clean(user.iloc[0].content if len(user) else '',150) or '用户请求内容在导出数据中缺失'
 tool_names=[]
 for n in den['nodes']:
  tool_names+=n.get('tool_names',[])
 tool_names=list(dict.fromkeys(tool_names))
 first_err=eg.iloc[0] if len(eg) else None; last_err=eg.iloc[-1] if len(eg) else None
 before=g[g.created_at < first_err.created_at] if first_err is not None else g
 after=g[g.created_at > last_err.created_at] if last_err is not None else g.iloc[0:0]
 normal_assistant=int((before.role=='assistant').sum()); tools=int((before.role=='tool').sum())
 ebody=err_detail(first_err.error_raw) if first_err is not None else ''
 errtimes=len(eg); after_assistant=int((after.role=='assistant').sum()); after_tools=int((after.role=='tool').sum())
 stages=[
  {'title':'1 用户请求','body':user_text,'kind':'normal'},
  {'title':'2 正常执行','body':f'异常前 Assistant {normal_assistant} 轮，Tool {tools} 次'+(f"\n工具：{', '.join(tool_names[:5])}" if tool_names else ''),'kind':'normal'},
  {'title':'3 首次异常','body':f"{first_err.created_at if first_err is not None else ''}\n{first_err.error_type if first_err is not None else ''}\n{clean(first_err.error_message if first_err is not None else '',100)}\n{clean(ebody,180)}",'kind':'root'},
  {'title':'4 异常传播 / 重试','body':f'同 Trace 共 {errtimes} 个错误事件\n首错后仍有 Assistant {after_assistant} 轮、Tool {after_tools} 次\n最后错误：{last_err.created_at if last_err is not None else ""}','kind':'prop'},
  {'title':'5 最终表现','body':'模型流连接中断；回答可能不完整、重试或停止。','kind':'final'},
 ]
 meta={'trace_id':tid,'provider':str(first_err.provider if first_err is not None else ''),'model':str(first_err.model if first_err is not None else ''),'first_error':str(first_err.created_at if first_err is not None else ''),'last_error':str(last_err.created_at if last_err is not None else ''),'error_events':errtimes,'raw_nodes':len(g),'retained_nodes':den['stats']['retained_nodes'],'removed_nodes':den['stats']['removed_nodes'],'tools':', '.join(tool_names[:12]),'error_body':ebody}
 return stages,meta,den

def draw_story(stages,meta,path):
 # Large fixed canvas + strict title/body/footer zones prevent any text collision.
 W,H=3000,1120
 im=Image.new('RGB',(W,H),'white');d=ImageDraw.Draw(im)
 title_ft=font(42,True); meta_ft=font(26); card_title_ft=font(29,True); body_ft=font(24); footer_ft=font(20)
 d.text((70,38),f"Trace {meta['trace_id']}",font=title_ft,fill='#172033')
 d.text((70,102),f"{meta['provider']} / {meta['model']}    错误事件 {meta['error_events']}    节点 {meta['raw_nodes']} → {meta['retained_nodes']}",font=meta_ft,fill='#667085')
 x0=65; y=205; gap=82; bw=(W-130-gap*4)//5; bh=760
 title_h=112; footer_h=70; pad=28; line_h=39
 colors={'normal':('#EFF8FF','#1570EF'),'root':('#FEE4E2','#D92D20'),'prop':('#FEF0C7','#F79009'),'final':('#F2F4F7','#475467')}
 for i,s in enumerate(stages):
  x=x0+i*(bw+gap); bg,edge=colors[s['kind']]
  d.rounded_rectangle((x,y,x+bw,y+bh),radius=24,fill=bg,outline=edge,width=5)
  # Dedicated title band.
  d.rounded_rectangle((x+5,y+5,x+bw-5,y+title_h),radius=19,fill='white',outline=None)
  d.text((x+pad,y+34),s['title'],font=card_title_ft,fill=edge)
  # Body is clipped by line count derived from the actual available pixel height.
  body_top=y+title_h+28; body_bottom=y+bh-footer_h-18
  lines=[]
  for para in str(s['body']).splitlines() or ['']:
   lines.extend(wrap(d,para,body_ft,bw-pad*2) or [''])
  max_lines=max(1,(body_bottom-body_top)//line_h)
  clipped=len(lines)>max_lines
  visible=lines[:max_lines]
  if clipped and visible:
   suffix=' …'
   candidate=visible[-1]
   while candidate and d.textbbox((0,0),candidate+suffix,font=body_ft)[2]>bw-pad*2:candidate=candidate[:-1]
   visible[-1]=candidate+suffix
  yy=body_top
  for line in visible:
   d.text((x+pad,yy),line,font=body_ft,fill='#344054'); yy+=line_h
  # Footer status has its own band and cannot collide with body.
  status={'normal':'正常链路','root':'异常起点','prop':'异常传播','final':'用户表现'}[s['kind']]
  d.line((x+20,y+bh-footer_h,x+bw-20,y+bh-footer_h),fill=edge,width=2)
  d.text((x+pad,y+bh-footer_h+22),status,font=footer_ft,fill=edge)
  # Arrow lives entirely in the inter-card channel.
  if i<4:
   ax=x+bw+14; ay=y+bh//2
   d.line((ax,ay,x+bw+gap-20,ay),fill='#98A2B3',width=7)
   d.polygon([(x+bw+gap-20,ay),(x+bw+gap-46,ay-15),(x+bw+gap-46,ay+15)],fill='#98A2B3')
 d.text((70,1030),'蓝色：正常链路    红色：异常起点    黄色：异常传播/重试    灰色：最终表现',font=footer_ft,fill='#667085')
 im.save(path)

stories=[];all_nodes=[]
for i,r in reps.iterrows():
 stages,meta,den=build_story(r.trace_id); img=IMG/f'case_{i+1}.png';draw_story(stages,meta,img)
 stories.append({'case_no':i+1,**meta,'image':str(img),'conclusion':'L5 Model Runtime 层 → L5.5 Stream Processors','reason':'错误发生在模型已经开始流式输出之后，表现为 network error / ConnectionAborted。'})
 for seq,n in enumerate(den['nodes'],1):all_nodes.append({'case_no':i+1,'trace_id':r.trace_id,'seq':seq,**n})

xlsx=OUT/'03_top_error_cases_human_readable_revised.xlsx';wb=Workbook();ws=wb.active;ws.title='OVERVIEW'
blue='1F4E78';light='D9EAF7';red='FDE9E7';thin=Side(style='thin',color='D0D5DD')
for c,w in {'A':10,'B':24,'C':16,'D':24,'E':22,'F':18,'G':24,'H':52}.items():ws.column_dimensions[c].width=w
rows=[('错误类别','模型流连接中断'),('Trace 数',35),('占全部 Badcase','18.9%'),('归因层','L5 Model Runtime 层'),('责任模块','L5.5 Stream Processors')]
ws.append(['指标','数据']);
for cell in ws[1]:cell.fill=PatternFill('solid',fgColor=blue);cell.font=Font(color='FFFFFF',bold=True)
for x in rows:ws.append(x)
ws['A8']='代表 Case';ws['A8'].font=Font(bold=True,size=14)
ws.append(['Case','Trace ID','Provider','Model','首次报错时间','错误事件数（次）','错误类型','关键错误信息'])
for c in ws[9]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
for s in stories:
 first_event=events[(events.effective_trace_id==s['trace_id'])].sort_values('created_at').head(1)
 error_type=str(first_event.iloc[0].error_type) if len(first_event) else ''
 error_message=clean(first_event.iloc[0].error_message,120) if len(first_event) else ''
 error_detail_text=clean(s.get('error_body',''),180)
 key_error=error_message or error_detail_text or '错误正文缺失'
 ws.append([s['case_no'],s['trace_id'],s['provider'],s['model'],s['first_error'],s['error_events'],error_type,key_error])
ws.freeze_panes='A2'
for s in stories:
 sh=wb.create_sheet(f"CASE_{s['case_no']:02d}");sh.sheet_view.showGridLines=False
 for c,w in {'A':18,'B':34,'C':24,'D':24,'E':80}.items():sh.column_dimensions[c].width=w
 sh['A1']=f"Case {s['case_no']}";sh['A1'].font=Font(size=18,bold=True,color='FFFFFF');sh.merge_cells('A1:E1');sh['A1'].fill=PatternFill('solid',fgColor=blue);sh['A1'].alignment=Alignment(horizontal='center')
 info=[('Trace ID',s['trace_id']),('Provider / Model',f"{s['provider']} / {s['model']}"),('错误时间',f"{s['first_error']} → {s['last_error']}"),('错误事件',s['error_events']),('归因结论',s['conclusion']),('归因理由',s['reason']),('关键 Error Body',s['error_body']),('主要工具',s['tools'])]
 for row,(k,v) in enumerate(info,3):
  sh.cell(row,1,k);sh.cell(row,1).font=Font(bold=True);sh.cell(row,1).fill=PatternFill('solid',fgColor=light);sh.merge_cells(start_row=row,start_column=2,end_row=row,end_column=5);sh.cell(row,2,v);sh.cell(row,2).alignment=Alignment(wrap_text=True,vertical='top')
 sh['A12']='Trace 整体构造';sh['A12'].font=Font(size=14,bold=True)
 pic=XLImage(s['image']);pic.width=1500;pic.height=560;sh.add_image(pic,'A14');sh.row_dimensions[14].height=425
 sh['A40']='红色：首次异常　黄色：异常传播/重试　灰色：最终用户表现';sh.merge_cells('A40:E40');sh['A40'].font=Font(color='667085',italic=True)
# Audit appendix
ad=wb.create_sheet('TRACE_AUDIT');ad.append(list(all_nodes[0].keys()) if all_nodes else [])
for r in all_nodes:ad.append([json.dumps(r.get(k),ensure_ascii=False) if isinstance(r.get(k),(list,dict)) else r.get(k) for k in all_nodes[0].keys()])
for c in ad[1]:c.fill=PatternFill('solid',fgColor=blue);c.font=Font(color='FFFFFF',bold=True)
ad.freeze_panes='A2';ad.auto_filter.ref=ad.dimensions
for col in ad.columns:
 vals=list(col);ad.column_dimensions[vals[0].column_letter].width=min(40,max(10,max(len(str(x.value or '')) for x in vals[:300])+2))
wb.save(xlsx)
print(json.dumps({'excel':str(xlsx),'representative_cases':len(stories),'case_images':[s['image'] for s in stories],'audit_rows':len(all_nodes)},ensure_ascii=False,indent=2))
