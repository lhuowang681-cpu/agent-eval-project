# 第三轮研究材料

先读 [归因质量报告](phase3/ATTRIBUTION_QUALITY_REPORT.md)，再看 [五组结果](phase3/ABLATION_RESULTS.md)、[误拒分类](phase3/ERROR_TAXONOMY.md) 和 [复现步骤](phase3/REPRODUCE.md)。

候选没有通过质量推广验收，默认平台已恢复原版。此包保留负结果，不是模型效果证明。

phase3内的离线实验只需Python标准库。包含合成数据/保存的本机合成运行，不含历史真实XLSX、真实用户原文、模型密钥、数据库或node_modules。private是合成oracle隔离目录，不是生产隐私数据。

完整平台集成、原始资料审计依赖已有项目；本ZIP不是全平台安装包。源码绝对路径链接换电脑需调整，本文相对报告链接可直接使用。
