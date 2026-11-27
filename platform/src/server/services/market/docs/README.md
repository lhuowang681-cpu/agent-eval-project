# Market / OpenSandbox 文档

| 文档 | 说明 |
|------|------|
| [large-file-sandbox.md](./large-file-sandbox.md) | 聊天大文件沙箱处理（上传、上下文、预注入） |
| [open-sandbox-run-build-in-tool-plan.md](./open-sandbox-run-build-in-tool-plan.md) | OpenSandbox 覆写 `runBuildInTool` 的实施计划（工具全覆盖、统一注入、入口清单） |

相关代码：

- `sandboxToolClient.ts` — OpenSandbox SDK 封装
- `preInjectSandboxFiles.ts` — 发送消息时预注入
- `index.ts` — `MarketService` 内 `runBuildInTool` 覆写
