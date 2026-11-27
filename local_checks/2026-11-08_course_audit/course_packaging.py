import collections,shutil,urllib.parse

# Capture inputs for the final no-business-change check. Never import project code.
protected={item['path']:item['sha256'] for item in EVIDENCE}
original=json.loads(read('SOURCE_MANIFEST.json'))
for item in original['files']:
    assert sha((ROOT/item['path']).read_bytes())==item['sha256'],item['path']
    protected[item['path']]=item['sha256']
for relative in ['docs/learning/LEARNING_PROGRESS.json','docs/roadmap/BUILD_PROGRESS.json']:
    protected[relative]=sha((ROOT/relative).read_bytes())
jwrite('audit/PROTECTED_INPUT_HASHES.json',protected)

copies=[]
def scrub(value):
    changes=[]
    patterns=[
      ('machine_absolute_path',r'(?<![\w])[A-Za-z]:[\\/][^\r\n\'"`<>]+','[LOCAL_PATH_REDACTED]'),
      ('private_service_host',r'https?://[\w.-]*(?:ctripcorp\.com|corp\.ctrip\.com)(?:[^\s\'"<>]*)','https://[INTERNAL_SERVICE_REDACTED]'),
      ('secret_token',r'\bsk-[A-Za-z0-9_-]{16,}\b','[TOKEN_REDACTED]'),
      ('jwt_literal',r'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+','[JWT_REDACTED]'),
    ]
    for name,pattern,replacement in patterns:
        value,count=re.subn(pattern,replacement,value)
        if count:changes.append({'rule':name,'count':count})
    # Redact literal credentials only, not getenv names or symbolic variable use.
    def literal(match):
        changes.append({'rule':'credential_literal','count':1})
        return match.group(1)+match.group(2)+'[CREDENTIAL_REDACTED]'+match.group(2)
    value=re.sub(r"(?i)(\b(?:api_key|apiKey|password|secret|access_token)\s*[:=]\s*)(['\"])[^'\"\r\n]{12,}\2",literal,value)
    return value,changes

for path in dict.fromkeys(item['path'] for item in EVIDENCE):
    raw=(ROOT/path).read_bytes();value=raw.decode('utf-8-sig')
    safe,redactions=scrub(value)
    assert len(value.splitlines())==len(safe.splitlines()),'Redaction must preserve source line numbers'
    target=OUT/'key_sources'/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(safe,encoding='utf-8',newline='\n')
    copies.append({'originalPath':path,'copyPath':'key_sources/'+path,'originalSha256':sha(raw),'copySha256':sha(target.read_bytes()),'bytes':target.stat().st_size,'redactions':redactions,'readOnlyTeachingCopy':True})

# Small experimental evidence only. No cookies, raw logs, historical XLSX or model keys.
artifacts=[
 'local_checks/2026-11-08_phase2/FINAL_REPORT.md',
 'local_checks/2026-11-08_phase2/REGRESSION_SUMMARY.json',
 'local_checks/2026-11-08_phase2/INCREMENT_GATES.json',
 'local_checks/2026-11-08_phase3/ATTRIBUTION_QUALITY_REPORT.md',
 'local_checks/2026-11-08_phase3/ABLATION_RESULTS.md',
 'local_checks/2026-11-08_phase3/PROMOTION_DECISION.md',
 'local_checks/2026-11-08_phase3/RESTORE_RECEIPT.json',
]
experiment_manifest=[]
for relative in artifacts:
    value,redactions=scrub(read(relative))
    name=('phase2_' if 'phase2/' in relative else 'phase3_')+Path(relative).name
    write('evidence/'+name,value)
    experiment_manifest.append({'originalPath':relative,'sha256':sha((ROOT/relative).read_bytes()),'copyPath':'evidence/'+name,'copySha256':sha((OUT/'evidence'/name).read_bytes()),'redactions':redactions})
for name in ['PLATFORM_FACTS.json','PLATFORM_FACTS.md','RESEARCH_FACTS.json','RESEARCH_FACTS.md']:
    source=BASE/name
    if not source.exists():raise RuntimeError('Wait for factual audit: '+name)
    value,redactions=scrub(source.read_text(encoding='utf-8'))
    write('audit/'+name,value)

