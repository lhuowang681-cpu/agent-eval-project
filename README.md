# Agent 轨迹评测与故障归因工程

当前完整交付见 [完整项目入口与说明](00_完整项目入口与说明.md)。平台、System VNext 和真实联调记录均保留在 `local_checks/`；以下为早期学习工程说明，后续状态以完整项目入口及各阶段报告为准。

# Agent 轨迹评测与故障归因学习工程

本目录由用户提供的资料整理而来，当前交付为既有代码学习包，尚未形成用户独立开发的新版归因产品。

书籍式阅读从[工程教材版2.1](docs/book/index.html)开始：先读项目总介绍，再按[项目搭建路线](docs/roadmap/BUILD_ROADMAP.md)的A—J、40个任务理解系统怎样逐步搭建；各任务连接6章18节工程正文。复习卡和面试流程另列，源码默认折叠。支持跳转、搜索、笔记与自评，普通浏览器可离线打开。使用与维护见[阅读说明](docs/book/README.md)。本项目每天约5小时，15天首轮、18～20天巩固。

[搭建进度表](docs/roadmap/BUILD_PROGRESS.md)和[逐任务Spec](docs/roadmap/BUILD_TASK_SPECS.md)分别记录参考基础、学习走通与个人实现；当前只完成任务拆解，业务代码未启动。

聊天学习采用[项目专用教练Skill](.github/skills/agent-eval-coach/SKILL.md)：新课先教后练，复习逐题反馈，模拟面试按实际回答追问。[适配来源](docs/learning/SOURCE_ADAPTATION.md)与[真实学习记录](docs/learning/LEARNING_PROGRESS.json)分开保存；没有作答不打分。

先读[当前实现Spec](docs/EXISTING_CODE_SPEC.md)，再跟随[分阶段任务](docs/LEARNING_STAGES.md)。独立聊天从[交接说明](HANDOFF.md)开始。

- `source-reference/attribution/`：归档中的归因/报表参考脚本，保留原内容。
- `source-reference/runtime-original/`：原版平台的关键运行时文件。
- `source-reference/runtime-reviewed/`：审查/修订版对应文件，便于对照。
- `source-reference/historical-analysis/`：原架构审查、功能/性能报告及环境修订说明。
- `SOURCE_MANIFEST.json`：每个文件的原ZIP条目、hash、大小及Python符号清单。

这些参考脚本存在多个入口、硬编码路径和模型/企业服务依赖，不是整包安装后已验证可运行的独立应用。没有自动读取密钥或调用企业系统。后续新增实现应放入独立`src/`和`tests/`，保持参考快照不变。
