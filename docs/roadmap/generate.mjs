import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const data=JSON.parse(fs.readFileSync(path.join(here,'BUILD_TASKS.json'),'utf8'));
const tasks=data.stages.flatMap(s=>s.tasks);
const ids=new Set(tasks.map(t=>t.id));
if(tasks.length!==40||ids.size!==40) throw new Error('Expected 40 unique build tasks');
const statePath=path.join(here,'BUILD_PROGRESS.json');
const state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{version:1,updatedAt:data.updatedAt,nextTask:'A1',tasks:{},history:[]};
const statusNames={not_started:'[ ]',in_progress:'[~]',complete:'[x]'};
const referenceNames={documented:'已有文档',partial:'参考部分具备',teaching:'已有教学示例',code_visible:'参考源码可见',gap:'规范有/硬校验有缺口',planned:'个人待新增',optional:'可选/未验证'};
const seen=new Set();
for(const stage of data.stages){
  if(stage.tasks.length!==4) throw new Error('Each stage should contain four tasks');
  for(const t of stage.tasks){
    for(const dep of t.dependsOn)if(!seen.has(dep))throw new Error('Dependency must precede task: '+t.id+' -> '+dep);
    for(const a of t.references){
      const p=data.referenceAliases[a];if(!p||!fs.existsSync(path.join(root,p)))throw new Error('Missing reference '+a);
    }
    if(!referenceNames[t.referenceState]||!t.goal||!t.input||!t.output||!t.why||!t.steps.length||!t.acceptance.length||!t.failure)throw new Error('Incomplete task '+t.id);
    state.tasks[t.id]??={learning:{status:'not_started',startedAt:null,completedAt:null,evidence:[],notes:''},development:t.developmentRequired?{status:'not_started',startedAt:null,completedAt:null,evidence:[],notes:''}:null};
    for(const track of ['learning','development']){
      const record=state.tasks[t.id][track];
      if(!record)continue;
      if(!Object.hasOwn(statusNames,record.status))throw new Error('Invalid status '+t.id);
      if(record.status==='complete'){
        if(!record.completedAt||!record.evidence.length)throw new Error('Complete requires date and evidence: '+t.id);
        for(const file of record.evidence){
          const target=path.resolve(root,file);
          if(!target.startsWith(root+path.sep)||!fs.existsSync(target))throw new Error('Evidence must exist in project '+file);
        }
      }
    }
    seen.add(t.id);
  }
}
if(Object.keys(state.tasks).some(id=>!ids.has(id)))throw new Error('Unknown task in progress');
fs.writeFileSync(statePath,JSON.stringify(state,null,2)+'\n');
const cell=s=>String(s).replaceAll('|',' / ').replaceAll('\n',' ');
const table=(cols,rows)=>'| '+cols.join(' | ')+' |\n| '+cols.map(()=> '---').join(' | ')+' |\n'+rows.map(r=>'| '+r.map(cell).join(' | ')+' |').join('\n')+'\n';
const required=tasks.filter(t=>!t.optional),optional=tasks.filter(t=>t.optional);
const learned=t=>state.tasks[t.id].learning.status==='complete';
const developed=t=>state.tasks[t.id].development?.status==='complete';
const devRequired=required.filter(t=>t.developmentRequired);
const fmt=(t,track)=>state.tasks[t.id][track]?statusNames[state.tasks[t.id][track].status]:'—';
const lessonLinks=t=>t.lessons.map(x=>`[${x}](../book/index.html#${x})`).join('、');
let progress=`# 项目搭建进度表\n\n更新时间：${state.updatedAt}。每完成一个子任务，更新对应状态、完成日期与证据。\n\n状态：[ ] 未开始 / [~] 进行中 / [x] 已完成。**参考有代码不等于本次已经走通；讲解材料已经写好也不代表用户学会。**\n\n本表按当前代码重建合理搭建顺序，不是原作者真实开发时间线。A—H 为参考工程机制走查，I—J 为自己的精简离线实现与验证；J3 可选。当前未启动业务编码，没有填入历史测试数或上游完成日期。\n\n`;
for(const s of data.stages){
  progress+=`## 阶段 ${s.id}：${s.name}\n\n目标：${s.goal}\n\n`;
  progress+=table(['任务编号','任务名称','参考基础','走通状态','新增实现','走通日期','工程验收日期'],s.tasks.map(t=>[t.id,`[${t.name}](BUILD_TASK_SPECS.md#${t.id.toLowerCase()})${t.optional?'（可选）':''}`,referenceNames[t.referenceState],fmt(t,'learning'),fmt(t,'development'),state.tasks[t.id].learning.completedAt||'—',state.tasks[t.id].development?.completedAt||'—']));
  progress+='\n';
}
progress+='## 总体进度\n\n'+table(['阶段','任务数','必做走通完成','必做新增实现完成','可选任务'],data.stages.map(s=>{const r=s.tasks.filter(t=>!t.optional),d=r.filter(t=>t.developmentRequired);return[s.id+' '+s.name,s.tasks.length,`${r.filter(learned).length}/${r.length}`,d.length?`${d.filter(developed).length}/${d.length}`:'—',s.tasks.filter(t=>t.optional).map(t=>t.id).join('、')||'—'];}));
progress+=`\n必做走通 ${required.filter(learned).length}/${required.length}；必做个人实现 ${devRequired.filter(developed).length}/${devRequired.length}；可选 ${optional.map(t=>t.id).join('、')} 单独记录。下一步建议 ${state.nextTask}。\n\n`;
progress+='## 怎样更新\n\n1. 首先确认是在更新走通进度，还是新增代码进度。两个状态不能互相代替。\n2. 教学走通完成：留下该任务的输入到输出产物、失败反例及真实复述/核对记录；纸面预测明确标注，不强制部署完整企业平台。只发教材不打勾。\n3. 工程实现完成：拟建文件已实际实现，运行必要验收并保存真实配置、输入、输出和限制。仅有源码不打勾。\n4. 编辑 BUILD_PROGRESS.json 的对应任务：status、日期和 evidence。完成状态必须有本项目内真实存在的证据文件；不补造过去记录。history 追加实际发生的变更依据。\n5. 运行 `node docs/roadmap/generate.mjs` 更新表格。再运行 `node docs/book/build.mjs` 更新阅读器快照；需要换电脑时重新打包。\n\n不从浏览器勾选自动同步到这里，也不从任务打勾自动生成教练分数。当前没有用户走通记录，保持未开始。\n';
fs.writeFileSync(path.join(here,'BUILD_PROGRESS.md'),progress);

