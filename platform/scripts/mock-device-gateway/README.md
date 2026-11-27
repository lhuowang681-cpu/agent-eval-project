# Mock Device Gateway (本地开发用)

替身实现，用来在**单机**上把 "定时任务 / Agent 走本机设备执行" 这条链路端到端跑通，
**不依赖** lobehub 官方闭源的 `device-gateway.tripyoyo.train.ctripcorp.com`，也不用先部署开源的
`device-gateway-go`。协议与 `@lobechat/device-gateway-client` 完全一致，之后换成正式
gateway 时应用侧零改动。

它内置一个 "设备 worker"，连上自己的 WS 后**在本机真实执行命令**（`runCommand` →
`child_process`），所以启动即拥有一台在线设备 —— 不需要桌面端 App、不需要 `lh connect`。

> ⚠️ 仅限本地开发。鉴权是宽松的（任意非空 token 通过）。生产请部署 `device-gateway-go`。

## 启动

```bash
# USER_ID 用你登录后的真实用户 id（日志里的 user_xxx，或 DB users.id）
node scripts/mock-device-gateway/server.mjs --user <USER_ID>

# 可选参数：--port 9001  --token devtoken  --no-worker（只起 gateway，不起本机设备）
```

启动后会打印需要配给应用服务端的两个环境变量。

## 让应用连上它

在跑应用服务端的 `.env`（本地 `bun run dev` 用 3010 那个进程）里加：

```bash
DEVICE_GATEWAY_URL=http://localhost:9001
DEVICE_GATEWAY_SERVICE_TOKEN=devtoken
```

重启服务端。之后：

- `deviceProxy.isConfigured` → true（日志里 `deviceGateway=true`）
- 前端运行环境选择器「指定设备」→ 设备列表能看到这台机器
- 把 agent 的 `executionTarget` 设成 `device` + 选中本机 → 定时任务 / 对话的
  `runCommand`（含 lark-cli）会真实跑在你本机

## 自检（不依赖应用）

```bash
# 1) 起 gateway（另开一个终端）
node scripts/mock-device-gateway/server.mjs --user user_smoketest

# 2) 模拟服务端调用
curl -s -X POST http://localhost:9001/api/device/devices \
  -H "Authorization: Bearer devtoken" -H "Content-Type: application/json" \
  -d '{"userId":"user_smoketest"}'

curl -s -X POST http://localhost:9001/api/device/tool-call \
  -H "Authorization: Bearer devtoken" -H "Content-Type: application/json" \
  -d '{"userId":"user_smoketest","toolCall":{"apiName":"runCommand","identifier":"lobe-local-system","arguments":"{\"command\":\"lark-cli --help\"}"}}'
```

## 实现了哪些协议

- HTTP（server → gateway，Bearer serviceToken）：`/api/device/status`、`/devices`、
  `/system-info`、`/tool-call`、`/rpc`、`/message-api`
- WebSocket（device → gateway，`/ws`）：auth /heartbeat/tool_call/system_info/
  rpc /message_api 的请求 - 响应（按 requestId 关联）

## 不做什么

- `agent_run_request`（hetero CLI 的 `lh hetero exec` 派发）未实现 —— 只覆盖 tool-call
  路径（`runCommand`，也就是 lark-cli 这类技能走的路）。
- 不持久化、不做真实鉴权、不做多 gateway 实例。