counts=collections.Counter()
skip={'node_modules','dist','build','coverage','__pycache__','tmp','temp','test-results','playwright-report'}
for top in ['src','packages','scripts','tools']:
    for folder,dirs,files in os.walk(APP/top,followlinks=False):
        parent=Path(folder)
        dirs[:]=[name for name in dirs if name not in skip and not name.startswith('.') and not (parent/name).is_symlink() and not (parent/name).is_junction()]
        counts[top]+=sum(Path(name).suffix in {'.ts','.tsx','.py','.mts','.cts'} for name in files)
python=[]
for item in copies:
    if Path(item['originalPath']).suffix=='.py':
        tree=ast.parse(read(item['originalPath']))
        python.append({'path':item['originalPath'],'definitions':[{'name':node.name,'line':node.lineno,'endLine':node.end_lineno} for node in ast.walk(tree) if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef))]})
jwrite('SOURCE_EVIDENCE.json',{'date':DATE,'pathBase':'agent-eval-project','defaultReviewer':'phase2 baseline restored; phase3 candidate not promoted','evidence':EVIDENCE,'experiments':experiment_manifest})
jwrite('SOURCE_COPY_MANIFEST.json',{'sourceFiles':len(copies),'copies':copies,'note':'UTF-8/LF normalization and private literal replacements affect teaching copies only; original hashes and line positions retained.'})
jwrite('SCAN_AUDIT.json',{'date':DATE,'scope':'agent-eval-project only; sibling job projects excluded','currentPlatformFileInventory':dict(counts),'inventoryMeaning':'File enumeration is scope discovery, not a claim to have deeply read every file','selectedSourceFilesRead':len(copies),'sourceAnchorsVerified':len(EVIDENCE),'protectedReferenceFilesVerified':len(original['files']),'businessCodeExecuted':False,'paidModelCalls':0,'platformTestsRerunForCourse':False,'teachingStarted':False,'currentProductionReviewerMatchesRestoreReceipt':all(sha((APP/item['path']).read_bytes())==item['sha256'] for item in json.loads(read('local_checks/2026-11-08_phase3/RESTORE_RECEIPT.json'))['files']),'pythonAst':python})

source_list=['# 关键源码清单与上传顺序\n',
 f'共{len(EVIDENCE)}个定位点，去重后{len(copies)}份精简源码，不复制整个工作空间。原相对路径从agent-eval-project计算，key_sources保持相同结构；它不是完整可运行仓库。源码默认可选阅读，每单元先选2—3处，不一次上传全部长文件。\n',
 '副本按需脱敏机器路径/私有服务地址/凭据字面量，保持行数；原始源码未改，两个SHA与规则见SOURCE_COPY_MANIFEST。原文件SHA和起始行见SOURCE_EVIDENCE。教师如未获得副本不能声称核对。\n',
 '| 单元 | 优先源码ID（细读2—3处，其余按需） |\n| --- | --- |']
for unit in UNITS:source_list.append(f"| {unit['id']} | {ev(*unit['ids'])} |")
source_list.append('\n## 去重文件列表\n\n| 相对路径 | 主要定位点 |\n| --- | --- |')
for item in copies:
    ids=[e['id'] for e in EVIDENCE if e['path']==item['originalPath']]
    source_list.append(f"| [{item['originalPath']}]({item['copyPath']}) | {', '.join(ids)} |")
source_list.append('\n默认课程看当前P/B；L系旧分析路线用于比较，不替换最新平台。第三轮optimized候选源码没有作为默认教学副本混入；若深入研究未推广方案，应另读evidence的推广决策和原实验包，不凭名字猜当前生效。')
write('08_关键源码清单.md','\n'.join(source_list))

quality=json.loads(read(Q+'QUALITY_RESULTS.json'))
m=quality['engines']['holdout']['optimized']['metrics']
experiment=['# 实验事实卡：能引用什么，不能推出什么\n',
'日期/阶段按保存证据记。本课程制作不重跑平台、模型或质量实验；下面为已有结果的索引。\n',
'## X1 阶段二工程基线\n\n945项是选定Vitest断言按文件与全名去重后的结果，含评分/运行/数据库/路由/归因/计算器等；另36项Python。不等于全库测试、类型全过、真实Agent胜率。源码里的Mock是确定条件，不提供生产质量。evidence/phase2_REGRESSION_SUMMARY.json保留组别；全库当时仍295历史诊断位置。\n',
'## X2 实际本机链路\n\n真实PostgreSQL16.15+pgvector、本地Next/Vite与原ModelRuntime→localhost Mock、真实工具/消息持久化、Python进程；登录四表单/API读回与原HTTP冒烟27项通过。BM25两迁移明确未做、私有依赖stub存在，不能推广到所有环境/工具/模型。当前课程包不是全平台安装包。\n',
'## X3 归因质量：28例独立作者合成holdout\n\n24例可观察、12例合成机制已知；候选是人工指定，无真实LLM推理。表里的完整审核输出特指safeCandidate；adapter存储可仍保留带review标记的观察。\n',
'| 组（离线固定候选） | 输出 | 对/错/不可判 | 引用有效 | 有效观察 | root标签命中 |\n| --- | --- | --- | --- | --- | --- |']
for method,title in [('rules','规则'),('direct','直接候选'),('structured','结构'),('citations','引用有效性'),('full','完整审核safeCandidate')]:
    value=m[method]
    fraction=lambda a,b:'NA' if not b else f'{a}/{b}'
    experiment.append(f"| {title} | {value['claims']}/28 | {value['correctClaims']}/{value['wrongClaims']}/{value['unjudgedClaims']} | {fraction(value['validReferences'],value['references'])} | {value['effectiveObservationCases']}/24 | {value['correctKnownRoots']}/12 |")
