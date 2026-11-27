# Desktop Build Environment Configuration

本文档说明桌面应用在不同环境下的配置方式。

## 环境配置文件

| 文件                | 用途                                                |
| ------------------- | --------------------------------------------------- |
| `.env.desktop.test` | 测试环境（FAT/UAT）配置，**本地开发默认使用此文件** |
| `.env.desktop.prod` | 生产环境配置                                        |

## 加载优先级

`electron.vite.config.ts` 按以下优先级加载环境变量：

| 场景                 | 条件                                   | 加载的文件                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------- |
| MCD 构建（测试）     | `MCD_BUILD=true` + `hybridEnv=FAT/UAT` | `.env`（由 build.py 从 `.env.desktop.test` 拷贝） |
| MCD 构建（生产）     | `MCD_BUILD=true` + `hybridEnv=PROD`    | `.env`（由 build.py 从 `.env.desktop.prod` 拷贝） |
| 本地开发             | 默认                                   | `.env.desktop.test`                               |
| 本地开发（fallback） | `.env.desktop.test` 不存在             | `.env.desktop.prod`                               |

## MCD 构建流程

```
MCD 触发构建
    ↓
传入参数: --hybridEnv=FAT
    ↓
build.py 解析参数
    ↓
setup_env_file() 拷贝 .env.desktop.test → .env
    ↓
设置 MCD_BUILD=true 环境变量
    ↓
electron-vite 检测到 MCD_BUILD=true，加载 .env
    ↓
define 注入 process.env.UPDATE_CHANNEL / OFFICIAL_CLOUD_SERVER 等
    ↓
应用代码通过 env.ts 读取环境变量
```

## 本地开发

```bash
# 直接运行，默认加载 .env.desktop.test
bun run dev:desktop

# 如果想使用生产配置，可以临时重命名文件
mv .env.desktop.test .env.desktop.test.bak
mv .env.desktop.prod .env.desktop.test
bun run dev:desktop
```

## 关键环境变量

| 变量名                  | 说明                     | 示例值                                                 |
| ----------------------- | ------------------------ | ------------------------------------------------------ |
| `UPDATE_CHANNEL`        | 更新通道                 | `stable` / `nightly`                                   |
| `OFFICIAL_CLOUD_SERVER` | 官方云服务器地址         | `https://calcifer.train.ctripcorp.com`                 |
| `UPDATE_SERVER_URL`     | 自托管更新服务器地址     | `https://releases.tripyoyo.train.ctripcorp.com/stable` |
| `FEATURE_FLAGS`         | 功能开关                 | `-check_updates`                                       |
| `MCP_TOOL_TIMEOUT`      | MCP 工具调用超时（毫秒） | `60000`                                                |
| `DEBUG_VERBOSE`         | 调试日志开关             | `0` / `1`                                              |

## Channel 推断规则

在 `build.py` 的 `resolve_channel` 函数中：

1. 优先使用环境变量 `MCD_CHANNEL`（如设置）
2. 根据 `hybridEnv` 推断：
   - `FAT` / `UAT` / `TEST` → `nightly`
   - 其他 → `stable`

## 添加新环境

如需添加新环境（如 `PRE` 预发布环境）：

1. 创建配置文件 `.env.desktop.pre`
2. 在 `build.py` 的 `setup_env_file` 函数中添加映射：
   ```python
   env_mapping = {
       "FAT": "test",
       "UAT": "test",
       "TEST": "test",
       "PRE": "pre",  # 新增
       "PROD": "prod",
       "PRODUCTION": "prod",
   }
   ```