let specs='# 项目逐任务搭建规格\n\n这是现在补建的教学搭建规格，不是原作者历史。它与 E01—E18 教材互相配合：教材负责先讲明白，任务卡负责明确本步输入、增加的机制、验证和完成产物。\n\nA—H 主要做机制走查与教学推演；不会让用户重写整个平台。I—J 的源码路径和接口均为拟建，不代表当前已存在。Codex 负责主要编码，用户核对合同与理解结果。\n\n';
for(const s of data.stages){
  specs+=`## 阶段 ${s.id}：${s.name}\n\n${s.goal}\n\n`;
  for(const t of s.tasks){
    specs+=`<a id="${t.id.toLowerCase()}"></a>\n\n### ${t.id} ${t.name}${t.optional?'（可选）':''}\n\n`;
    specs+=`**目标：** ${t.goal}\n\n**为什么在这一步做：** ${t.why}\n\n**前置：** ${t.dependsOn.length?t.dependsOn.join('、'):'无'}。关联教材：${lessonLinks(t)}。\n\n`;
    specs+=table(['对象','合同'],[['输入',t.input],['输出',t.output],['参考现状',referenceNames[t.referenceState]+'：'+t.referenceNote],['操作范围',t.developmentRequired?'个人新增/验证，按拟建Spec实施；本次只规划':'以工程讲解、完整场景与纸面走查为主，不要求修改源快照'],['完成产物（拟存位置）','`'+t.artifact+'`']]);
    specs+='\n**按顺序走一遍：**\n\n'+t.steps.map((x,i)=>`${i+1}. ${x}`).join('\n')+'\n\n';
    specs+='**完成标准：**\n\n'+t.acceptance.map(x=>'- '+x).join('\n')+'\n\n';
    specs+=`**一定要解释的失败反例：** ${t.failure}\n\n`;
    if(t.plannedFiles)specs+='**拟建文件（尚未实现）：**\n\n'+t.plannedFiles.map(x=>'- `'+x+'`').join('\n')+'\n\n';
    if(t.plannedInterfaces)specs+='**拟建接口（不是现有函数声明）：** '+t.plannedInterfaces.map(x=>'`'+x+'`').join('、')+'。\n\n';
    specs+='**可选来源核对：**\n\n'+t.references.map(a=>{const p=data.referenceAliases[a];return`- [${p}](${path.relative(here,path.join(root,p)).split(path.sep).join('/')})`}).join('\n')+'\n\n';
  }
}
fs.writeFileSync(path.join(here,'BUILD_TASK_SPECS.md'),specs);

