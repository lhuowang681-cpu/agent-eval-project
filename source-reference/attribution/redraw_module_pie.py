from pathlib import Path
import os, math
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt

p=Path(os.getenv('ANALYSIS_OUTPUT_DIR','output/real_analysis'))/'compact_deliverables'
d=pd.read_csv(p/'module_pie_data.csv')
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:
    matplotlib.rcParams['font.family']=f;break
matplotlib.rcParams['axes.unicode_minus']=False
colors=['#D92D20','#F79009','#1570EF','#12B76A','#7A5AF8','#06AED4','#EE46BC','#6172F3','#F63D68','#2E90FA','#039855','#DC6803','#475467']
vals=d['count'].astype(int).tolist(); total=sum(vals)
fig,ax=plt.subplots(figsize=(17,10.5)); fig.subplots_adjust(left=.05,right=.68,top=.96,bottom=.04)
wedges,_=ax.pie(vals,startangle=90,counterclock=False,colors=colors[:len(vals)],radius=1.0,wedgeprops={'linewidth':1.3,'edgecolor':'white'})
# Place every module label outside with connector. Resolve left/right vertical collisions independently.
items=[]
for i,(w,(_,r)) in enumerate(zip(wedges,d.iterrows())):
    ang=(w.theta1+w.theta2)/2; rad=math.radians(ang); x,y=math.cos(rad),math.sin(rad)
    side=1 if x>=0 else -1
    items.append({'i':i,'x':x,'y':y,'side':side,'r':r,'ang':ang})
for side in [-1,1]:
    arr=sorted([z for z in items if z['side']==side],key=lambda z:z['y'])
    # distribute labels in [-1.08,1.08]
    min_gap=.16
    ys=[]
    for z in arr:
        yy=z['y']*1.12
        if ys and yy<ys[-1]+min_gap: yy=ys[-1]+min_gap
        ys.append(yy)
    if ys and ys[-1]>1.12:
        shift=ys[-1]-1.12; ys=[y-shift for y in ys]
    if ys and ys[0]<-1.12:
        shift=-1.12-ys[0]; ys=[y+shift for y in ys]
    for z,yy in zip(arr,ys):
        r=z['r']; x=z['x']; y=z['y']; tx=1.42*side
        label=f"{r.module_id} {r.module_name}\n{int(r['count'])} ({r.pct_dev:.1f}%)"
        ax.annotate(label,xy=(.92*x,.92*y),xytext=(tx,yy),ha='left' if side>0 else 'right',va='center',fontsize=9.5,fontweight='bold' if r['count']>=10 else 'normal',arrowprops=dict(arrowstyle='-',color='#98A2B3',lw=.9,connectionstyle='angle3'))
# Right-side complete dataset, no Other bucket.
legend_labels=[f"{r.module_id} {r.module_name}   {int(r['count'])} ({r.pct_dev:.1f}%)" for _,r in d.iterrows()]
ax.legend(wedges,legend_labels,loc='center left',bbox_to_anchor=(1.48,.5),frameon=False,fontsize=9.5,labelspacing=.85,handlelength=1.1)
ax.axis('equal')
fig.savefig(p/'02_module_distribution_pie.png',dpi=200,bbox_inches='tight',facecolor='white');plt.close(fig)
print('modules',len(d),'total',total,'other_bucket',False)
