from pathlib import Path
import json, html, shutil
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

BASE=Path('output/real_analysis')
OUT=BASE/'final_deliverables'; OUT.mkdir(parents=True,exist_ok=True)
df=pd.DataFrame(json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8')))
mask=df.module_id.eq('L8.3')|df.badcase_kind.eq('observability_gap')|df.module_id.eq('UNCLASSIFIED')
dev=df[~mask].copy(); quality=df[mask].copy(); total=len(df)
cat=(dev.groupby(['error_category','error_category_zh','layer_id','layer_name','module_id','module_name']).size().reset_index(name='count').sort_values('count',ascending=False).reset_index(drop=True))
cat['pct_all']=(cat['count']/total*100).round(1)
mod=(dev.groupby(['layer_id','layer_name','module_id','module_name']).size().reset_index(name='count').sort_values('count',ascending=False))
layer=(dev.groupby(['layer_id','layer_name']).size().reset_index(name='count').sort_values('count',ascending=False))

for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:
    matplotlib.rcParams['font.family']=f
    break
matplotlib.rcParams['axes.unicode_minus']=False
COL={'L1':'#4E79A7','L2':'#F28E2B','L3':'#98A2B3','L4':'#76B7B2','L5':'#D92D20','L6':'#EDC948','L7':'#B07AA1','L8':'#FF9DA7'}

# Chart 1: one human decision view — issue + severity + repair location.
d=cat.head(15).iloc[::-1]
fig,ax=plt.subplots(figsize=(15,9.5))
bars=ax.barh(range(len(d)),d['count'],color=[COL.get(x,'#98A2B3') for x in d.layer_id],height=.68)
labels=[f"{r.error_category_zh}\n修复位置：{r.module_id} {r.module_name}" for _,r in d.iterrows()]
ax.set_yticks(range(len(d))); ax.set_yticklabels(labels,fontsize=10)
for b,(_,r) in zip(bars,d.iterrows()):
    ax.text(b.get_width()+.3,b.get_y()+b.get_height()/2,f"{int(r['count'])} Trace  ·  占全部 Badcase {r.pct_all:.1f}%",va='center',fontsize=10,fontweight='bold')
ax.set_xlim(0,d['count'].max()*1.48); ax.set_xlabel('Trace 数'); ax.set_title('开发问题优先级榜：发生什么、影响多大、去哪里修',fontsize=17,fontweight='bold',pad=18)
ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=.16)
fig.text(.01,.012,f"口径：全部 {total} 个 Badcase Trace；归因质量问题 {len(quality)} 个已移至内部治理，不进入开发优先级榜。",fontsize=9,color='#667085')
plt.tight_layout(rect=[0,.03,1,1]); fig.savefig(OUT/'01_developer_issue_priority.png',dpi=180,bbox_inches='tight'); plt.close(fig)

# Chart 2: hierarchy map, clearly different from ranking chart.
layer_order=['L1','L2','L3','L4','L5','L6','L7','L8']
fig,ax=plt.subplots(figsize=(18,12)); ax.set_xlim(0,18); ax.set_ylim(0,12); ax.axis('off')
ax.text(9,11.55,'八层链路问题地图：能力层 → 责任模块 → 具体问题',ha='center',fontsize=18,fontweight='bold')
ax.text(9,11.12,f'开发问题 {len(dev)} 个 Trace；模块数是其下错误类别的合计',ha='center',fontsize=10,color='#667085')
positions={'L1':(0.3,8.1),'L2':(4.75,8.1),'L3':(9.2,8.1),'L4':(13.65,8.1),'L5':(0.3,3.2),'L6':(4.75,3.2),'L7':(9.2,3.2),'L8':(13.65,3.2)}
for lid in layer_order:
    lname=next((n for i,n in [('L1','接入层'),('L2','Agent 编排层'),('L3','状态与事件层'),('L4','上下文工程层'),('L5','Model Runtime 层'),('L6','工具执行层'),('L7','Skill 与 Agent 生态层'),('L8','横切关注点')] if i==lid),lid)
    lc=int(layer.loc[layer.layer_id.eq(lid),'count'].sum())
    x,y=positions[lid]; width=4.05; height=3.65
    box=FancyBboxPatch((x,y),width,height,boxstyle='round,pad=0.03,rounding_size=.12',facecolor='#FFFFFF',edgecolor=COL[lid],linewidth=2.5)
    ax.add_patch(box); ax.add_patch(FancyBboxPatch((x,y+3.05),width,.6,boxstyle='round,pad=0.02,rounding_size=.1',facecolor=COL[lid],edgecolor=COL[lid]))
    ax.text(x+.15,y+3.34,f'{lid} {lname}',color='white',fontsize=11,fontweight='bold',va='center'); ax.text(x+3.78,y+3.34,str(lc),color='white',fontsize=13,fontweight='bold',ha='right',va='center')
    mods=mod[mod.layer_id.eq(lid)].head(5)
    yy=y+2.72
    if mods.empty:
        ax.text(x+.18,yy,'本批暂无明确开发主归因',fontsize=9,color='#98A2B3',va='top')
    for _,mr in mods.iterrows():
        ax.text(x+.18,yy,f"{mr.module_id} {mr.module_name}  · {int(mr['count'])}",fontsize=9.3,fontweight='bold',va='top',color='#344054')
        yy-=.35
        cs=cat[cat.module_id.eq(mr.module_id)].head(3)
        for _,cr in cs.iterrows():
            ax.text(x+.36,yy,f"↳ {cr.error_category_zh} {int(cr['count'])}",fontsize=8.5,va='top',color='#667085'); yy-=.29
        yy-=.08
        if yy<y+.15: break