const overview=`# 从现有代码反推项目搭建顺序\n\n日期：${data.updatedAt}。参考用户粘贴的“阶段→子任务→状态→日期→目标/输入输出/文件/验收”结构，为当前 Agent 评测参考包重新设计。没有照抄 RAG 的技术模块、68项数量、2026年1月日期或测试成绩。\n\n## 这样走一遍，为什么有助于理解\n\n单看最终架构图容易记住模块名，却不知道为什么需要它。按搭建顺序学习，可以先看到一个更简单的方案，再看具体失败如何迫使系统增加机制。例如：单次工具调用能工作，但结果未回填会失败，所以引入状态与事件；错误记录很多，所以需要统一身份和去重；候选标签合法却可能引用假节点，所以需要独立证据门禁。每一步都回答“现在多解决了什么、付出了什么代价”。\n\n这是一条合理的教学重建，不声称上游作者真的按这个顺序开发。对参考部分先用工程解释和固定例子走通；对个人增量再实际写代码与验收。能够解释、手算和判断反例同样是产物，不要求用户手写所有模块或部署整个企业平台。\n\n## 全局搭建地图\n\nA 业务与合同 → B 最小运行循环 → C 状态/异步/观测 → D 数据接入 → E 失败事实与责任 → F 去噪/分类/证据 → G 准入/排序/案例 → H 报告/指标 → I 个人离线实现 → J 评测与交付。\n\nA—H 不代表要再开发一个通用 Agent 平台，它们帮助理解被测对象和参考分析器。I—J 聚焦自己的合成 JSONL→确定性分析→严格门禁→任务去重→审计报告，形成真实个人增量。\n\n## 阶段与产物\n\n${table(['阶段','本步增加什么','阶段验收产物','时间参考'],data.stages.map(s=>[s.id+' '+s.name,s.goal,s.tasks.map(t=>t.id).join('、'),s.timeWindow]))}\n## 状态分三种事实\n\n- 参考基础：源码可见、部分具备、仅文档/教学、明确缺口或待新增，是对已有材料的判断，不是运行成绩。\n- 走通状态：你是否在教练讲解后完成输入到输出、反例与复述。初始全部未开始。\n- 新增实现状态：只用于 I—J，代码/验收是否实际完成；与学习进度分别更新。J3 模型对照为可选，不阻塞首轮收口。\n\n当前 ${required.length} 项必做走通、${devRequired.length} 项必做个人实现，以及 ${optional.length} 项可选扩展。不是40次独立课程：同一节 E 教材可覆盖多个搭建任务，按现有每天约5小时、15天首轮和18—20天巩固窗口合并推进。若基本运行流没有掌握，先缩小新增范围，不压缩理解。\n\n## 与现有教材怎样配合\n\n先读项目总介绍，再从 A1 开始。每次先讲对应 E 节中的完整场景，再按本任务的输入输出走一遍，留下小产物，最后选择复述或复习。没有讲过的内容不先考。源码路径是给查证用，主线仍是工程机制、取舍、失败和验证。\n\n前置关系是工程解释与组装依赖，不是要求用户先通过全部教学才能允许 Codex 编码。用户以后授权开发时，代码可按真实工程前置自主推进；学习进度独立维护。本次只交付规划与进度管理，没有启动业务实现。\n\n## 文件入口\n\n- [项目搭建进度表](BUILD_PROGRESS.md)：阶段总览和两个状态轨道。\n- [逐任务规格](BUILD_TASK_SPECS.md)：40张目标、步骤、失败与验收任务卡。\n- [任务定义](BUILD_TASKS.json)：单一任务定义。\n- [真实搭建记录](BUILD_PROGRESS.json)：初始无完成证据，以后逐项更新。\n- [现有教材](../book/index.html)：先讲工程正文，再做任务；已保留旧笔记ID。\n\n## 第一站 A1 的示范怎么走\n\n输入是一个业务需求：“查询指定日期订单”。先说明 Agent 平台会决策、执行工具并留下轨迹；分析器读取这些事实、关联调用与结果、识别失败、分析证据并汇总报告。接着改变工具结果为外部500，解释为什么失败不直接等于平台参数代码错。最后形成一张范围图，指出当前参考和自己的拟增量。这里给出教学示范，不据此把用户走通状态打勾。\n`;
fs.writeFileSync(path.join(here,'BUILD_ROADMAP.md'),overview);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'SOURCE_MANIFEST.json'),'utf8'));
for(const f of manifest.files){
  const sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,f.path))).digest('hex');
  if(sha!==f.sha256)throw new Error('Reference snapshot changed: '+f.path);
}
const info={date:data.updatedAt,stages:data.stages.length,tasks:tasks.length,requiredTasks:required.length,optionalTasks:optional.map(t=>t.id),requiredDevelopmentTasks:devRequired.length,learningComplete:required.filter(learned).length,developmentComplete:devRequired.filter(developed).length,dependenciesChecked:tasks.reduce((n,t)=>n+t.dependsOn.length,0),referencePathsChecked:Object.keys(data.referenceAliases).length,referenceHashesVerified:manifest.files.length,referenceScriptsExecuted:false};
fs.writeFileSync(path.join(here,'BUILD_AUDIT.json'),JSON.stringify(info,null,2)+'\n');
console.log(JSON.stringify(info,null,2));
