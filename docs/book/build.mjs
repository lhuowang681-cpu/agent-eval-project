import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(read('SOURCE_MANIFEST.json'));
const editorial = JSON.parse(fs.readFileSync(path.join(here, 'content.json'), 'utf8'));
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const sources = {};
const addSource = p => { sources[p] = { text: read(p), hash: hash(fs.readFileSync(path.join(root, p))) }; };
for (const entry of manifest.files) {
  const bytes = fs.readFileSync(path.join(root, entry.path));
  if (hash(bytes) !== entry.sha256) throw new Error(`参考快照发生变化：${entry.path}`);
  addSource(entry.path);
}
['README.md', 'HANDOFF.md', 'SOURCE_MANIFEST.json', 'docs/EXISTING_CODE_SPEC.md', 'docs/LEARNING_STAGES.md'].forEach(addSource);
const lessonPaths = fs.readdirSync(path.join(here, 'lessons')).filter(p => p.endsWith('.md')).sort().map(p => 'docs/book/lessons/' + p);
lessonPaths.forEach(addSource);
const learningPaths = ['docs/learning/SOURCE_ADAPTATION.md', 'docs/learning/INTERVIEW_GUIDE.md', 'docs/learning/STUDY_AND_REVIEW_PLAN.md', 'docs/learning/topics.json', 'docs/learning/LEARNING_PROGRESS.json', '.github/skills/agent-eval-coach/SKILL.md'];
learningPaths.forEach(addSource);
const topicData = JSON.parse(read('docs/learning/topics.json'));
const topicById = Object.fromEntries(topicData.topics.map(t => [t.id, t]));
const progressSnapshot = JSON.parse(read('docs/learning/LEARNING_PROGRESS.json'));
const roadmapPaths = ['docs/roadmap/BUILD_ROADMAP.md','docs/roadmap/BUILD_PROGRESS.md','docs/roadmap/BUILD_TASK_SPECS.md','docs/roadmap/BUILD_TASKS.json','docs/roadmap/BUILD_PROGRESS.json','docs/roadmap/BUILD_AUDIT.json'];
roadmapPaths.forEach(addSource);
const buildTasks = JSON.parse(read('docs/roadmap/BUILD_TASKS.json'));
const buildProgress = JSON.parse(read('docs/roadmap/BUILD_PROGRESS.json'));
const buildStatus = {not_started:'[ ] 未开始',in_progress:'[~] 进行中',complete:'[x] 已完成'};
const buildReference = {documented:'已有文档',partial:'参考部分具备',teaching:'已有教学示例',code_visible:'参考源码可见',gap:'规范有/硬校验有缺口',planned:'个人待新增',optional:'可选/未验证'};
const anchors = Object.fromEntries(buildTasks.stages.flatMap(s=>s.tasks.map(t=>['build-task-'+t.id,'build-stage-'+s.id])));
const stagePaths = fs.readdirSync(path.join(root, 'docs/stages')).filter(p => p.endsWith('.md')).sort().map(p => 'docs/stages/' + p);
stagePaths.forEach(addSource);
const routeBySource = { 'README.md': 'start', 'HANDOFF.md': 'schedule', 'docs/EXISTING_CODE_SPEC.md': 'overview', 'docs/LEARNING_STAGES.md': 'contents' };
Object.assign(routeBySource, {'docs/roadmap/BUILD_ROADMAP.md':'build-roadmap','docs/roadmap/BUILD_PROGRESS.md':'build-progress','docs/roadmap/BUILD_TASK_SPECS.md':'build-progress'});
stagePaths.forEach((p, i) => routeBySource[p] = 'chapter-' + (i + 1));
const pages = [];
function page(id, title, group, body, source = '', eyebrow = '') { pages.push({ id, title, group, body, source, eyebrow }); }
function sourceLink(p, symbol = '', label = '') {
  const [file, existingSymbol] = p.split('::');
  if (!sources[file]) throw new Error(`来源入口不存在：${file}`);
  return `<a href="#sources" data-source="${escape(file)}" data-symbol="${escape(symbol || existingSymbol || '')}">${escape(label || p)}</a>`;
}
function inline(raw, origin = '') {
  const tokens = [];
  const token = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
  let s = String(raw).replace(/`([^`]+)`/g, (_, code) => {
    const file = code.split('::')[0];
    return token(sources[file] ? `<code>${sourceLink(code)}</code>` : `<code>${escape(code)}</code>`);
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (/^https?:/i.test(href)) return token(`<a href="${escape(href)}" target="_blank" rel="noreferrer">${escape(label)}</a>`);
    if (/^#[A-Za-z][\w-]*$/.test(href)) return token(`<a href="${escape(href)}">${escape(label)}</a>`);
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(origin), href.split('#')[0]));
    if(target==='docs/roadmap/BUILD_TASK_SPECS.md'&&href.includes('#')){
      const anchor='build-task-'+href.split('#')[1].toUpperCase();
      if(anchors[anchor])return token(`<a href="#${anchor}">${escape(label)}</a>`);
    }
    if (routeBySource[target]) return token(`<a href="#${routeBySource[target]}">${escape(label)}</a>`);
    if (sources[target]) return token(sourceLink(target, '', label));
    return token(`<span>${escape(label)} <code>${escape(href)}</code></span>`);
  });
  s = escape(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}
function table(cols, rows) {
  return `<div class="table-wrap"><table><thead><tr>${cols.map(x => `<th scope="col">${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(x => `<td>${inline(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function md(text, origin = '', headingOffset = 0) {
  const lines = text.split('\n'); let out = ''; let i = 0;
  const special = line => /^(#{1,6} |```|\s*[-*] |\s*\d+\. |\s*\|)/.test(line);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim(); const block = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) block.push(lines[i++]);
      i++;
      if (lang === 'mermaid') out += `<div class="flow" aria-label="平台主链">请求 → 服务协调 → 状态加载 → Brain 决策 → 指令 → Executor 执行 → 保存状态与事件 → 下一步调度<br><strong>运行轨迹 → 数据适配 → 故障归因 → 审计报告</strong></div><details><summary>查看原始关系图定义</summary><pre><code>${escape(block.join('\n'))}</code></pre></details>`;
      else out += `<pre><code>${escape(block.join('\n'))}</code></pre>`;
      continue;
    }
    const heading = line.match(/^(#{1,6}) (.*)/);
    if (heading) { const n = Math.min(heading[1].length + headingOffset, 6); out += `<h${n}>${inline(heading[2], origin)}</h${n}>`; i++; continue; }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
        if (!row.every(x => /^:?-+:?$/.test(x))) rows.push(row);
      }
      out += `<div class="table-wrap"><table><thead><tr>${rows[0].map(x => `<th scope="col">${inline(x, origin)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(x => `<td>${inline(x, origin)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; continue;
    }
    if (/^\s*[-*] /.test(line) || /^\s*\d+\. /.test(line)) {
      const ordered = /^\s*\d+\. /.test(line), tag = ordered ? 'ol' : 'ul'; out += `<${tag}>`;
      const pattern = ordered ? /^\s*\d+\. / : /^\s*[-*] /;
      while (i < lines.length && pattern.test(lines[i])) {
        let value = lines[i++].replace(pattern, '');
        value = value.replace(/^\[ \] /, '自检：');
        out += `<li>${inline(value, origin)}</li>`;
      }
      out += `</${tag}>`; continue;
    }
    const paragraph = [line.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !special(lines[i])) paragraph.push(lines[i++].trim());
    out += `<p>${inline(paragraph.join(' '), origin)}</p>`;
  }
  return out;
}

page('start', '从这里开始', '开卷', `
<div class="cover"><div class="cover-kicker">从零讲起 · 以工程机制为主的教材</div><h1>Agent 轨迹评测<br>与故障归因</h1><p class="cover-sub">从一次具体失败开始，读懂系统怎样运行、判断和验证。</p><div class="cover-meta">6 章 · 18 节正文 · 项目介绍 · 复习与面试</div></div>
<h2>这次先讲明白，再练习</h2><p>开篇说明项目解决什么问题、用了什么技术，以及怎样介绍给面试官。各节正文会解释场景、术语、数据与状态流、设计取舍、故障和验证；不要求你先读懂源码，也不靠提问替代讲解。练习与源码均放在正文后的可选折叠区。</p>
<h2>怎样读</h2><ol><li>先读「项目总介绍」，建立完整画面。</li><li>进入「项目搭建路线」，按 A—J、40个任务理解系统怎样逐步增加机制；每个任务连接对应 E 教材正文。</li><li>教材先讲工程问题，任务卡再规定输入输出、失败反例与验收产物，不要求先看源码。</li><li>在聊天中说“按搭建任务 A1 讲解”“复习 E06”或“工程模拟面试”继续，真实进度分别记录。</li></ol>
<div class="entry-grid"><a class="entry" href="#project-intro"><span>01 / 认识项目</span><strong>项目总介绍</strong><small>业务目标、完整流程、技术职责与面试概述</small></a><a class="entry" href="#E01"><span>02 / 读第一节</span><strong>一次失败到报告</strong><small>完整案例，把每一步实际做什么讲出来</small></a><a class="entry" href="#study-method"><span>03 / 怎么学</span><strong>学习、复习与面试</strong><small>依据参考 Skills 适配，初学先教后练</small></a></div>
<h2>阅读器的使用</h2><p>左侧点击目录，页末前后翻节；浏览器后退可回到上一个阅读位置。搜索覆盖正文与任务。点击源码入口，会在书内打开文本并显示行号，不执行代码。可调字号、切换配色、打印全书。阅读位置、各节笔记及任务自评保存在当前浏览器；建议定期导出学习记录。</p><p>本文件包含正文、样式、交互与 96 个参考文件的文本快照，不依赖在线字体或脚本。移动单个 HTML 仍可阅读；以后源 Spec 改动需要重新生成阅读版。</p>
<h2>版本和排期</h2><p>${escape(editorial.edition)}。第二项目每天约 5 小时，15 天首轮，18～20 天巩固。依据参考系统学习，自己的离线应用仍待实现；教学例子、来源结果和实际实验分别标注。</p>
<p><a href="#contents">查看全书目录 →</a></p>`, 'HANDOFF.md', 'READING GUIDE');

page('project-intro', '项目总介绍：做什么、技术与面试概述', '开卷', md(read('docs/book/lessons/00_项目总介绍.md'), 'docs/book/lessons/00_项目总介绍.md'), 'docs/book/lessons/00_项目总介绍.md', 'PROJECT INTRODUCTION');
page('study-method', '先讲课，再复习与模拟面试', '开卷', `<h1>先讲课，再复习与模拟面试</h1><p class="lede">按照用户指定仓库的学习方法适配，工程讲解优先。</p><h2>三种模式各做什么</h2>${table(['模式', '顺序', '你不熟悉时怎么办'], [['新课', '完整场景 → 必要术语 → 数据 / 状态 → 设计取舍 → 故障与验证', '直接讲，不要求先答题；源码可选'], ['复习', '每次一道 → 你回答 → 具体反馈 → 完整参考解释 → 保存', '说不会就直接补讲，说提示才给提示'], ['模拟面试', '综述 → 工程设计与失败 → 贡献和评测，按回答追问', '只在你要求面试时开始，结束后再给答案与报告']])}<h2>怎样在聊天里继续</h2><p>说“按教材讲 E01”“复习 E06”“工程模拟面试”或“看学习进度”即可。离线书提供正文、自测卡和参考回答；它没有模型服务，不会自动判断你的回答是否正确。</p><h2>怎样记录掌握</h2><p>教材完成不等于你已学会，读过不等于经过考核。浏览器勾选是自评；聊天记录保存真实题目、原回答、反馈和下一步。初始均未评估，不预填分数。教练评价使用事实准确、流程理解、设计取舍、证据与验证，不考源码背诵。</p><h2>知识地图</h2>${table(['知识域', '任务', '核心内容'], topicData.domains.map((d,i) => [d.name, `E${String(i*3+1).padStart(2,'0')}—E${String(i*3+3).padStart(2,'0')}`, topicData.topics.filter(t=>t.domain===d.id).map(t=>t.name).join('；')]))}<h2>方法从哪里来</h2>${md(read('docs/learning/SOURCE_ADAPTATION.md').replace(/^# .*\n/, ''), 'docs/learning/SOURCE_ADAPTATION.md')}<p><a href="#review">打开复习卡 →</a> · <a href="#interview">查看面试方式 →</a></p>`, '.github/skills/agent-eval-coach/SKILL.md', 'LEARN / REVIEW / INTERVIEW');
page('contents', '全书目录', '开卷', '<h1>全书目录</h1><p>按顺序读，也可以从关键词进入需要回看的节点。</p><div id="full-contents"></div>', 'docs/LEARNING_STAGES.md', 'CONTENTS');
page('build-roadmap', '项目搭建路线：从 A 到 J', '项目搭建进度', md(read('docs/roadmap/BUILD_ROADMAP.md'),'docs/roadmap/BUILD_ROADMAP.md'), 'docs/roadmap/BUILD_ROADMAP.md', 'BUILD THE SYSTEM / LEARNING RECONSTRUCTION');
page('build-progress', '40个任务进度表', '项目搭建进度', md(read('docs/roadmap/BUILD_PROGRESS.md'),'docs/roadmap/BUILD_PROGRESS.md'), 'docs/roadmap/BUILD_PROGRESS.md', 'BUILD PROGRESS / TWO SEPARATE TRACKS');
for(const stage of buildTasks.stages){
  const body=`<h1>阶段 ${stage.id}<br>${escape(stage.name)}</h1><p class="lede">${escape(stage.goal)}</p><p>${escape(stage.timeWindow)}。先读关联教材，再走输入输出和反例。路径标为拟建的不代表已实现。</p>`+stage.tasks.map(t=>{
    const status=buildProgress.tasks[t.id];
    return `<h2 id="build-task-${t.id}" class="build-task-heading">${t.id} ${escape(t.name)}${t.optional?'（可选）':''}</h2><p><strong>目标：</strong>${escape(t.goal)}</p><p><strong>为什么在这一步增加：</strong>${escape(t.why)}</p><p>前置：${escape(t.dependsOn.join('、')||'无')}。先读：${t.lessons.map(id=>`<a href="#${id}">${id} 工程正文</a>`).join('、')}。</p>`+
    table(['对象','说明'],[['输入',t.input],['输出',t.output],['参考基础',buildReference[t.referenceState]+'：'+t.referenceNote],['走通状态',buildStatus[status.learning.status]],['新增实现状态',status.development?buildStatus[status.development.status]:'—（本任务不要求新写平台）'],['产物拟存位置',t.artifact]])+
    `<h3>按顺序走一遍</h3><ol>${t.steps.map(x=>`<li>${escape(x)}</li>`).join('')}</ol><h3>完成标准</h3><ul>${t.acceptance.map(x=>`<li>${escape(x)}</li>`).join('')}</ul><aside class="callout"><strong>一定要能解释的失败反例</strong><p>${escape(t.failure)}</p></aside>`+
    (t.plannedFiles?`<details><summary>拟建文件与接口（尚未实现）</summary><ul>${t.plannedFiles.map(x=>`<li><code>${escape(x)}</code></li>`).join('')}</ul>${t.plannedInterfaces?`<p>${t.plannedInterfaces.map(x=>`<code>${escape(x)}</code>`).join('、')}</p>`:''}</details>`:'')+
    `<details class="source-group"><summary>可选：来源核对</summary><ul>${t.references.map(a=>`<li>${sourceLink(buildTasks.referenceAliases[a])}</li>`).join('')}</ul></details><p class="return-link"><a href="#build-progress">返回任务进度表</a> · <a href="#build-roadmap">全局搭建地图</a></p>`;
  }).join('');
  page('build-stage-'+stage.id,`阶段 ${stage.id} · ${stage.name}`,'按阶段走通',body,'docs/roadmap/BUILD_TASKS.json','BUILD STAGE '+stage.id);
}
page('overview', '项目全貌与实现地图', '开卷', `<h1>项目全貌与实现地图</h1><p class="lede">这一篇把当前实现 Spec 连成完整叙述。先读懂主链，再进入任务。</p>${md(read('docs/EXISTING_CODE_SPEC.md').replace(/^# .*\n/, ''), 'docs/EXISTING_CODE_SPEC.md')}`, 'docs/EXISTING_CODE_SPEC.md', 'THE BIG PICTURE');

const objectives = [
  '画清平台与归因工具的边界，追一次工具调用，并将代码修订与实验验证分开。',
  '看懂不同入口，把真实失败与文字提及区分开，明确事件、Trace、任务和 Session 的计数合同。',
  '保护因果证据，理解规则和模型的边界，写出直接原因、内部责任及反事实。',
  '先门禁后排序，分清两种优先分及不同代表样例算法。',
  '让汇总结论能够回到节点，给每个指标和历史成绩标明口径及证据等级。',
  '设计能暴露缺陷的样例，定义个人离线增量，并用真实证据组织项目表达。'
];
for (const [i, source] of stagePaths.entries()) {
  let raw = read(source).replaceAll('仓库根为job-agent-v3', '本项目根为agent-eval-project');
  raw = raw.replace('每个任务建议45～90分钟，第一次以走通场景为主，之后按复述暴露的缺口补课。', '单任务首轮走查可参考45～90分钟；完整学习含补课、实验和复述，按当前15～20天主日程安排。');
  const title = raw.match(/^# (.+)/)[1].replace(/^\d+ /, '');
  const preamble = raw.slice(raw.indexOf('\n') + 1, raw.search(/^## E\d+/m));
  const taskMatches = [...raw.matchAll(/^## (E\d+) (.+)$/gm)];
  page('chapter-' + (i + 1), `第 ${i + 1} 章 · ${title}`, `第 ${i + 1} 章`, `<h1>第 ${i + 1} 章<br>${escape(title)}</h1><p class="lede">${objectives[i]}</p><h2>本章怎么读</h2><p>先读下面三节工程正文。每节已把机制和例子讲出来；原任务清单与源码入口放在后面，需要时再展开。先理解，再选择练习。</p><div class="chapter-tasks">${taskMatches.map(m => `<a class="entry" href="#${m[1]}"><span>${m[1]}</span><strong>${escape(read('docs/book/lessons/' + m[1] + '.md').match(/^# (.+)/)[1])}</strong></a>`).join('')}</div><details><summary>原 Spec 的章节索引</summary>${md(preamble, source)}</details>`, source, `CHAPTER 0${i + 1}`);
  for (const [n, match] of taskMatches.entries()) {
    const id = match[1]; const guide = editorial.guides[id];
    if (!guide) throw new Error(`缺少教学导引：${id}`);
    let task = raw.slice(match.index + match[0].length, n + 1 < taskMatches.length ? taskMatches[n + 1].index : raw.indexOf('## 本章结束检查'));
    const marker = '**回答必须包含的要点**';
    const answerAt = task.indexOf(marker);
    let answer = '';
    if (answerAt >= 0) { answer = task.slice(answerAt + marker.length); task = task.slice(0, answerAt); }
    const lessonPath = 'docs/book/lessons/' + id + '.md';
    const lesson = read(lessonPath); const lessonTitle = lesson.match(/^# (.+)/)[1];
    const topic = topicById[id]; if (!topic) throw new Error('缺少复习主题：' + id);
    const body = `<div class="task-tag">${id} / 工程正文</div><h1>${escape(lessonTitle)}</h1><div class="lesson-body">${md(lesson.replace(/^# .*\n/, ''), lessonPath)}</div>
      <details class="practice"><summary>读完再练：本节复习卡与完整参考回答</summary><p><strong>${escape(topic.question)}</strong></p><p>可以先自己解释；还不熟就直接展开参考回答。聊天复习一次一题，不会时会补讲。</p><details><summary>提示</summary><p>${escape(topic.hint)}</p></details><details class="answer"><summary>完整参考回答</summary><p>${escape(topic.answer)}</p></details><p><a href="#review">更多复习卡 →</a></p></details>
      <details class="source-group"><summary>可选：源码核对入口</summary><p>正文已解释工程机制；以下仅用于查证，不要求逐行阅读。</p><ol>${guide.read.map(p => `<li>${sourceLink(p)}</li>`).join('')}</ol></details>
      <details class="original-spec"><summary>可选：原 Spec 操作与验收清单</summary><div class="spec-task">${md(task.trim(), source)}</div>${answer ? `<details><summary>原任务要点</summary>${md(answer.trim(), source)}</details>` : ''}<p>${sourceLink(source,'','查看原始任务文档')}</p></details>
      <p class="return-link"><a href="#chapter-${i + 1}">返回本章导读</a> · <a href="#glossary">术语速查</a> · <a href="#study-method">学习方式</a></p>`;
    page(id, `${id} ${lessonTitle}`, `第 ${i + 1} 章`, body, lessonPath, `CHAPTER 0${i + 1} / ${id}`);
  }
}

page('review', '逐题复习与完整参考回答', '复习与面试', `<h1>逐题复习与参考回答</h1><p class="lede">先学正文，再检验理解。每题都可以返回对应课程。聊天中一次只进行一道，之后按实际回答反馈。</p><p>这里是离线自测卡，没有自动评分服务。点开题目后，可以先回答或请求提示；不知道时直接读完整参考回答。复习不要求背相同措辞，只要事实、流程、取舍和验证讲清楚。</p>${topicData.domains.map(d => `<h2>${escape(d.name)}</h2>${topicData.topics.filter(t=>t.domain===d.id).map(t => `<details class="review-card"><summary>${escape(t.id + ' · ' + t.name)}</summary><p><strong>${escape(t.question)}</strong></p><p><a href="#${t.id}">先回正文讲解 →</a></p><details><summary>提示</summary><p>${escape(t.hint)}</p></details><details class="answer"><summary>完整参考回答</summary><p>${escape(t.answer)}</p></details><details><summary>复习熟练后再想：设计与失败追问</summary><ol>${t.followups.map(q=>`<li>${escape(q)}</li>`).join('')}</ol></details></details>`).join('')}`).join('')}`, 'docs/learning/topics.json', 'REVIEW / ONE TOPIC AT A TIME');
page('interview', '工程模拟面试怎么进行', '复习与面试', `${md(read('docs/learning/INTERVIEW_GUIDE.md'), 'docs/learning/INTERVIEW_GUIDE.md')}<h2>如何启动</h2><p>在聊天里说“按 agent-eval-coach 做工程模拟面试”。新电脑或新聊天先提供本项目 Skill 与学习记录文件。这里先说明流程，不会在你还没学习时直接启动考核。</p><h2>当前可用内容</h2><p>项目概述在<a href="#project-intro">总介绍</a>，机制教学在 E01—E18，复习问题与完整回答在<a href="#review">复习卡</a>。真实问答与评分会在会话发生后登记，当前没有预造面试成绩。</p>`, 'docs/learning/INTERVIEW_GUIDE.md', 'MOCK INTERVIEW');
page('coach-progress', '学习记录：阅读与评估分开', '复习与面试', `<h1>学习记录：阅读与评估分开</h1><p class="lede">这是生成阅读版时的聊天教练记录快照。浏览器笔记与勾选保存在当前浏览器，不会自动变成评分。</p><p>记录日期：${escape(progressSnapshot.updatedAt)}。真实会话条目 ${progressSnapshot.history.length} 条。初始未评估，不因教材生成而算作已学会。</p>${table(['知识点', '主题', '教练评估'], topicData.topics.map(t=>[t.id,t.name,progressSnapshot.topics[t.id]?.latestScore == null ? '未评估' : String(progressSnapshot.topics[t.id].latestScore)]))}<h2>怎样继续和迁移</h2><p>离线读书用左侧导出 / 导入笔记；聊天教学在项目记录中保存实际作答。跨电脑需要同时带走相应文件，二者不自动同步。导入旧版阅读记录只恢复笔记、自评和页面，不会生成学习评分。</p><p>${sourceLink('docs/learning/LEARNING_PROGRESS.json','','查看真实学习记录文件')} · ${sourceLink('.github/skills/agent-eval-coach/SKILL.md','','查看项目教练规则')}</p>`, 'docs/learning/LEARNING_PROGRESS.json', 'PROGRESS / EVIDENCE BASED');

page('runtime-bridge', '运行机制补充：状态、事件与存储', '附录与工具', `<h1>运行机制补充</h1><p class="lede">对应 D3—D5 的基础走查。将这些概念放回一次请求中理解。</p>
<h2>先区分四个问题</h2>${table(['问题', '观察对象', '阅读时的检查'], [
['现在执行到哪里？', '运行状态：phase、待处理调用、预算等', '谁写入、何时保存、重入时如何加载？'],
['刚刚发生了什么？', '事件：决策、调用、完成、错误、取消等', '是否有唯一身份、顺序或父链？'],
['下一步什么时候执行？', '调度与队列', '一次执行边界在哪里，失败后谁安排后续？'],
['哪些数据必须长期保留？', '业务持久化、轨迹和审计记录', '权威数据在哪里，临时态丢失会怎样？']])}
<h2>把 Redis 和 PG 放回平台职责</h2><p>当前 Spec 描述的平台用 Redis 承担运行态、事件和步锁等职责，PG 承担业务存储。不能只说“用了缓存和数据库”；要指出当前函数读写哪一类数据，以及下一步依赖什么。自己的首个离线工具尚未实现这些服务，不要把被测平台的存储说成个人部署成果。</p>
<h2>一条纸面轨迹</h2><div class="flow">收到请求 → 加载状态 → 决策产生调用指令 → 执行工具 → 记录结果和事件 → 保存状态 → 判断结束或安排下一步</div><p>对每个箭头问三个问题：输入从哪里来？副作用何时发生？如果此处失败，现有轨迹能否说明它执行过？这是一张走查提问表，不表示当前平台已经具备所有恢复保证。</p>
<h2>需要自己补画的图</h2><ol><li>顺序图：一次工具调用及结果回填。</li><li>状态图：执行、等待、结束、失败、中断；以实际代码支持的状态为准。</li><li>数据图：状态、事件、队列消息与业务记录各自的读写方向。</li></ol>
<h2>源码入口</h2><p>${sourceLink('source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts')}<br>${sourceLink('source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts')}</p><p>返回 <a href="#E02">E02 运行时职责</a> 或 <a href="#E06">E06 计数与恢复</a>。</p>`, 'docs/EXISTING_CODE_SPEC.md', 'BRIDGE NOTES');

const planName = 'Job_Agent_深化扩展实施与学习总计划_审阅版_2026-10-22.md';
const planText = fs.readFileSync(path.join(root, '..', planName), 'utf8').replace(/\r\n/g, '\n');
const start18 = planText.indexOf('## 18. 新执行方式');
const end19 = planText.indexOf('## 19.', start18);
if (start18 < 0 || end19 < 0) throw new Error('无法定位当前总计划第18节');
const section18 = planText.slice(start18, end19);
sources['规划来源 / 总计划第18节'] = { text: section18, hash: hash(Buffer.from(section18)) };
page('schedule', '15～20 天学习路线', '附录与工具', `<h1>15～20 天学习路线</h1><p class="lede">当前交接覆盖旧排期。每天 7 小时中约 5 小时用于本项目，平均 1 小时学 Job Agent 新增量，另 1 小时复述与补课。</p><div class="callout"><strong>学习时间与开发时间分别管理</strong><p>Codex 承担主要编码与材料整理；你的时间用于理解设计、核对样例、判断实验与复述。15 天首轮约 75 小时，18 天约 90 小时，20 天约 100 小时；不以看完页数作为学会。</p></div>
${table(['窗口', '阅读范围', '产物 / 检查点'], [
['D1—D2', 'E01—E03：全貌与运行时', '3 分钟项目介绍、请求到执行 / 存储图、来源边界'],
['D3—D5', '运行机制补充 + E04—E06', '一次请求与失败走查、状态图、各层计数'],
['D6—D8', 'E07—E09：去噪、分类与责任', '最早异常、证据 ID、反事实及不确定性'],
['D9—D11', 'E10—E15：门禁、算法、审计与指标', '一组教学计算、两种选样方法、指标字典'],
['D12—D14', 'E16—E17：个人离线闭环', '新增 Spec、合成案例、代码与实际验收记录'],
['D15', 'E18：整合与首次模拟面试', '端到端演示、贡献边界、薄弱清单'],
['D16—D18', '按薄弱点回源、修复与评测', '二轮追问、机制与结果可回查'],
['D19—D20', '必要返工与巩固', '核心缺口收敛，不追加技术凑天数']])}
<h2>每天怎么使用这本书</h2><p>先选择当天窗口中的一个任务，读导引并完成纸面例子；带着问题查少量关键源码；再做产物与复述。需要实验时由后续实现提供运行入口，本书不会自动执行旧脚本。若 D5 仍讲不清基本运行流，缩小新增功能并先补基础。</p>
<h2>检查点</h2><p>D2 全貌；D5 运行 / 失败流程；D8 证据归因；D11 算法与指标；D15 首轮讲述。是否通过依靠产物和复述，不靠阅读器勾选。</p><p>${sourceLink('规划来源 / 总计划第18节', '', '查看当前总计划第 18 节摘录')} · ${sourceLink('HANDOFF.md', '', '查看本项目当前交接')}</p>`, 'HANDOFF.md', 'READING ROUTE');

page('offline-spec', '下一阶段：离线闭环 Spec 目录', '附录与工具', `<h1>下一阶段的离线闭环</h1><p class="lede">待开发的规格骨架。阅读器已经生成，并不意味着归因应用已经实现。</p><div class="flow">合成 JSONL → 输入适配 → 规范模型 → 失败检测 → 归因候选 → 严格证据门禁 → 任务去重 → JSON / Markdown 审计报告</div>
${table(['拟定 Spec', '要明确的合同'], [['00_SCOPE.md', '目标、参考基线、范围、来源与完成标准'], ['01_DATA_CONTRACT.md', 'task_id / trace_id / node_id、调用关联、原始行与缺失处理'], ['02_FAILURE_AND_ATTRIBUTION.md', '失败 / 恢复、双结论、责任边界与弃权'], ['03_EVIDENCE_VALIDATION.md', 'ID 存在、最早异常、模块合法、反事实与复核原因'], ['04_PIPELINE_AND_REPORT.md', '文件 / 类 / 函数、各层计数、报告回链与稳定输出'], ['05_ACCEPTANCE.md', '样例标签、反例、指标分母、运行方式和限制']])}
<h2>首个验收点</h2><ol><li>五类合成输入能够完成本地分析并产生 JSON 与 Markdown。</li><li>不存在的证据节点不能进入正式内部榜；原因可回查。</li><li>明确区分错误事件数、Trace 数和去重任务数。</li><li>证据不足进入复核；外部故障与内部处理缺陷分别记录。</li><li>不读取真实密钥、不调用网络或执行参考脚本；同输入得到可比较的结果。</li></ol><p>这组条件证明首轮合同与工程闭环。模型质量、人工准确率和真实平台表现仍需以后单独验证。完整增量 Spec 在 E17 落实，以上六份文件目前未创建。</p><p><a href="#E16">先设计样例 →</a> · <a href="#E17">再读新增实现任务 →</a></p>`, 'docs/LEARNING_STAGES.md', 'NEXT BUILD / PLANNED');

const terms = [
['Agent', '根据状态与上下文作出决策，并通过模型 / 工具推进任务的系统；本项目中是被测对象。', 'E02'],
['Brain / Runtime / Executor', '分别关注决策、运行指令协调和副作用执行；实际边界要回到当前路径。', 'E02'],
['State（状态）', '当前运行所需的信息，如阶段与待处理调用；不是所有历史事实的同义词。', 'runtime-bridge'],
['Event（事件）', '发生过的一次动作或变化；与当前状态的用途不同。', 'runtime-bridge'],
['Trace / 节点', '观测记录及其中的调用、消息或执行节点；记录粒度取决于输入合同。', 'E06'],
['任务 / Session', '任务有独立验收目标；Session 是会话关系。二者不能自动互换。', 'E06'],
['tool_call_id / parent_id', '前者关联工具调用与返回；后者描述节点父子关系，解决的问题不同。', 'E05'],
['JSONL', '一行一个 JSON 对象的文件形式；业务对象与错误处理仍须合同定义。', 'E04'],
['直接故障', '当前失败的直接机制或现象，例如合法输入遭遇服务 500。', 'E09'],
['最早内部异常', '当前证据中最早出现的内部异常输入 / 决策；不能仅按最后报错位置定位。', 'E09'],
['反事实修复', '保持外部条件不变，只修改内部某机制，判断能避免或缓解哪些后果。', 'E09'],
['证据 ID 有效性', '引用的 ID 确实存在；只是支持性检查的必要部分。', 'E08'],
['语义支持', '被引用内容能支持结论；ID 存在与 JSON 合法都不能代替。', 'E08'],
['taxonomy', '固定分类词表与模块边界，参考实现为 8 层 56 模块。', 'E08'],
['准入 / 排序', '准入判有无资格；排序判合格项的治理先后。', 'E10'],
['开发优先分 / 根因收敛分', '前者四维加权；后者使用严重度与对数任务频次，不能合称同一公式。', 'E11'],
['medoid', '从真实样本中选距离意义下的中心样本；参考路径使用 TF-IDF / 余弦。', 'E12'],
['恢复', '原失败步骤或任务达到定义的恢复条件；不是任意后续调用成功。', 'E06'],
['覆盖 / 弃权', '系统能够作出有效判断的范围，以及明确保留不确定的部分；分母须预先定义。', 'E16'],
['TTFT', 'Generation 级首 Token 等待时间，需要首 Token 观测及覆盖口径。', 'E14'],
['审计链', '从汇总结论走到具体任务、节点和原始字段的可核查路径。', 'E13']
];
page('glossary', '术语速查', '附录与工具', `<h1>术语速查</h1><p class="lede">遇到陌生词先看一句解释，再回到对应任务。</p>${table(['术语', '本项目中的意思', '回到正文'], terms.map(([t, d, route]) => [t, d, `[对应阅读](#${route})`])).replace(/<span>对应阅读 <code>#([^<]+)<\/code><\/span>/g, '<a href="#$1">对应阅读 →</a>')}`, '', 'GLOSSARY');

page('sources', '来源索引与证据边界', '附录与工具', `<h1>来源索引与证据边界</h1><p class="lede">可打开原文查看；所有代码只作为文本展示。</p><p>参考来源是用户提供归档的选取快照。原包非用户开发，本书没有复跑旧归因脚本、企业服务或真实模型，没有新增模型准确率。源码可见机制、来源报告、教学预测和新实测分别记录。</p><h2>编辑说明</h2><ul><li>正文保留现有 Spec 与 18 个任务，新增白话导引、教学对照、术语和阅读导航。</li><li>任务原文误写的“仓库根为 job-agent-v3”在阅读版中改为本项目路径；源参考不变。</li><li>按更新后的交接与总计划第 18 节使用 15～20 天学习路线；旧时长仅作首轮走查参考。</li><li>所有教学数字、纸面案例不表示运行结果。任务完成状态默认未勾选。</li><li>阅读版是生成时快照；页面显示的源码 hash 可与文件来源清单核对。</li></ul><h2>原始文档</h2><ul>${['README.md', 'HANDOFF.md', 'SOURCE_MANIFEST.json', 'docs/EXISTING_CODE_SPEC.md', 'docs/LEARNING_STAGES.md', ...stagePaths, '规划来源 / 总计划第18节'].map(p => `<li>${sourceLink(p)}</li>`).join('')}</ul><h2>96 个参考文件</h2>${['runtime-original', 'runtime-reviewed', 'attribution', 'historical-analysis'].map(group => `<details class="source-group"><summary>${group} / ${manifest.files.filter(f => f.path.includes('/' + group + '/')).length} 文件</summary><ul>${manifest.files.filter(f => f.path.includes('/' + group + '/')).map(f => `<li>${sourceLink(f.path)}</li>`).join('')}</ul></details>`).join('')}`, 'SOURCE_MANIFEST.json', 'SOURCES & LIMITS');

const studyPlanPath = 'docs/learning/STUDY_AND_REVIEW_PLAN.md';
pages.find(p => p.id === 'study-method').body += md(read(studyPlanPath), studyPlanPath, 1);

const nav = [];
let lastGroup = '';
for (const p of pages) {
  if (p.group !== lastGroup) { nav.push(`<div class="nav-group">${escape(p.group)}</div>`); lastGroup = p.group; }
  nav.push(`<a href="#${p.id}" data-route="${p.id}"${/^E\d/.test(p.id) ? ' class="task-nav"' : ''}>${escape(p.title)}<span class="nav-check" aria-hidden="true"></span></a>`);
}
const css = fs.readFileSync(path.join(here, 'reader.css'), 'utf8');
const js = fs.readFileSync(path.join(here, 'reader.js'), 'utf8');
const data = JSON.stringify({ edition: editorial.edition, pages: pages.map(({ id, title, group, source }) => ({ id, title, group, source })), anchors, sources }).replaceAll('<', '\\u003c');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Agent 轨迹评测与故障归因 · 阅读手册</title><style>${css}</style></head><body>
<a class="skip" href="#main">跳到正文</a><aside id="sidebar"><a class="brand" href="#start"><span class="brand-icon">迹</span><span>Agent 轨迹评测<small>与故障归因 · 阅读手册</small></span></a><div class="sidebar-meta">18 LESSONS / 40 BUILD TASKS</div><label class="search-label" for="search">搜索全书</label><div class="search-box"><input id="search" type="search" placeholder="试试：证据、重试、TTFT" autocomplete="off"><kbd>/</kbd></div><div id="search-results" aria-live="polite" hidden></div><nav id="book-nav" aria-label="全书目录">${nav.join('')}</nav><div class="sidebar-footer"><div class="progress-caption"><span>教材自评（E01—E18）</span><strong id="progress-text">0 / 18</strong></div><progress id="progress" max="18" value="0"></progress><small>仅记录你的自评，不代表实验通过</small><button id="export" class="wide">导出笔记与进度</button><label class="import-label">导入学习记录<input id="import" type="file" accept="application/json,.json"></label></div></aside>
<div class="workspace"><header class="toolbar"><button id="menu" aria-label="展开目录" aria-expanded="false">☰ 目录</button><div id="breadcrumb">开卷 / 从这里开始</div><div class="tools"><button id="smaller" aria-label="减小字号">A−</button><button id="larger" aria-label="增大字号">A+</button><button id="theme" aria-label="切换深浅配色">配色</button><button id="print">打印全书</button></div></header><main id="main" tabindex="-1">${pages.map(p => `<article class="bookpage" id="${p.id}" data-page="${p.id}" aria-label="${escape(p.title)}"><div class="eyebrow">${escape(p.eyebrow)}</div>${p.body}<div class="page-source">阅读来源：${p.source ? sourceLink(p.source, '', p.source) : '本书整理'} · ${escape(editorial.edition)}</div></article>`).join('')}
<section id="learning-panel" hidden aria-label="个人学习记录"><div class="learning-header"><h2>个人笔记</h2><label id="done-label"><input id="task-done" type="checkbox"> 我已完成本节练习与复述（自评）</label></div><label for="notes" class="notes-label">记下自己的解释、尚未理解的机制或下次要核对的证据</label><textarea id="notes" rows="5" placeholder="我的复述：\n仍有疑问：\n练习产物或实测记录："></textarea><p id="save-status" role="status">笔记仅保存在当前浏览器，可导出备份。</p></section><nav id="pager" aria-label="前后翻节" hidden><a id="prev" href="#start"></a><a id="next" href="#contents"></a></nav></main><footer class="book-footer">先理解工程机制，再练习、复习与验证。<span>${escape(editorial.edition)}</span></footer></div>
<dialog id="source-dialog" aria-labelledby="source-title"><header><div><span class="eyebrow">SOURCE READER / 只读文本</span><h2 id="source-title"></h2></div><button id="close-source" aria-label="关闭源码查看">关闭 ×</button></header><p id="source-hash"></p><div id="source-code" tabindex="0"></div></dialog><div id="toast" role="status" aria-live="polite"></div><noscript><div class="noscript">脚本未启用：下方可连续阅读全文，目录使用页内跳转；搜索、笔记和内嵌源码查看需要启用脚本。</div></noscript><script id="book-data" type="application/json">${data}</script><script>${js}</script></body></html>`;
// Generated artifacts must stay inside this project.
fs.writeFileSync(path.join(here, 'index.html'), html, 'utf8');
const ids = new Set(pages.map(p => p.id));
Object.keys(anchors).forEach(id=>ids.add(id));
const links = [...html.matchAll(/href="#([^"\s]+)"/g)].map(m => m[1]);
const invalid = links.filter(id => !ids.has(id) && id !== 'main');
if (invalid.length) throw new Error('无效目录跳转：' + [...new Set(invalid)].join(','));
if (Object.keys(editorial.guides).length !== 18 || pages.filter(p => /^E\d\d$/.test(p.id)).length !== 18) throw new Error('任务数不正确');
const info = { edition: editorial.edition, pageCount: pages.length, taskCount: 18, lessonCharacters: Object.fromEntries(lessonPaths.map(p=>[path.basename(p),read(p).length])), referenceFiles: manifest.reference_count, verifiedReferenceHashes: manifest.files.length, embeddedSources: Object.keys(sources).length, internalLinksChecked: links.length, bytes: Buffer.byteLength(html), inputs: ['content.json', 'reader.css', 'reader.js', 'docs/book/lessons/*.md', 'docs/learning/*', '.github/skills/agent-eval-coach/SKILL.md', 'docs/EXISTING_CODE_SPEC.md', 'docs/stages/*.md', 'HANDOFF.md', planName + '#18'], outputSha256: hash(Buffer.from(html)) };
Object.assign(info,{buildTaskCount:buildTasks.stages.flatMap(s=>s.tasks).length,buildStageCount:buildTasks.stages.length});
info.inputs.push('docs/roadmap/*');
fs.writeFileSync(path.join(here, 'BUILD_INFO.json'), JSON.stringify(info, null, 2) + '\n');
console.log(JSON.stringify(info, null, 2));
