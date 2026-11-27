# 增量1：四个Judge配置表单的真实UI验收

最终 attempt2：6步全部通过，其中四个实际表单均填写并保存provider/model/criteria/systemRole/timeoutMs，judgePrompt始终不填，真实API读回五字段保持正确、judgePrompt缺失/为空。

条件：本机Next+Vite、独立真实PostgreSQL `agent_eval_phase2`、Headless Edge。使用合成phase2-ui用户真实BetterAuth两步密码表单登录；准备benchmark使用该用户session API，随后clearCookies再重新UI登录，不加devheader。未执行Agent/LLM，未切换Mock场景；因此这里不证明Judge模型评分质量。

| 实际UI操作 | API读回结果 | 证据 |
| --- | --- | --- |
| DatasetCreate | llm-rubric、openai/mock-judge-valid、create criteria、systemRole、timeoutMs=2000；无judgePrompt | attempt2的02步骤及filled-judge-form-2000.png |
| DatasetEdit | 相同dataset，criteria和systemRole更新，timeoutMs=3000；无judgePrompt | 03步骤及filled-judge-form-3000.png |
| TestCaseCreate | case自身显式llm-rubric，provider/model/criteria/systemRole保存，timeoutMs=4000；无judgePrompt | 04步骤及filled-judge-form-4000.png |
| TestCaseEdit | 同case criteria和systemRole更新，timeoutMs=5000；无judgePrompt | 05步骤及filled-judge-form-5000.png |

最终ID：benchmark `evb_Fy1dyXaCXMOE`，dataset `ds_ixRssURoadSl`，case `case_yZVYhKtYfmdr`。完整保存值、四次真实mutation请求体/HTTP200、每步耗时与结果在attempt2/result.json；未保存cookie/token或密码。每步PNG/TXT及提交前四张配置表单截图保留，最后编辑表单截图已实际查看。

## 本次发现并复测的缺陷

attempt1真实登录和DatasetCreate已通过；点击DatasetEdit触发React错误页，console为 `ReferenceError: Input is not defined`。该文件JSX仍有Input，但导入漏掉Input。不是测试选择器或等待问题，也未通过API写入绕过编辑。

修复文件：平台 `src/routes/(main)/eval/features/DatasetEditModal/index.tsx`，由Judge修复任务恢复导入并补回归。本任务未改业务代码。修复后同一UI操作在attempt2通过，随后四表单保存/回读全部完成。attempt1/result.json及03失败PNG/TXT保留真实前后证据。

attempt2页面异常0、HTTP>=400为0。浏览器仅按授权阻止外部字体资源，共20条相应加载错误并保留blockedFonts/console，不声称所有外部资源都通过。UI截图含开发模式组件调试浮层，非生产发布样式验收。

## 重复运行

在agent-eval-project目录执行；服务需要已启动，凭据仅使用本地合成用户：

```powershell
$env:BASE_URL='http://127.0.0.1:13010'
$env:LOGIN_EMAIL='phase2-ui@example.com'
$env:LOGIN_PASSWORD='本地合成测试密码'
$env:UI_OUTPUT='新的独立结果目录'
node local_checks/2026-11-08_phase2/increment1/ui/verify_judge_forms.cjs
```

脚本注册用户已存在时signup可能HTTP422，随后真实signin200和session验证通过才继续，不将重复注册当成功创建新用户。脚本语法检查通过。Edge需可启动浏览器的执行环境，本机在require_escalated执行；未安装新浏览器或改原架构。

这份报告只验收四表单保存与读回。模型调用、打分/报告回写、故障路径、配置快照及整个增量1是否通过须结合主流程其他证据；本任务不激活或推进增量3。
