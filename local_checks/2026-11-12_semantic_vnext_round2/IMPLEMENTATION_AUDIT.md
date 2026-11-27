# VNext 第二轮实现审计（2026-11-12）

本轮完成两个审核缺陷的局部修复、增强规则 Baseline、48 例合成实验和相关回归。没有把新候选接入生产。复杂语义场景的新真实模型对照尚未运行，不能声称已证明 LLM 增量价值。

## 版本与材料

| 位置 | 身份 / 本轮处理 |
| --- | --- |
| `../2026-11-08_platform_audit/platform` | 实际运行平台；只读、执行原测试，业务源码未改 |
| `../2026-11-10_semantic_vnext` | 第一轮 Shadow 代码与记录；逐文件未改 |
| `../Semantic_VNext_Shadow_2026-11-10.zip` | 旧交付包；CRC、manifest 和当前目录字节核验一致 |
| `previous/` | 本轮前完整 Shadow 快照，54 个文件；没有覆盖它的实验结果 |
| `candidate/` | 新审核、共享事实解析、增强规则和离线 Mock，唯一候选实现 |
| `data/` | 新场景、原始标注、正式运行前复核和冻结记录 |
| `results/` | 本轮专用输出，无历史目录写入 |

指定的 `Semantic_VNext_独立技术评审_2026-11-10.md` 和 `semantic_vnext_independent_probes.py` 在工作区搜索未找到。本轮仅依据用户披露问题独立复现，不伪造这两份原始材料，也不宣称重新执行过“15/15 独立规则探针”。缺失记录见 SOURCE_SNAPSHOT.json。

## 旧链与新链

原平台：扩展路由 → 轨迹提取 → 独立诊断任务/worker → 固定 Python adapter → 原规则与原 Evidence Review → 独立诊断持久化。Judge、评分回写与诊断分离。该链保持不变。

第一轮：用户 JSON 与调用同 key 不同即支持 A；工具结果只要求反向找到唯一 Call，再取最新 Result 支持 B/C。缺少业务约束语义与 Call→Result 正向唯一性。

本轮：`run_experiment → 原 adapter.analyze / candidate.baseline.generate / scripted Mock → 新 review → 本轮 JSON/CSV`。没有网络调用入口、任务注册、数据库迁移或默认 feature flag。

`candidate/review.py` 从旧审核做局部派生，保留 v1 候选形状、引用检查、因果限制、短摘录同字段上下文与规范摘要；替换 A 的支持条件和工具结果可信性。`candidate/facts.py` 负责封闭约束和调用结果索引；`baseline.py` 不调用审核器，但共享该保守解析层。这提高一致性，也意味着 Baseline 与审核器不是独立实现的两个裁判。

## 复现与回归

`reproduce.py` 精确重现旧 12+24+6 份保存判决，共 42 组（有数据重叠，不等于 42 独立轨迹）。两个披露缺陷旧版均 Supported，新版均 Needs Review，输入和新旧输出保存在 reproduction.json。

本轮执行：新 18 项、旧 Shadow 原版 15 项、原 Python 36 项、原 TS 桥接 71 项通过。另将未改动的旧 15 项直接换用新审核器：12 通过、2 断言失败、1 测试异常，均依赖原先无闭集也接受 A 的假设（异常为测试直接索引已被拒绝的 A）。结果保存在 legacy-compatibility.json 和完整日志。没有修改旧断言。新版政策有意收紧，不能声称旧 15 项在新版全过；对应新合同与变形回归另行通过。

SOURCE_SNAPSHOT.json / results/unchanged.json 确认上一轮 54 个文件与平台 10 个关键文件未变。没有重跑历史全平台 945 项、真实 PG/UI 或全库类型检查，也没有解决历史全库类型诊断。

## 本轮未实现

没有通用自然语言审核器、任意字段同义映射或单位语义引擎；没有新的真实模型实验、独立多标注者 gold、生产脱敏集或生产集成。旧六次真实模型输出仅离线复用，不能作为本轮新模型运行。
