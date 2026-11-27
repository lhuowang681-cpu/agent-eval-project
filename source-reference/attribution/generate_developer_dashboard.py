from pathlib import Path
import json, html
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib

BASE=Path('output/real_analysis')
OUT=BASE/'developer_dashboard'
OUT.mkdir(parents=True,exist_ok=True)
records=json.loads((BASE/'classified_badcases.json').read_text(encoding='utf-8'))
df=pd.DataFrame(records)
attr=(df.module_id.eq('L8.3')|df.badcase_kind.eq('observability_gap')|df.module_id.eq('UNCLASSIFIED'))
dev=df[~attr].copy(); quality=df[attr].copy(); total=len(df)
cat=(dev.groupby(['error_category','error_category_zh','layer_id','layer_name','module_id','module_name']).size().reset_index(name='count').sort_values('count',ascending=False))
cat['all_badcase_pct']=(cat['count']/total*100).round(1); cat['dev_issue_pct']=(cat['count']/len(dev)*100).round(1)
mod=(dev.groupby(['module_id','module_name','layer_id','layer_name']).size().reset_index(name='count').sort_values('count',ascending=False))
mod['all_badcase_pct']=(mod['count']/total*100).round(1); mod['dev_issue_pct']=(mod['count']/len(dev)*100).round(1)
layer=(dev.groupby(['layer_id','layer_name']).size().reset_index(name='count').sort_values('count',ascending=False)); layer['pct']=(layer['count']/len(dev)*100).round(1)
cat.to_csv(OUT/'developer_error_category.csv',index=False,encoding='utf-8-sig'); mod.to_csv(OUT/'developer_module_distribution.csv',index=False,encoding='utf-8-sig')

# Chinese font
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:
 try:
  matplotlib.rcParams['font.family']=f; break
 except: pass
matplotlib.rcParams['axes.unicode_minus']=False
colors={'L1':'#4E79A7','L2':'#F28E2B','L3':'#E15759','L4':'#76B7B2','L5':'#D92D20','L6':'#EDC948','L7':'#B07AA1','L8':'#FF9DA7'}

def chart_category():
 d=cat.head(15).sort_values('count'); fig,ax=plt.subplots(figsize=(14,9)); bars=ax.barh(range(len(d)),d['count'],color=[colors.get(x,'#98A2B3') for x in d.layer_id])
 ax.set_yticks(range(len(d))); ax.set_yticklabels([f"{z}  [{m}]" for z,m in zip(d.error_category_zh,d.module_id)],fontsize=10)
 ax.set_xlabel('Badcase Trace 数'); ax.set_title('影响线上成功率的错误类别分布（已排除归因能力问题）',fontsize=16,fontweight='bold',pad=16)
 for b,(_,r) in zip(bars,d.iterrows()): ax.text(b.get_width()+.3,b.get_y()+b.get_height()/2,f"{r['count']} Trace  |  占全部 Badcase {r['all_badcase_pct']}%",va='center',fontsize=9)
 ax.set_xlim(0,max(d['count'])*1.42); ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=.18)
 fig.text(.99,.01,f"分母：全部 {total} 个 Badcase Trace；L8.3/未分类不进入开发类别榜",ha='right',fontsize=9,color='#667085')
 plt.tight_layout(rect=[0,0.03,1,1]); fig.savefig(OUT/'chart1_developer_error_category.png',dpi=180,bbox_inches='tight'); plt.close(fig)

def chart_module():
 d=mod.head(15).sort_values('count'); fig,ax=plt.subplots(figsize=(14,8)); bars=ax.barh(range(len(d)),d['count'],color=[colors.get(x,'#98A2B3') for x in d.layer_id])
 ax.set_yticks(range(len(d))); ax.set_yticklabels([f"{i}  {n}" for i,n in zip(d.module_id,d.module_name)],fontsize=10)
 ax.set_xlabel('Badcase Trace 数'); ax.set_title('开发责任模块分布（聚焦线上成功率）',fontsize=16,fontweight='bold',pad=16)
 for b,(_,r) in zip(bars,d.iterrows()): ax.text(b.get_width()+.3,b.get_y()+b.get_height()/2,f"{r['count']}  ({r['dev_issue_pct']}%)",va='center',fontsize=9)
 ax.set_xlim(0,max(d['count'])*1.28); ax.spines[['top','right']].set_visible(False); ax.grid(axis='x',alpha=.18)
 from matplotlib.patches import Patch
 lids=list(dict.fromkeys(d.layer_id)); ax.legend(handles=[Patch(color=colors[x],label=x) for x in lids],title='能力层',loc='lower right')
 fig.text(.99,.01,'模块数为其下所有错误类别的合计；L5.5=模型流连接中断35 + 模型流异常结束1 = 36',ha='right',fontsize=9,color='#667085')
 plt.tight_layout(rect=[0,0.03,1,1]); fig.savefig(OUT/'chart2_developer_module_distribution.png',dpi=180,bbox_inches='tight'); plt.close(fig)
chart_category(); chart_module()

# Human-readable cases
def case_samples(category,n=2):
 x=dev[dev.error_category.eq(category)].sort_values(['confidence','event_count'],ascending=False).head(n)
 return x.to_dict('records')
