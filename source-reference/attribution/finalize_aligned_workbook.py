"""Finalize the approved workbook without changing its sheet set or sheet contents.

Only the 00_CHARTS image layout is adjusted:
- left top: Agent orchestration Top 5
- left bottom: responsibility module distribution
- right top: scenario issue Trace count
- right bottom: scenario x issue-category distribution
"""
from pathlib import Path
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XLImage
from PIL import Image as PILImage
from copy import copy

TEMPLATE=Path(r'D:\Users\martinma\Desktop\agent_orchestration_actionable_top5x5_report_v2.xlsx')
SCENE1=Path(__file__).resolve().parent/'output/scenario_analysis/01_scenario_issue_trace_count.png'
SCENE2=Path(__file__).resolve().parent/'output/scenario_analysis/02_scenario_issue_category_distribution.png'
OUT=Path(__file__).resolve().parent/'output/final_aligned/agent_orchestration_actionable_top5x5_report_final.xlsx'
OUT.parent.mkdir(parents=True,exist_ok=True)

wb=load_workbook(TEMPLATE)
original_sheets=list(wb.sheetnames)
ws=wb['00_CHARTS']
if len(ws._images)<2:
    raise RuntimeError('对齐模板的 00_CHARTS 缺少原有两张图')

# Keep the two approved original charts, remove oversized/overlapping additions.
original_images=list(ws._images[:2])
ws._images=[]
# Explicit sizes and anchors work in both Excel and WPS.
left_top, left_bottom=original_images
left_top.width,left_top.height=874,420
left_bottom.width,left_bottom.height=999,453
ws.add_image(left_top,'B3')
ws.add_image(left_bottom,'B32')

# Add the two scenario charts into the corresponding right-side regions.
# Physically resize source pixels because some WPS versions ignore DrawingML extents.
def resized_copy(src,dst,max_w,max_h):
    im=PILImage.open(src);scale=min(max_w/im.width,max_h/im.height,1);size=(int(im.width*scale),int(im.height*scale));im.resize(size,PILImage.Resampling.LANCZOS).save(dst,optimize=True);return size
scene1_small=OUT.parent/'scenario_trace_count_small.png';scene2_small=OUT.parent/'scenario_category_distribution_small.png'
size1=resized_copy(SCENE1,scene1_small,820,420);size2=resized_copy(SCENE2,scene2_small,900,450)
right_top=XLImage(str(scene1_small));right_top.width,right_top.height=size1
right_bottom=XLImage(str(scene2_small));right_bottom.width,right_bottom.height=size2
ws.add_image(right_top,'P3')
ws.add_image(right_bottom,'P32')

# Only extend column/row canvas; do not change workbook sheets or case content.
for col_letter in ['P','Q','R','S','T','U','V','W','X','Y','Z','AA','AB']:
    ws.column_dimensions[col_letter].width=11
for row in range(1,65):
    ws.row_dimensions[row].height=18
ws.sheet_view.zoomScale=55

if wb.sheetnames!=original_sheets:
    raise AssertionError('Sheet 集合或顺序发生变化')
wb.save(OUT)
print({'output':str(OUT),'sheet_count':len(wb.sheetnames),'first_sheet':wb.sheetnames[0],'image_count':len(ws._images),'sheets_unchanged':wb.sheetnames==original_sheets})