experiment.extend(['\n0安全输出时接受准确率为NA。规则12条fallback粒度歧义不直接计错/对，全部输出错误风险界0—60%；直接候选7个root标签命中并非模型成绩。来源为evidence/phase3_ATTRIBUTION_QUALITY_REPORT.md和ABLATION_RESULTS；最终统计经内部代理裁决，不是人类gold。\n',
'## X4 局部改善与不推广\n\n开发集完整审核有效观察1/9→2/9；历史真实执行/合成任务的Calculator回放0/1→1/1。独立完整审核safeCandidate有效观察0/24→0/24；后验有效短摘录出现兼容退步，候选未推广。当前四文件已恢复到阶段二SHA，见evidence/phase3_RESTORE_RECEIPT.json。不能讲成新算法已提高真实归因率。\n',
'## X5 回归与统计修正\n\n第三轮当前默认36 Python、71相关TS通过，另有8指标合同及8校验器测试；候选相同链路也测过，不能重复累计。早期指标代码曾把支持资格当证据充分、忽略未知人口或缺失记录，已修正并保留过程反例。只有同标签/同输入/同候选的结果才适合比较。\n',
'## 不能填的数字\n\n真实模型归因准确率、真实Judge评分一致性、供应商Token/费用/延迟、生产并发SLA、完整因果图覆盖率均尚未核实。NULL/NA不是0，不是通过。历史XLSX和指标HTML不构成可信生产root gold。课堂新练习未执行，也没有学生成绩。'])
write('09_实验事实卡.md','\n'.join(experiment))

# A single-file, local-only blueprint reader. Native anchors work without scripts.
def inline(value):
    value=html.escape(value)
    value=re.sub(r'`([^`]+)`',r'<code>\1</code>',value)
    value=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',value)
    def link(match):
        label,target=match.groups()
        target=html.unescape(target)
        if re.match(r'^\d\d_.*\.md',target):
            name,_,anchor=target.partition('#');target='#'+(anchor if anchor else 'doc'+name[:2])
        return '<a href="'+html.escape(urllib.parse.quote(target,safe='/#:.?=&%-_'))+'">'+label+'</a>'
    return re.sub(r'\[([^\]]+)\]\(([^)]+)\)',link,value)

def render_md(value):
    result=[];fence=False;code=[];table=False;listing=False
    def close():
        nonlocal table,listing
        if table:result.append('</tbody></table></div>');table=False
        if listing:result.append('</ul>');listing=False
    for line in value.splitlines():
        if line.startswith('```'):
            close()
            if fence:result.append('<pre><code>'+html.escape('\n'.join(code))+'</code></pre>');code=[]
            fence=not fence;continue
        if fence:code.append(line);continue
        if not line.strip():close();continue
        if re.fullmatch(r'<a id="[a-z0-9]+"></a>',line.strip()):close();result.append(line);continue
        if line.startswith('|'):
            if re.fullmatch(r'\|[ :|-]+\|',line):continue
            cells=[x.strip() for x in line.strip().strip('|').split('|')]
            if not table:
                if listing:result.append('</ul>');listing=False
                result.append('<div class="table-wrap"><table><thead><tr>'+''.join('<th>'+inline(x)+'</th>' for x in cells)+'</tr></thead><tbody>');table=True
            else:result.append('<tr>'+''.join('<td>'+inline(x)+'</td>' for x in cells)+'</tr>')
            continue
        if line.startswith('#'):
            close();size=len(line)-len(line.lstrip('#'));result.append(f'<h{size}>'+inline(line[size:].strip())+f'</h{size}>');continue
        if line.startswith('- ') or re.match(r'^\d+\. ',line):
            if table:result.append('</tbody></table></div>');table=False
            if not listing:result.append('<ul>');listing=True
            result.append('<li>'+inline(re.sub(r'^(?:- |\d+\. )','',line))+'</li>');continue
        close();result.append('<p>'+inline(line.removeprefix('> '))+'</p>')
    close()
    return '\n'.join(result)