case_defs={
 'stream_connection_aborted':('模型流连接中断','模型已开始输出，但流式连接被复位、提前关闭或网络中断。','模型开始输出 → 流式传输 → 连接复位/提前关闭 → 回答不完整','记录最后成功 Chunk、关闭方、重试次数和持续时间；区分用户 Abort 与上游断流。'),
 'subscription_budget_limit_reached':('套餐预算达到上限','调用前未能完成有效预算拦截，最终由 Provider 返回周期额度耗尽。','Agent 决定调用 → 预算未前置拦截 → Provider 检测额度 → 调用失败','调用前检查预算并返回升级额度、切换模型或稍后重试提示。'),
 'provider_credential_binding_missing':('Provider 凭证绑定缺失','Peta Key 未绑定或请求缺少 petaKeyId，外层可能只显示 500。','发起模型调用 → Credential 注入/绑定缺失 → 鉴权失败 → 外层包装错误','Provider 初始化前做凭证完整性与绑定预检，保留原始鉴权错误。'),
 'model_parameter_missing':('模型参数缺失','模型请求中未包含有效 model 参数。','参数解析 → model 丢失 → Provider 收到非法请求 → 请求失败','在 ModelParamsResolver 中强制校验 model，并保留参数合并来源。'),
 'thinking_parameter_type_invalid':('Thinking 参数类型错误','thinking 被构造成 map，但目标 Provider 只接受 boolean。','参数解析 → thinking 类型错误 → Payload 发送 → Provider 反序列化失败','按 Provider 能力表规范化 thinking 类型，发出前执行 Schema 校验。'),
 'empty_message_content_block':('消息内容块为空','上下文构造后出现空 ContentBlock 或空 Assistant Message。','消息变形 → Context Builder 产生空块 → Provider 校验 → 400','发送前删除空文本块，同时保持 Tool Use/Result 配对。')}

layer_all=[('L1','接入层'),('L2','Agent 编排层'),('L3','状态与事件层'),('L4','上下文工程层'),('L5','Model Runtime 层'),('L6','工具执行层'),('L7','Skill 与 Agent 生态层'),('L8','横切关注点')]
lmap={r.layer_id:r for _,r in layer.iterrows()}
layer_cards=''.join(f'''<button class="layer" data-layer="{lid}"><span>{lid}</span><b>{name}</b><strong>{int(lmap[lid]['count']) if lid in lmap else 0}</strong><small>{float(lmap[lid].pct) if lid in lmap else 0:.1f}%</small></button>''' for lid,name in layer_all)
module_rows=''.join(f'''<tr data-layer="{r.layer_id}"><td>{r.module_id}</td><td>{html.escape(str(r.module_name))}</td><td><div class="bar"><i style="width:{r['count']/mod['count'].max()*100:.1f}%"></i></div></td><td>{r['count']}</td><td>{r.dev_issue_pct}%</td></tr>''' for _,r in mod.iterrows())
category_rows=''.join(f'''<tr><td>{i+1}</td><td>{html.escape(str(r.error_category_zh))}</td><td>{r.layer_id} → {r.module_id} {html.escape(str(r.module_name))}</td><td>{r['count']}</td><td>{r.dev_issue_pct}%</td></tr>''' for i,(_,r) in enumerate(cat.head(15).iterrows()))
case_html=[]
for key,(title,why,chain,fix) in case_defs.items():
 row=cat[cat.error_category.eq(key)]
 if row.empty: continue
 r=row.iloc[0]; samples=case_samples(key)
 ev=''.join(f'''<details><summary>{html.escape(str(s.get('trace_id')))} · {html.escape(str(s.get('provider')))} / {html.escape(str(s.get('model')))}</summary><pre>{html.escape(chr(10).join(s.get('evidence',[])[:4]))}</pre></details>''' for s in samples)
 steps=''.join(f'<span>{html.escape(x.strip())}</span>' for x in chain.split('→'))
 case_html.append(f'''<article class="case"><header><b>{title}</b><em>{int(r['count'])} Trace · {r.dev_issue_pct}%</em></header><div class="grid"><section><h4>问题解释</h4><p>{why}</p></section><section><h4>归因结论</h4><p><strong>{r.layer_id} {r.layer_name} → {r.module_id} {r.module_name}</strong></p></section></div><h4>异常传播链</h4><div class="chain">{steps}</div><div class="fix"><b>修复建议：</b>{fix}</div><h4>代表 Trace 证据</h4>{ev}</article>''')
quality_rows=''.join(f'<tr><td>{html.escape(str(r.error_category_zh))}</td><td>{int(r["count"])}</td><td>{r["pct"]}%</td><td>归因/可观测性建设方</td></tr>' for _,r in pd.read_csv(BASE/'stat_error_category.csv').query("error_category == 'provider_error_body_missing'").iterrows())

