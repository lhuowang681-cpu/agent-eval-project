# 最终295项诊断的44条消息变化复核

本次只读已有日志，没有重跑tsc或修改业务/测试/tsconfig。对照`baseline.log`与`phase2/logs/final-typecheck.log`，文件、行、列和TS代码匹配295/295，新位置0、消失位置0；44处诊断首行文本不同，不能说最终295条逐字一致。

| 变化分类 | 数量 | 核查结果 |
| --- | --- | --- |
| 显示联合成员顺序 | 7 | 显示成员排序后首行完全相同；包括排序选项、MCP连接方式及community参数联合 |
| tRPC泛型上下文展开 | 28 | 缺失的API属性名完全相同；DecoratedProcedureRecord的errorShape/错误码联合顺序及截断位置改变 |
| i18n联合上下文显示 | 6 | 传入的翻译key/参数与namespace不变，显示key联合前缀/顺序不同；日志有省略，不能严格证明所有隐藏成员逐项等价 |
| 对象字段展开顺序 | 2 | session与knowledgeBase首行字段顺序变化，但完整诊断末端根因逐字相同 |
| 审计副本绝对路径 | 1 | getTestDB中schema import路径从隔离副本变为当前工作副本；规范化路径后首行相同 |

两个对象展开样例已读完整诊断：session仍是config.skills的`Json | undefined`不能赋给`string[] | null | undefined`；knowledgeBase仍是installedFromSnapshot的`Json | undefined`不能赋给`Record<string, unknown> | null | undefined`。不是把不同对象首行简单当成等价。

44处报错所在源文件与ZIP隔离基线hash全部相同。结合相同缺失属性/调用参数/末端类型矛盾，**未观察到这些位置新增独立类型错误成因**；变化符合本轮新增共享router/types后的类型渲染与上下文顺序变化。但source hash不变不能单独证明依赖类型完全不变，尤其i18n与tRPC的泛型被截断，不能宣称所有展开成员字节等价。

建议最终表述：“整体类型检查仍失败，保留295个历史诊断位置；本轮初始新增的错误位置已修复，最终新位置0。44处诊断显示文本不同，已另行分类披露。”不要把严格全消息比较的added/removed当作新增诊断位置，也不要隐去严格比较差异。

`FINAL_MESSAGE_AUDIT.json`保留每条分类、证据、源hash，以及未修改的原始完整baseline/final诊断块。历史`AUDIT.md`和comparison.json描述的是**原ZIP与round1冻结副本**的295条完全共享，不应混用来声称本次phase2最终消息也逐字相同。