ax.text(9,.55,'注意：L8 仅保留 Credentials 等开发可行动问题；L8.3 Observability 已从开发地图移出。',ha='center',fontsize=10,color='#667085')
fig.savefig(OUT/'02_agent_chain_problem_map.png',dpi=180,bbox_inches='tight'); plt.close(fig)

# Copy/rename human dashboard and Excel.
src_html=BASE/'developer_dashboard'/'developer_online_success_dashboard.html'
if src_html.exists(): shutil.copy2(src_html,OUT/'03_developer_attribution_dashboard.html')
src_xlsx=BASE/'developer_online_success_report.xlsx'
if src_xlsx.exists(): shutil.copy2(src_xlsx,OUT/'04_developer_online_success_report.xlsx')
cat.to_csv(OUT/'developer_issue_priority.csv',index=False,encoding='utf-8-sig')
mod.to_csv(OUT/'developer_module_map_data.csv',index=False,encoding='utf-8-sig')
quality.to_csv(OUT/'attribution_quality_internal.csv',index=False,encoding='utf-8-sig')

readme=f'''# TripYoYo 线上成功率归因交付物\n\n## 面向开发的主交付\n\n1. `01_developer_issue_priority.png`：问题优先级榜。每行同时展示问题、Trace 数、占全部 Badcase 比例和修复模块。\n2. `02_agent_chain_problem_map.png`：八层链路问题地图。展示能力层 → 责任模块 → 错误类别。\n3. `03_developer_attribution_dashboard.html`：交互看板，包含自然语言 Case、异常传播链和修复建议。\n4. `04_developer_online_success_report.xlsx`：开发报告、代表 Case、因果 Trace 与归因质量附录。\n\n## 口径\n\n- 全部 Badcase Trace：{total}\n- 可归因开发问题：{len(dev)}\n- 归因质量问题：{len(quality)}（内部治理，不进入开发主排名）\n- 最高频开发问题：{cat.iloc[0].error_category_zh}，{int(cat.iloc[0]['count'])} Trace，占全部 Badcase {cat.iloc[0].pct_all:.1f}%\n\n## 35 与 36 的解释\n\n- 错误类别“模型流连接中断”：35。\n- 责任模块 L5.5：36，因为还包含“模型流异常结束”1 个 Trace。\n- 新版主图不再用两张相似柱状图重复表达：图一用于修复优先级，图二用于理解层级链路。\n'''
(OUT/'README.md').write_text(readme,encoding='utf-8')
print(json.dumps({'output_dir':str(OUT),'chart1':str(OUT/'01_developer_issue_priority.png'),'chart2':str(OUT/'02_agent_chain_problem_map.png'),'dashboard':str(OUT/'03_developer_attribution_dashboard.html'),'excel':str(OUT/'04_developer_online_success_report.xlsx')},ensure_ascii=False,indent=2))
