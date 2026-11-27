# MCD 构建接入

公司内部 **MCD** 客户端构建平台通过仓库根目录的 [`build.py`](../build.py) 驱动本项目出包。

## 约定

MCD 构建机 clone 仓库后，在仓库根执行:

```bash
python build.py -o < outputDir > -vn < versionName > -vc < versionCode > -bi < build_id > [...]
```

`build.py` 负责编排，底层仍走 `apps/desktop` 的 electron-vite + electron-builder:

1. 切换 Node 版本 (构建机默认 Node 16,pnpm 需 ≥ 18.12; 经 nvm `nvm use 24` 切到 v24.14.0)
2. 解析 MCD 参数 (`-o/--outputDir` 必填，其余可选)
3. 自举 pnpm (构建机无 pnpm 时，`npm install -fg @ctrip/corepack` + `corepack enable`,
   按根 `package.json` 的 `packageManager` 锁定版本)→ `pnpm install --prod=false`
   (`--prod=false` 强制装 devDependencies, 避免构建机 `NODE_ENV=production` 跳过
   electron-vite/electron-builder; 用默认 isolated linker,apps/desktop 才有自己的
   node_modules/.bin 供 `pnpm --dir` 解析，不能用 --node-linker=hoisted;
   含 `postinstall` 的 `electron-builder install-app-deps`)
   → `pnpm --dir apps/desktop install --prod=false`(apps/desktop 是独立子 workspace,
   自带 pnpm-workspace.yaml/.npmrc, 根 install 不覆盖它，需单独装 electron 工具链)
4. `npm run workflow:set-desktop-version <version> <channel>` 设版本 / 图标
5. 按构建机操作系统未签名打包，全程用 pnpm 驱动 (`pnpm --dir apps/desktop run ...`,
   脚本内用 `pnpm run` / `pnpm exec`;npm 在 pnpm 工作区里解析不到 electron-vite 等 bin):
   macOS → `package:mac:mcd`,Windows → `package:win:mcd`
6. 把 `apps/desktop/release/` 下的 macOS 安装包、或 Windows Squirrel 目录
   (`release/squirrel-windows/`) 打成 `product.app.zip` 拷到 `outputDir`
7. 产物存在则退出码 0, 否则非 0

> macOS 包必须在 macOS 构建机、Windows 包必须在 Windows 构建机上出 (electron-builder 跨端打包受限)。

## 构建机环境

- **Python**:MCD 构建机运行 **Python 2**,`build.py` 已按 py2/py3 双兼容编写
  (`from __future__ import print_function`、避免 f-string、自实现 `which()` 替代 py3-only 的 `shutil.which`)。改动时务必保持 py2 兼容。
- **Node**: 构建机默认 Node 16, 而 pnpm\@10.33.4 需 Node ≥ 18.12;`build.py` 经 nvm `nvm use 24`
  切到 **v24.14.0**(source `~/.nvm/nvm.sh` 后解析其 bin 目录前置到 PATH, 可用 `MCD_NODE_VERSION` 覆盖)。
  同时把 `npm_config_nodedir` 指向 nvm 的 Node 目录，让 node-gyp 编译原生模块时用本地头文件
  (构建机 node 镜像缺新版本 headers 会 403)。
- **Node/pnpm**: 构建机默认只有 node/npm, 没有 pnpm;`build.py` 会用 `@ctrip/corepack` 自举 (见上)。构建用户 (cbuilder) 无 root 权限，
  不能 `npm install -g` 到 `/usr/local`, 故自举时装到仓库内可写前缀 `.mcd-tools` 并加入 PATH。
- **操作系统**:macOS 包须在 macOS 节点、Windows 包须在 Windows 节点上分别构建。

## 参数

| 参数                          | 说明                                                         |
| ----------------------------- | ------------------------------------------------------------ |
| `-o/--outputDir`              | **必填**,MCD 产物输出目录                                    |
| `-vn/--versionName`           | 版本号 (如 `1.0.0`); 缺省读 `apps/desktop/package.json` 现值 |
| `-vc/--versionCode`           | 版本码，仅记录到 `build.config`                              |
| `-bi/--build_id`              | MCD 构建 ID                                                  |
| `-ne/-he/-hu/-id/--extension` | Native/Hybrid 环境等，本项目仅记录，不消费 (无 hybrid 机制)  |

## 环境变量

| 变量               | 作用                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `MCD_CHANNEL`      | 覆盖渠道:`stable`(默认)/`beta`/`nightly`/`canary`; 未设时按 `hybridEnv`(FAT/UAT→nightly, 其余→stable) 推断 |
| `MCD_HTTP_PROXY`   | 内网构建机走公司代理 (如 `http://proxygate2.ctripcorp.com:8080`), 用于 beforePack 的外网下载               |
| `MCD_NODE_VERSION` | 经 nvm 切换的 Node 版本，默认 `24`(v24.14.0)                                                               |

## 本地复现

```bash
cd <repo-root>
python build.py -o ./mcd-out -vn 1.0.0 -vc 100.000 -bi local-test
# 完成后 ./mcd-out/ 下应出现 macOS 的 *.dmg / product.app.zip，
# 或 Windows 的 product.app.zip(内含 Setup.exe / RELEASES / *.nupkg)
```

## 签名 (当前未接)

当前为**未签名**出包 (mac 关闭 notarize/identity;win 不配置证书)。后续接签名时，改用
`apps/desktop` 的 `package:mac` / `package:win` 并注入证书环境变量 (macOS:`CSC_LINK`/`CSC_KEY_PASSWORD`)。