style='''body{margin:0;background:#f7f5ef;color:#242a34;font:17px/1.85 system-ui,"Microsoft YaHei",sans-serif}nav{position:fixed;width:235px;inset:0 auto 0 0;padding:28px 20px;overflow:auto;background:#173449;color:#fff}nav a{display:block;color:#dce7ec;padding:7px 0;font-size:14px;text-decoration:none}nav h2{font-size:20px;line-height:1.5;color:#fff}main{margin-left:275px;max-width:1040px;padding:34px 40px}article{background:#fff;padding:36px;margin-bottom:24px;border-radius:10px}h1,h2,h3,h4{line-height:1.5;color:#173449}a{color:#1c607c;text-underline-offset:3px}code{background:#eff3f5;padding:2px 4px;border-radius:3px;font-size:.86em;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#eff3f5;padding:18px;border-radius:5px;line-height:1.6}table{border-collapse:collapse;font-size:14px;min-width:600px;width:100%}th,td{padding:9px 10px;vertical-align:top;border-bottom:1px solid #dce4e8;text-align:left}th{background:#edf2f4}.table-wrap{overflow:auto}article:target,[id]:target{scroll-margin-top:20px}.line{white-space:pre-wrap;display:block;font:13px/1.6 monospace}.line:target{background:#fff1b5}.num{display:inline-block;min-width:48px;color:#718399}footer{font-size:13px;color:#6d7880}@media(max-width:800px){nav{position:static;width:auto}main{margin:0;padding:12px}article{padding:18px}}'''
documents=sorted(OUT.glob('[0-9][0-9]_*.md'))
nav=''.join('<a href="#doc'+path.name[:2]+'">'+html.escape(path.stem)+'</a>' for path in documents)
body=''.join('<article id="doc'+path.name[:2]+'">'+render_md(path.read_text(encoding='utf-8'))+'</article>' for path in documents)
write('index.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent评测工程 · 逆向构建课程蓝图</title><style>'+style+'</style><nav><h2>Agent评测工程<br>逆向构建蓝图</h2><p>2026-11-08 · 10阶段</p>'+nav+'<hr><a href="#v0">直接定位V0</a><a href="#doc07">学习进度</a><p>仅蓝图；没有开始授课。<br>Ctrl+F可搜索全文。</p></nav><main>'+body+'<footer>本地静态阅读，无网络脚本，无自动进度写入。</footer></main></html>')
for item in EVIDENCE:
    target=OUT/'key_sources'/item['path'];lines=target.read_text(encoding='utf-8').splitlines()
    start=max(1,item['line']-8);end=min(len(lines),item['line']+110)
    rows=''.join(f'<span class="line" id="L{i}"><a class="num" href="#L{i}">{i}</a>{html.escape(lines[i-1])}</span>' for i in range(start,end+1))
    link='../key_sources/'+urllib.parse.quote(item['path'],safe='/')
    write('source_view/'+item['id']+'.html','<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+item['id']+'</title><style>'+style+'</style><main style="margin:0;max-width:none"><h1>'+html.escape(item['id']+' '+item['symbol'])+'</h1><p>原相对路径：'+html.escape(item['path'])+'。仅显示锚点附近行，不是整个函数范围。<a href="'+link+'">完整只读副本</a> · <a href="../index.html#'+item['id'].lower()+'">回证据说明</a></p>'+rows+'</main></html>')

jwrite('COURSE_BLUEPRINT.json',{'date':DATE,'modules':[{'id':row[0],'title':row[1],'role':row[2]} for row in modules],'units':UNITS,'factsVocabulary':['真实实现','模拟推演','真实实验','尚未核实'],'teachingStarted':False})
print(json.dumps({'staging':str(OUT),'documents':len(documents),'modules':len(modules),'units':len(UNITS),'sourceAnchors':len(EVIDENCE),'sourceFiles':len(copies),'sourceBytes':sum(x['bytes'] for x in copies)},ensure_ascii=True))
