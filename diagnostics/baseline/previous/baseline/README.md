# 便携规则快照

本目录 adapter.py、rules_pure.py、evidence_review.py 是实际平台 `scripts/eval-attribution/` 中同名文件的逐字复制，仅用于缺少完整平台时的离线 baseline。来源 SHA 见上级 SOURCE_FREEZE.json，同名文件应保持相同。

实验对照调用 adapter.analyze（纯规则观察），不把这份旧审核称为新语义审核。平台存在时 run_experiment 优先读取平台原路径；便携包缺少平台时才使用此快照。不要将 baseline 覆盖到平台，也不要在这里实施新语义功能。
