# Validate the same geometry and wrapping calculation used by draw_story.
from generate_human_trace_excel import build_story,wrap,font,reps
from PIL import Image,ImageDraw
W,H=3000,1120;x0=65;y=205;gap=82;bw=(W-130-gap*4)//5;bh=760;title_h=112;footer_h=70;pad=28;line_h=39
im=Image.new('RGB',(W,H));d=ImageDraw.Draw(im); ft=font(24)
violations=[]
for idx,r in reps.iterrows():
 stages,meta,den=build_story(r.trace_id)
 for i,s in enumerate(stages):
  body_top=y+title_h+28;body_bottom=y+bh-footer_h-18
  lines=[]
  for para in str(s['body']).splitlines() or ['']:lines.extend(wrap(d,para,ft,bw-pad*2) or [''])
  max_lines=max(1,(body_bottom-body_top)//line_h); visible=min(len(lines),max_lines); last_bottom=body_top+visible*line_h
  if last_bottom>body_bottom:violations.append((idx+1,i+1,last_bottom,body_bottom))
print({'cases':len(reps),'cards':len(reps)*5,'body_bottom':body_bottom,'violations':violations,'status':'PASS' if not violations else 'FAIL'})
