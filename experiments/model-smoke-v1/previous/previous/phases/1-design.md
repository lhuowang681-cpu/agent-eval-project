# Phase 1 测试先行设计

不修改旧审核。新sidecar合同分别记录 existence、source、localSupport、causalSupport、global，局部规范观察不升级根因。引用content只用同字段顶层success=false/ok=false；引用error只报告原始非空结构错误，若同节点明确success=true则冲突复核。缺provider/global事件保留warnings，但不否定已配对来源明确的局部事实。来源校验复用第二轮身份索引，故障支持条件不复用旧关键词分类器。不接受嵌套history失败、借未引error、假引用或跨scope。先写六条开发测试，再实现；正式小集合冻结后不改算法。
