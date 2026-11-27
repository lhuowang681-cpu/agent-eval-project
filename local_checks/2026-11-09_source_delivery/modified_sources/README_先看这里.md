# 修改后的源码（2026-11-09）

这是实际修改/新增源码包，不是学习包的精简或脱敏副本。包含第一轮与第二阶段已应用的合并结果，保留平台相对目录及对应回归测试。

- platform/：当前实际使用的 70 个修改/新增文件。覆盖到原平台根目录对应位置；原工程其余源码仍需保留。
- standalone_attribution/：第一轮独立JSONL归因修复入口和回归测试（2文件）。平台固定Python桥接则在platform/scripts/eval-attribution/。
- patches/current_vs_original.patch：上述平台文件相对最初原平台的累计补丁。覆盖文件和应用补丁二选一，不要重复应用。当前本机工作副本已经包含这些改动。
- experimental_not_enabled/：第三轮四文件候选，仅供研究，**没有推广**，不要混入当前platform目录。
- SOURCE_MANIFEST.json、PATCH_VERIFICATION.json：逐文件SHA及累计补丁隔离检查/应用结果。

这是改动源码增量包，不含原工程未修改文件、node_modules、.env、数据库、模型权重、真实密钥或完整运行环境；不能只解压此包就启动全平台。

已在原始文件组成的隔离副本实际检查并应用累计补丁，逐文件比对通过。本次仅整理交付，未重新运行945项平台回归。历史验收与真实模型/生产验证的局限仍以阶段报告为准。

如果使用补丁，在原始版本平台根目录先运行git apply --check --ignore-space-change 补丁绝对路径，检查通过再运行git apply --ignore-space-change 补丁绝对路径。不要对已经应用第一轮或第二阶段改动的工程直接套累计补丁。
