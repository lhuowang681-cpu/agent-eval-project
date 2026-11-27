# 学习、复习与面试流程的来源及适配

日期：2026-10-23。按用户要求阅读参考仓库 Skills 后形成。仓库读取时 main 提交为 `f658c5a4011c8b826707a65a3b11ce9301b0626f`。本文件记录方法来源，不表示采用该 RAG 项目的技术能力或成绩。

## 已阅读的 Skill

| 来源 | 借鉴什么 | 本项目怎样适配 |
|---|---|---|
| [project-learner](https://github.com/jerry-ai-dev/MODULAR-RAG-MCP-SERVER/blob/f658c5a4011c8b826707a65a3b11ce9301b0626f/.github/skills/project-learner/SKILL.md) | 项目发现、知识域 / 知识点、分层追问、四维反馈、学习历史 | 用本项目 6 域 18 个任务映射；初学先完整讲解，后作答；工程关联替代源码记忆 |
| [project-review](https://github.com/jerry-ai-dev/MODULAR-RAG-MCP-SERVER/blob/f658c5a4011c8b826707a65a3b11ce9301b0626f/.github/skills/project-review/SKILL.md) | 每次一题、答后详细反馈、不会时直接讲、章节小结和恢复进度 | 依据本项目案例自编复习卡；先学后复习；不套用 RAG 的 9 章 71 题 |
| [interview-prep](https://github.com/jerry-ai-dev/MODULAR-RAG-MCP-SERVER/blob/f658c5a4011c8b826707a65a3b11ce9301b0626f/.github/skills/interview-prep/SKILL.md) | 三方向面试、按原回答追问、记录原问答、结束后报告、避免重复 | 工程深挖为默认；方向改为全貌、工程、贡献 / 评测；不把“能自圆其说”当作虚构经历依据 |
| [resume-writer](https://github.com/jerry-ai-dev/MODULAR-RAG-MCP-SERVER/blob/f658c5a4011c8b826707a65a3b11ce9301b0626f/.github/skills/resume-writer/SKILL.md) | 背景 → 目标 → 方案 → 结果的表达组织 | 仅借结构；不采用未经验证的建议效果数字，不冒认上游开发 |
| [auto-coder](https://github.com/jerry-ai-dev/MODULAR-RAG-MCP-SERVER/blob/f658c5a4011c8b826707a65a3b11ce9301b0626f/.github/skills/auto-coder/SKILL.md) | 将概述、技术、架构、任务、验证分别组织，Spec 关联交付 | 本次仅整理教材与教练流程；未触发该 RAG 项目的自主编码或提交步骤 |

另已阅读 project-learner 的进度模板，用其“领域汇总 / 单点记录 / 详细历史”思想组织本项目状态。原 RAG 的配置路径、问题答案、学习记录均不作为本项目事实。

## 与原流程有意不同的地方

用户明确从零学习、工程讲解优先、源码可以少。原 project-learner 以问答诊断再提供学习指南，本项目将新课改为“业务例子 → 机制解释 → 数据与状态流 → 取舍 → 故障与验证 → 可选练习”。这项调整遵循用户需求，不是声称原 Skill 已经这样设计。

复习与模拟面试仍保留先答再反馈；它们只在对应模式使用。离线教材可直接读完整讲解与参考回答，聊天可以按实际回答动态追问。两种载体相互配合，但离线文件没有模型服务，不会自动语义评分。

源码阅读用于教练查证事实，不变成用户逐行通读要求。参考包中的 old offline 入口不保证无模型调用，因此在个人小闭环实现前，练习以合成轨迹分析和纸面推演为主。

## 产物位置

- `.github/skills/agent-eval-coach/SKILL.md`：项目内适配版教练规则。
- `docs/learning/topics.json`：6 域 18 点、每点主问题、完整参考回答、提示和追问。
- `docs/learning/LEARNING_PROGRESS.json`：真实学习会话记录，初始无评分。
- `docs/learning/INTERVIEW_GUIDE.md`：面试模式、记录和反馈规则。
- `docs/book/lessons/`：先讲清知识的教材正文。

适配 Skill 为本项目文件，不代表已自动安装或注册到其他电脑的 Codex。另一台电脑可以直接读 HTML；若要用其他聊天继续教学，让该聊天先读取这个 Skill 及进度文件。教材打包不自动提取本机浏览器私人笔记。
