# 登录后评测页面的真实浏览器复测

入口 `verify_ui.cjs` 使用已安装的 `@playwright/test` 和本机 Edge，直接驱动真实页面，不使用浏览器 CUA，不替换应用接口。仅允许 localhost/127.0.0.1。不会注入开发认证头，不保存浏览器 storageState、cookie、请求头或认证响应。

运行前需要主流程启动真实 PostgreSQL、Next 和本机 Mock 模型，并为合成登录用户配置一个使用 `mock-model/openai` 的 Agent。该用户应有评测操作权限。

```powershell
$env:BASE_URL='http://127.0.0.1:实际端口'
$env:LOGIN_EMAIL='合成用户邮箱'
$env:LOGIN_PASSWORD='合成密码'
$env:AGENT_TITLE='已配置Mock的Agent标题'
node local_checks/2026-11-08_round1/ui/verify_ui.cjs
```

默认实际填写两步登录表单。`AUTH_MODE=api` 可改为真实 BetterAuth 密码登录 API，然后让同一个浏览器上下文读取会话并访问页面；结果明确标记登录方法，不能将其称为登录表单通过。

步骤：登录并检查 get-session 中确有用户 → 实际打开 /eval → 点击创建 benchmark → 创建 contains 数据集 → UI 添加三题 → UI 选择默认 TripYoYo AI，展开高级配置设 maxSteps=8、timeout=1 分钟，创建/启动 run → 等待 Completed 和 3/3 报告 → 修改数据集描述配置 → 再次 UI 创建 run，将 maxSteps 设为16，启动并查看报告。UI 测试修改数据集描述和运行参数，Agent 本身配置变更需结合主流程 HTTP 验收，不能混称为同一项。

每步输出截图和可见文本；`result.json` 记录实际通过/失败步骤、console 警告/错误、页面异常、请求失败和 HTTP 错误。步骤失败即停止，不把页面返回 HTTP200当作通过。`UI_OUTPUT` 可指定独立结果目录，避免覆盖不同尝试。

环境预检：沙箱内 Edge 启动会出现 Crashpad named-pipe 错误并立即退出；改变临时目录也无效。沙箱外 headless 预检成功，实际 Edge 版本 157.0.4341.42，渲染并读取了测试按钮。因此正式浏览器命令需要使用允许启动 Edge 的执行环境。这是本机进程限制，不能当作项目 UI 缺陷。

## 最终真实结果

`attempt7/result.json`：8 步（含 API fixture 准备）全部通过。真实 PostgreSQL、Next+Vite、本机 Mock LLM，浏览器实际填写两步登录表单；业务 tRPC 使用真实 BetterAuth session，ENABLE_MOCK_DEV_USER=0。fixture 准备完成后清掉 cookies，再重新从登录表单登录，不靠准备阶段的会话跳过登录。

- Benchmark：`evb_MphKY9r66R5m`；dataset：`ds_QbDTSz92sfg0`；UI 添加3题。
- 第一轮：`run_XMPoD5rkcjW5`，maxSteps=8，Completed，3/3 Passed。
- 第二轮：`run_3kqWVEn5ZZyp`，maxSteps=16，Completed，3/3 Passed；UI 已修改并读回数据集描述。
- 真实 UI 显示选项 TripYoYo AI，两次请求的 targetAgentId 仍为 `inbox`，修复后 HTTP200，未用真实 Agent ID 替换来绕开原缺陷。
- 每步 PNG/TXT、实际 agentEval mutation 的 postDataJSON、状态码和 UI 结果均保存在 attempt7。最后报告截图已经人工查看，显示 Completed、100%、3/3；对应可见文本记录三个 Passed case。
- 页面 JS 异常0、HTTP>=400 为0。console 有28条字体拦截导致的 net::ERR_FAILED，以及4条原 Antd 弃用警告（Image rootClassName、Modal destroyOnClose），全部保留。不能说所有外部资源加载通过。截图还包含开发模式的组件/FPS调试浮层，非生产界面验收。

本机模型是 Mock，不证明模型真实任务质量、评分语义准确率、并发容量或生产认证/外部对象存储。这里只证明已有规则评测页面在这些条件下可以实际完成操作。

## 失败尝试与修复边界

| 尝试 | 真实结果 | 判断 |
| --- | --- | --- |
| attempt1 | 首次 signin 编译超过内部代理等待，HTTP500；fixture 原用了强制 mock 用户 | 环境/冷编译诊断证据，不作真实 session 业务结论 |
| attempt2 | 两步 UI 登录请求成功；登录后/eval500，ECONNREFUSED | 缺少 Vite9876；项目开发模式需要 Next+Vite，不是只启动 Next |
| attempt3 | UI 登录和 get-session 成功；/eval200但依赖预构建导致 DOMContentLoaded120秒超时 | 首轮 Vite 加载超时，不能把200当页面通过 |
| attempt4 | 登录、benchmark 通过；Select 点击隐藏 role=option 超时 | 测试选择器命中 Antd 无障碍隐藏节点；改点可见选项，不改业务/断言 |
| attempt5 | dataset 已真实创建；导航后页面显示超过默认 expect5秒 | 测试等待不足，改为45秒；后续完整通过证明不是创建失败 |
| attempt6 | 登录、benchmark、dataset、三题通过；默认 Inbox 创建run500，真实PG外键23503 | 确认业务缺陷：`inbox`别名未解析成当前用户真实Agent ID。见 failure-evidence.json 和失败截图。由平台修复任务处理服务与回归，本目录未修改业务代码 |
| attempt7 | 全流程通过，默认Inbox请求保留，v1/v2均Completed3/3 | 修复后验收证据 |

外部字体仅在测试浏览器路由中阻止，并记录 blockedNonBusinessAssets；其他业务请求未 mock。为重跑完整 UI，可设 `BOOTSTRAP_USER=1`，脚本用指定合成凭据注册/登录准备用户、配置 Inbox 后 clearCookies，再实际执行登录。重复注册可能 HTTP422（用户已存在），随后真实登录200、会话正确才继续。不要把这个重复注册422当作产品注册功能失败。