page=f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TripYoYo 线上成功率归因看板</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f4f7fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}}.hero{{background:linear-gradient(135deg,#102a56,#175cd3);color:white;padding:30px 5vw}}.hero h1{{margin:0 0 8px}}main{{max-width:1450px;margin:auto;padding:22px}}.note,.card,.case{{background:white;border:1px solid #e4e7ec;border-radius:15px;padding:19px;margin-bottom:18px;box-shadow:0 6px 22px #10182812}}.note{{border-left:5px solid #12b76a}}.kpis{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}}.kpi{{background:white;padding:17px;border-radius:13px;border:1px solid #e4e7ec}}.kpi b{{display:block;font-size:28px;color:#175cd3}}.layers{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}.layer{{background:#fff;border:2px solid #e4e7ec;border-radius:12px;padding:13px;text-align:left;cursor:pointer}}.layer.active{{border-color:#175cd3;background:#eff8ff}}.layer span,.layer strong,.layer small{{display:block}}.layer b{{display:block;margin:5px 0}}.layer strong{{font-size:23px}}h2{{margin-top:0}}table{{width:100%;border-collapse:collapse}}th,td{{padding:10px;border-bottom:1px solid #eaecf0;text-align:left}}th{{background:#f2f4f7}}.bar{{height:7px;background:#eaecf0;border-radius:8px;min-width:140px}}.bar i{{display:block;height:100%;background:#f04438;border-radius:8px}}.dev-grid{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}.case header{{display:flex;justify-content:space-between;background:#102a56;color:white;margin:-19px -19px 15px;padding:15px 19px;border-radius:15px 15px 0 0}}.case em{{font-style:normal}}.grid{{display:grid;grid-template-columns:1fr 1fr;gap:12px}}.grid section,.fix{{background:#f8fafc;border-radius:10px;padding:12px}}.chain{{display:flex;gap:22px;overflow:auto;margin:12px 0}}.chain span{{min-width:160px;background:#fef0c7;border:1px solid #fec84b;border-radius:9px;padding:12px;position:relative}}.chain span:not(:last-child):after{{content:'→';position:absolute;right:-18px}}.chain span:first-child{{background:#fee4e2;border-color:#fda29b}}pre{{white-space:pre-wrap;background:#101828;color:#d1e9ff;padding:12px;border-radius:8px}}details{{margin:8px 0}}.quality{{border-left:5px solid #98a2b3}}@media(max-width:900px){{.kpis,.layers,.dev-grid,.grid{{grid-template-columns:1fr 1fr}}}}@media(max-width:600px){{.kpis,.layers,.dev-grid,.grid{{grid-template-columns:1fr}}}}
</style></head><body><div class="hero"><h1>TripYoYo 线上成功率归因看板</h1><p>2026-07-20 至 2026-07-27 · 面向产品与运行链路开发</p></div><main><div class="note"><b>责任边界：</b>开发榜只展示影响线上成功率且需要开发修复的问题。Error Body、Trace、Span 等归因能力缺口由归因与可观测性建设方内部解决。</div><div class="kpis"><div class="kpi"><b>{total}</b>Badcase Trace</div><div class="kpi"><b>{len(dev)}</b>可归因开发问题</div><div class="kpi"><b>{len(quality)}</b>归因质量问题</div><div class="kpi"><b>{cat.iloc[0]['count']}</b>最高频开发问题 Trace</div></div><section class="card"><h2>八层开发问题分布</h2><div class="layers">{layer_cards}</div></section><div class="dev-grid"><section class="card"><h2>开发错误类别 Top 15</h2><table><thead><tr><th>#</th><th>错误类别</th><th>归因链路</th><th>Trace</th><th>占开发问题</th></tr></thead><tbody>{category_rows}</tbody></table></section><section class="card"><h2>开发责任模块</h2><table><thead><tr><th>模块</th><th>名称</th><th>分布</th><th>Trace</th><th>占比</th></tr></thead><tbody id="mods">{module_rows}</tbody></table></section></div><section><h2>自然语言 Case 与异常传播链</h2>{''.join(case_html)}</section><section class="card quality"><h2>归因数据质量（内部治理，不进入开发排名）</h2><table><thead><tr><th>问题</th><th>Trace</th><th>占全部 Badcase</th><th>责任方</th></tr></thead><tbody>{quality_rows}</tbody></table><p>目标：补齐 Provider Error Body、Trace/Span、Snapshot 与节点链，提高后续自动归因覆盖率。</p></section></main><script>document.querySelectorAll('.layer').forEach(b=>b.onclick=()=>{{document.querySelectorAll('.layer').forEach(x=>x.classList.remove('active'));b.classList.add('active');let id=b.dataset.layer;document.querySelectorAll('#mods tr').forEach(r=>r.style.display=!id||r.dataset.layer===id?'':'none')}});</script></body></html>'''
(OUT/'developer_online_success_dashboard.html').write_text(page,encoding='utf-8')
print(json.dumps({'badcases':total,'developer_issues':len(dev),'attribution_quality':len(quality),'top_category':cat.iloc[0].error_category_zh,'top_count':int(cat.iloc[0]['count']),'outputs':[str(x) for x in [OUT/'chart1_developer_error_category.png',OUT/'chart2_developer_module_distribution.png',OUT/'developer_online_success_dashboard.html']]},ensure_ascii=False,indent=2))
