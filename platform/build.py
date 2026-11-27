#!/usr/bin/env python
# -*- coding: utf-8 -*-
#
# MCD 构建入口
# ------------
# 公司内部 MCD 客户端构建平台在构建机上 clone 本仓库后,会在仓库根目录执行:
#
#   python build.py -o <outputDir> -vn <versionName> -vc <versionCode> -bi <build_id> ...
#
# 本脚本只负责"编排":解析 MCD 参数 -> 装依赖 -> 设版本/渠道 -> 调用现有
# electron-builder 链路出包 -> 把产物收集到 MCD 指定的 outputDir,
# 并以退出码表示成败。底层打包仍走 apps/desktop 的 electron-vite + electron-builder。
#
# 说明:
#   - 目标平台:macOS + Windows(由构建机自身操作系统决定;Linux 不在范围)。
#   - 签名:macOS 使用 MCD 构建机 Keychain 中的 Developer ID 证书(携程共享构建池)。
#     identity 硬编码在 electron-builder.mjs 的 mac.identity 字段,不做 Apple 公证。
#     Windows 暂不签名(后续如需签名,配置证书环境变量即可)。
#   - Windows 产物使用 Squirrel.Windows(Setup.exe / RELEASES / .nupkg),用于 MCD
#     getCommonAppUpdateInfo 灰度返回的 downloadUrl feed。
#   - 本项目 renderer 自带,不需要参考项目里的 hybrid 在线资源包机制。
#
# 本地复现(在 Mac 上模拟 MCD 调用):
#   python build.py -o ./mcd-out -vn 1.0.0 -vc 100.000 -bi local-test

from __future__ import print_function

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
import zipfile

# 仓库根目录(build.py 所在目录)
ROOT = os.path.abspath(os.path.dirname(__file__))

# electron-builder 产物目录
RELEASE_DIR = os.path.join(ROOT, "apps", "desktop", "release")

# 需要收集到 outputDir 的产物后缀(Linux 等非 Windows 平台)
ARTIFACT_EXTS = (".dmg", ".zip", ".exe", ".yml", ".yaml", ".blockmap", ".nupkg")

# electron-builder Squirrel.Windows 产物目录(相对 release/)
SQUIRREL_WINDOWS_SUBDIRS = ("squirrel-windows", "squirrel.windows")

# 渠道:stable / beta / nightly / canary(见 scripts/electronWorkflow/setDesktopVersion.ts)
VALID_CHANNELS = ("stable", "beta", "nightly", "canary")


def log(msg):
    print("[build.py] %s" % msg)
    sys.stdout.flush()


def which(cmd):
    """可移植的命令查找(shutil.which 是 Python 3.3+;MCD 构建机可能是 Python 2)。

    在 PATH 中查找可执行文件;Windows 下兼顾 PATHEXT(.cmd/.exe 等 shim)。
    """
    exts = [""]
    if platform.system() == "Windows":
        exts += os.environ.get("PATHEXT", ".EXE;.CMD;.BAT").split(os.pathsep)
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        base = os.path.join(directory, cmd)
        for ext in exts:
            candidate = base + ext
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate
    return None


def read_args():
    parser = argparse.ArgumentParser(description="MCD build entry for LobeHub desktop")
    parser.add_argument("-vn", "--versionName", help="Version Name(e.g. 1.0.0)", required=False)
    parser.add_argument("-vc", "--versionCode", help="Version Code(e.g. 100.000)", required=False)
    parser.add_argument("-o", "--outputDir", help="MCD 产物输出目录", required=True)
    parser.add_argument("-bi", "--build_id", help="Build Id", required=False)
    parser.add_argument("-n", "--name", help="app 名称", required=False)
    parser.add_argument("-ne", "--nativeEnv", help="Native 环境", required=False)
    parser.add_argument("-he", "--hybridEnv", help="Hybrid 环境(FAT/UAT/PROD)", required=False)
    parser.add_argument("-hu", "--hybridUrl", help="Hybrid 全量包地址(本项目不使用)", required=False)
    parser.add_argument("-id", "--app_id", help="MCD app_id", required=False)
    parser.add_argument("--extension", help="构建扩展参数", required=False)
    # 仅解析已知参数,避免 MCD 传入额外参数时报错
    args, unknown = parser.parse_known_args()
    if unknown:
        log("ignore unknown args: %s" % unknown)
    return args


def run(cmd, cwd=None, env=None):
    """执行命令并把输出直接透传到当前 stdout/stderr,返回退出码。"""
    log("run: %s" % cmd)
    status = subprocess.call(cmd, shell=True, cwd=cwd or ROOT, env=env)
    log("run: %s -> exit %d" % (cmd, status))
    return status


def resolve_version(args):
    """确定版本号:优先用 MCD 传入的 versionName,否则读 apps/desktop/package.json 现值。"""
    if args.versionName:
        return args.versionName
    try:
        import json
        pkg_path = os.path.join(ROOT, "apps", "desktop", "package.json")
        with open(pkg_path, "r") as f:
            return json.load(f).get("version") or "0.0.0"
    except Exception as ex:  # noqa
        log("read desktop package.json version failed: %s" % ex)
        return "0.0.0"


def resolve_channel(args):
    """确定发布渠道。

    默认 stable;可通过环境变量 MCD_CHANNEL 覆盖,或按 hybridEnv 映射
    (非生产环境视为 nightly,生产视为 stable)。
    """
    env_channel = os.environ.get("MCD_CHANNEL", "").strip().lower()
    if env_channel in VALID_CHANNELS:
        return env_channel
    he = (args.hybridEnv or "").strip().upper()
    if he in ("FAT", "UAT"):
        return "nightly"
    return "stable"


def _prepend_path(directory):
    os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")


def ensure_node():
    """切换到要求的 Node 版本(MCD 构建机默认 Node 16,pnpm 需要 >= 18.12)。

    构建机通过 nvm 管理多版本 Node;nvm 是 shell 函数,需先 source nvm.sh。
    这里在 bash 子进程里 source nvm 并 `nvm use <ver>`,解析出该版本的 bin 目录,
    前置到当前进程 PATH —— 后续所有 npm/corepack/pnpm 调用即走该版本。

    目标版本默认 24(对应 v24.14.0),可用环境变量 MCD_NODE_VERSION 覆盖。
    """
    version = os.environ.get("MCD_NODE_VERSION", "24")
    nvm_dir = os.environ.get("NVM_DIR") or os.path.join(os.path.expanduser("~"), ".nvm")
    nvm_sh = os.path.join(nvm_dir, "nvm.sh")
    if not os.path.isfile(nvm_sh):
        log("nvm.sh not found at %s, skip node switch (current: see below)" % nvm_sh)
        run("node -v")
        return
    # source nvm -> 切版本(未装则尝试安装)-> 打印该版本 node 所在 bin 目录
    script = (
        '. "%s" >/dev/null 2>&1; '
        'nvm use %s >/dev/null 2>&1 || nvm install %s >/dev/null 2>&1; '
        'dirname "$(nvm which %s 2>/dev/null || command -v node)"'
    ) % (nvm_sh, version, version, version)
    try:
        out = subprocess.check_output(["bash", "-c", script])
        if isinstance(out, bytes):
            out = out.decode("utf-8")
        bindir = out.strip()
    except Exception as ex:  # noqa
        log("resolve node %s via nvm failed: %s" % (version, ex))
        bindir = ""
    if bindir and os.path.isdir(bindir):
        _prepend_path(bindir)
        os.environ["NVM_DIR"] = nvm_dir
        log("switched node to %s (bin: %s)" % (version, bindir))
        # node-gyp 编译原生模块(node-mac-permissions 等)需要 Node 头文件,
        # 默认从 node 镜像下载;构建机 ctrip 镜像没有新版本 headers(403)。
        # nvm 安装的 Node 自带头文件,指向它即可让 node-gyp 用本地头、彻底不联网。
        node_root = os.path.dirname(bindir)
        if os.path.isdir(os.path.join(node_root, "include", "node")):
            os.environ["npm_config_nodedir"] = node_root
            log("set npm_config_nodedir=%s (node-gyp uses local headers)" % node_root)
        else:
            log("no local node headers under %s, node-gyp may need to download" % node_root)
    else:
        log("could not resolve node %s bin dir, fallback to default node" % version)
    run("node -v")


def _pinned_pnpm_version():
    """读取根 package.json 的 packageManager 锁定版本,如 "pnpm@10.33.4" -> "10.33.4"。"""
    try:
        import json
        with open(os.path.join(ROOT, "package.json"), "r") as f:
            pm = json.load(f).get("packageManager", "")
        if pm.startswith("pnpm@"):
            return pm.split("@", 1)[1]
    except Exception as ex:  # noqa
        log("read pinned pnpm version failed: %s" % ex)
    return None


def ensure_pnpm():
    """确保构建机上有版本匹配的 pnpm。

    本项目用 pnpm workspace(根 package.json 的 packageManager 已锁定版本),
    但 MCD 构建机默认只有 node/npm、没有 pnpm(或残留着版本不明的全局 pnpm)。
    此时用公司内部的 @ctrip/corepack 自举到锁定版本。返回可用于执行的 pnpm
    命令(字符串)。

    apps/desktop 是嵌套的独立 pnpm workspace,不同 pnpm 版本对"是否在
    apps/desktop 自己的 pnpm-workspace.yaml 处截断向上查找"处理不一致——
    版本不对的 pnpm 可能把根 workspace 的 overrides 也并入 apps/desktop 的
    有效配置,导致 frozen-lockfile 校验报 ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
    (而锁定版本的 pnpm 不会复现)。因此 PATH 上已有 pnpm 时也要校验版本,
    不匹配就重新走 corepack 拉取锁定版本,不能捡到什么用什么。

    注意:MCD 构建机用户(cbuilder)无 root 权限,不能 `npm install -g` 到
    /usr/local(EACCES)。因此装到仓库内可写前缀 .mcd-tools 并加入 PATH,
    再用 `corepack pnpm` 驱动(corepack 会按 packageManager 字段自动拉取锁定版本)。
    """
    pinned = _pinned_pnpm_version()
    existing = which("pnpm")
    if existing:
        version = None
        if pinned:
            try:
                out = subprocess.check_output([existing, "--version"])
                version = out.decode("utf-8").strip() if isinstance(out, bytes) else out.strip()
            except Exception as ex:  # noqa
                log("check existing pnpm version failed: %s" % ex)
        if not pinned or version == pinned:
            return "pnpm"
        log("PATH pnpm version mismatch (found %s, pinned %s), re-bootstrap via @ctrip/corepack" % (version, pinned))
    else:
        log("pnpm not found, bootstrapping via @ctrip/corepack (user-writable prefix) ...")
    prefix = os.path.join(ROOT, ".mcd-tools")
    # npm -g --prefix:POSIX 下二进制在 <prefix>/bin,Windows 下直接在 <prefix>
    if run("npm install -fg @ctrip/corepack --prefix %s" % prefix) != 0:
        raise RuntimeError("install @ctrip/corepack failed")
    _prepend_path(os.path.join(prefix, "bin"))
    _prepend_path(prefix)

    # 优先尝试 enable 出真正的 pnpm 命令(install-directory 指向可写目录)
    install_dir = prefix if platform.system() == "Windows" else os.path.join(prefix, "bin")
    if which("corepack"):
        run("corepack enable --install-directory %s" % install_dir)
    if which("pnpm"):
        return "pnpm"
    # 兜底:不依赖 shim,直接用 corepack 驱动 pnpm
    if which("corepack"):
        log("pnpm shim not on PATH, fallback to `corepack pnpm`")
        return "corepack pnpm"
    raise RuntimeError("pnpm unavailable even after @ctrip/corepack bootstrap")


def maybe_setup_proxy():
    """在 MCD 内网构建机上,beforePack 会从外网拉二进制/npm 包,可能需要走公司代理。

    默认不动网络设置(本地 Mac 直连即可)。在 MCD 机器上,通过设置环境变量
    MCD_HTTP_PROXY=http://proxygate2.ctripcorp.com:8080 启用代理。
    """
    proxy = os.environ.get("MCD_HTTP_PROXY", "").strip()
    if proxy:
        log("enable proxy: %s" % proxy)
        os.environ["http_proxy"] = proxy
        os.environ["https_proxy"] = proxy
        os.environ["HTTP_PROXY"] = proxy
        os.environ["HTTPS_PROXY"] = proxy


def write_build_config(args, version, channel):
    """写构建信息到两处:
    1. 仓库根 build.config —— 便于排查(不会被打进 app)。
    2. apps/desktop/resources/build-info.json —— 会被 electron-builder 打进 asar,
       供 main 进程运行时读取(自动更新接口需要 buildId/versionCode/hybridEnv 等)。
    """
    try:
        import json
        cfg = {
            "versionName": version,
            "versionCode": args.versionCode,
            "build_id": args.build_id,
            "app_id": args.app_id,
            "nativeEnv": args.nativeEnv,
            "hybridEnv": args.hybridEnv,
            "channel": channel,
            "buildTime": int(time.time() * 1000),
        }
        with open(os.path.join(ROOT, "build.config"), "w") as f:
            json.dump(cfg, f, indent=2)
        log("write build.config: %s" % cfg)

        # 写入 app 内可打包位置(resources 会随 asar 一起打包,见 electron-builder.mjs files)
        build_info_path = os.path.join(ROOT, "apps", "desktop", "resources", "build-info.json")
        with open(build_info_path, "w") as f:
            json.dump(cfg, f, indent=2)
        log("write build-info.json: %s" % build_info_path)
    except Exception as ex:  # noqa
        log("write build.config failed (ignored): %s" % ex)


def setup_env_file(args):
    """根据 hybridEnv 参数选择对应的环境配置文件并拷贝为 .env。

    环境配置文件命名规则:
    - .env.desktop.test  -> 测试环境 (FAT/UAT)
    - .env.desktop.prod  -> 生产环境

    如果对应的配置文件不存在,则尝试使用 .env.desktop (本地开发配置) 或跳过。
    """
    he = (args.hybridEnv or "").strip().upper()

    # hybridEnv 到配置文件后缀的映射
    # FAT 和 UAT 都使用 test 配置
    env_mapping = {
        "FAT": "test",
        "UAT": "test",
        "TEST": "test",
        "PROD": "prod",
        "PRODUCTION": "prod",
    }

    env_suffix = env_mapping.get(he, "")
    if env_suffix:
        source_env = os.path.join(ROOT, ".env.desktop.%s" % env_suffix)
    else:
        source_env = os.path.join(ROOT, ".env.desktop")

    target_env = os.path.join(ROOT, ".env")

    if os.path.isfile(source_env):
        log("setup env file: %s -> %s (hybridEnv=%s)" % (source_env, target_env, he or "default"))
        shutil.copy2(source_env, target_env)
        return True
    else:
        log("env file not found: %s (hybridEnv=%s), skip env setup" % (source_env, he))
        return False


def package_for_platform(channel, pnpm):
    """根据构建机操作系统调用对应的未签名打包脚本。

    必须用 pnpm 运行(`pnpm --dir apps/desktop run ...`),不能用 `npm run`:
    在 pnpm 工作区里,electron-vite/electron-builder 这些 bin 的布局只有 pnpm
    自己清楚,npm 解析不到会 spawn ENOENT。脚本内层也已改用 pnpm run / pnpm exec。
    """
    system = platform.system()
    # electron-builder.mjs / electron.vite.config.ts 通过 UPDATE_CHANNEL 决定渠道与产物命名
    env = dict(os.environ)
    env["UPDATE_CHANNEL"] = channel
    env["MCD_BUILD"] = "true"  # Tell electron.vite.config.ts to use .env file

    if system == "Darwin":
        env["PATH"] = env.get("PATH", "") + ":/usr/local/bin"
        return run("%s --dir apps/desktop run package:mac:mcd" % pnpm, env=env)
    if system == "Windows":
        return run("%s --dir apps/desktop run package:win:mcd" % pnpm, env=env)
    raise RuntimeError("Unsupported build platform for MCD: %s" % system)


def _find_mac_app(release_dir):
    """在 electron-builder 的 release 输出里找到 `.app` 目录(不是它打好的 zip)。

    electron-builder 把已签名的 mac 应用放在 `release/mac-arm64/`(arm64)或
    `release/mac/`(x64)下,名字形如 `TripYoYo.app`。这里遍历 release 下以 "mac"
    开头的子目录,返回第一个 `.app` 的绝对路径。

    注意:不要用 electron-builder 自带的 `*-mac.zip`。那是给 electron-updater 用的,
    交给 MCD 再套一层归档时,`.app` 里 Electron Framework 的符号链接可能被破坏,
    导致解出来的 `.app` 缺文件、签名失效。我们照 iDesk 的做法,自己用 `zip -y` 压
    `.app`(见 collect_artifacts 的 Darwin 分支)。
    """
    if not os.path.isdir(release_dir):
        return None
    for name in os.listdir(release_dir):
        if not name.lower().startswith("mac"):
            continue
        sub = os.path.join(release_dir, name)
        if not os.path.isdir(sub):
            continue
        for entry in os.listdir(sub):
            if entry.endswith(".app"):
                return os.path.join(sub, entry)
    return None


def _find_squirrel_windows_dir(release_dir):
    """定位 Squirrel.Windows 产物目录。

    electron-builder 把 Setup.exe / RELEASES / .nupkg 放在 release/squirrel-windows/,
    而不是 release/ 根目录。找不到固定子目录时,回退为在 release 下搜索含 RELEASES 的目录。
    """
    for subdir in SQUIRREL_WINDOWS_SUBDIRS:
        candidate = os.path.join(release_dir, subdir)
        if os.path.isdir(candidate):
            return candidate
    if not os.path.isdir(release_dir):
        return None
    for root, dirs, files in os.walk(release_dir):
        if "RELEASES" in files:
            return root
    return None


def _zip_directory_flat(src_dir, dst_zip):
    """把目录内所有文件压成 zip(保留相对路径,支持子目录)。"""
    with zipfile.ZipFile(dst_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(src_dir):
            for name in files:
                full_path = os.path.join(root, name)
                arcname = os.path.relpath(full_path, src_dir)
                log("zip file: %s" % arcname)
                zf.write(full_path, arcname)


def _collect_windows_artifacts(output_dir):
    """Windows:按 iDesk 约定,把 Squirrel.Windows 目录打成 product.app.zip。

    iDesk build.py 将 win32/ 下 Setup.exe、RELEASES、.nupkg 整体 zip 为 product.app.zip
    交给 MCD;calcifer 对应目录为 release/squirrel-windows/。
    """
    squirrel_dir = _find_squirrel_windows_dir(RELEASE_DIR)
    if not squirrel_dir:
        log("squirrel-windows dir not found under %s" % RELEASE_DIR)
        return 0

    staged_zip = os.path.join(RELEASE_DIR, "product.app.zip")
    if os.path.exists(staged_zip):
        os.remove(staged_zip)

    log("zip squirrel-windows (like iDesk): %s -> %s" % (squirrel_dir, staged_zip))
    _zip_directory_flat(squirrel_dir, staged_zip)

    dst = os.path.join(output_dir, "product.app.zip")
    log("copy windows artifact: %s -> %s" % (staged_zip, dst))
    shutil.copy2(staged_zip, dst)
    return 1


def collect_artifacts(output_dir):
    """把 electron-builder 产物拷贝到 MCD 指定的 outputDir,返回拷贝的文件数。

    macOS:按 MCD 端约定,输出**一个固定命名** `product.app.zip`,结构必须与 iDesk 一致
    ——**双层嵌套**(对照 iDesk build.py 的 zip() 与其成功流水线):

        product.app.zip                外层(MCD 还会再套一层 CCHAT_MAC_ARM_<id>.zip)
        └── <mac-arm64>/
            └── product.app.zip        内层:zip -y 压的 .app,符号链接保留在这一层

    两步:
        cd <输出目录>;        zip -m -r -y product.app.zip <App>.app                    # ① 压 .app,-m 删原 .app
        cd <输出目录父目录>;  zip -r -y product.app.zip <输出目录/product.app.zip>        # ② 只压内层 zip
    只压单个 `.app`(扁平结构)MCD 端会判定"缺文件"。`-y`(--symlinks)保证 `.app` 里
    Electron Framework 的符号链接(`Versions/Current -> A` 等)按符号链接保存,不被解引用。
    step ② 只打内层 zip 而不打整个目录,是因为 electron-builder 的 mac-arm64/ 可能残留
    .app 同名裸二进制/.DS_Store 等,只打目标文件避免带进外层产物。iDesk 可以打整个目录
    是因为 @electron/packager 产出本身是干净的。
    额外交付 `.dmg`(从 release/ 拷贝):用户通过 `.dmg` 安装会把 `.app` 拖入
    /Applications,避免 AppTranslocation(只读卷)导致 Squirrel.Mac 无法更新。
    `.dmg` 用于首次安装;`product.app.zip` 用于 Squirrel.Mac 自动更新。

    Windows:将 release/squirrel-windows/ 打成 product.app.zip(与 iDesk win32 zip 一致),
    内含 Setup.exe / RELEASES / .nupkg,供 MCD 灰度更新中心按 Squirrel feed 分发。
    Linux:保留原逻辑,按后缀白名单全量拷贝。
    """
    if not os.path.isdir(RELEASE_DIR):
        log("release dir not found: %s" % RELEASE_DIR)
        return 0
    if not os.path.isdir(output_dir):
        os.makedirs(output_dir)

    if platform.system() == "Darwin":
        app_path = _find_mac_app(RELEASE_DIR)
        if not app_path:
            log("mac .app not found under %s" % RELEASE_DIR)
            return 0
        app_dir = os.path.dirname(app_path)          # 例:release/mac-arm64(打包输出目录)
        app_name = os.path.basename(app_path)        # 例:TripYoYo.app
        out_root = os.path.dirname(app_dir)          # 例:release(输出目录的父目录)
        out_dir_name = os.path.basename(app_dir)     # 例:mac-arm64

        # 删掉可能残留的旧产物,否则 zip 会往里追加
        for stale in (
            os.path.join(app_dir, "product.app.zip"),
            os.path.join(out_root, "product.app.zip"),
        ):
            if os.path.exists(stale):
                os.remove(stale)

        # ① 在打包输出目录内:把 .app 压成内层 product.app.zip,-m 压完删原 .app,-y 保留符号链接
        if run('zip -m -r -q -y product.app.zip "%s"' % app_name, cwd=app_dir) != 0:
            log("zip .app -> inner product.app.zip failed")
            return 0
        # ② 在父目录内:只把内层 product.app.zip 压进外层,不打包整个目录。
        #    iDesk 打整个目录是因为 electron-packager 产出本身干净;electron-builder
        #    的 mac-arm64/ 可能残留 .app 同名裸二进制/.DS_Store 等,只打目标文件更可控。
        if run('zip -r -q -y product.app.zip "%s/product.app.zip"' % out_dir_name, cwd=out_root) != 0:
            log("zip inner product.app.zip -> outer product.app.zip failed")
            return 0

        staged_zip = os.path.join(out_root, "product.app.zip")
        dst = os.path.join(output_dir, "product.app.zip")
        log("copy mac artifact (nested like iDesk): %s -> %s" % (staged_zip, dst))
        shutil.copy2(staged_zip, dst)

        # 额外交付 .dmg:用户从 .dmg 安装会把 .app 拖入 /Applications,
        # 避免 AppTranslocation(只读卷)导致 Squirrel.Mac 无法更新。
        # product.app.zip 仅用于 Squirrel.Mac 自动更新;.dmg 用于首次安装。
        for name in os.listdir(RELEASE_DIR):
            if name.lower().endswith('.dmg') and not name.endswith('.blockmap'):
                src = os.path.join(RELEASE_DIR, name)
                if os.path.isfile(src):
                    dst = os.path.join(output_dir, name)
                    log("copy dmg for user install: %s -> %s" % (src, dst))
                    shutil.copy2(src, dst)
        return 1

    if platform.system() == "Windows":
        return _collect_windows_artifacts(output_dir)

    count = 0
    for name in os.listdir(RELEASE_DIR):
        if not name.lower().endswith(ARTIFACT_EXTS):
            continue
        src = os.path.join(RELEASE_DIR, name)
        if not os.path.isfile(src):
            continue
        dst = os.path.join(output_dir, name)
        log("copy artifact: %s -> %s" % (src, dst))
        shutil.copy2(src, dst)
        count += 1
    return count


def main():
    args = read_args()
    output_dir = os.path.abspath(args.outputDir)
    os.chdir(ROOT)

    version = resolve_version(args)
    channel = resolve_channel(args)
    log("MCD build start: version=%s channel=%s outputDir=%s platform=%s"
        % (version, channel, output_dir, platform.system()))

    maybe_setup_proxy()
    write_build_config(args, version, channel)
    setup_env_file(args)

    # 0. 切到要求的 Node 版本(构建机默认 Node 16,pnpm 需要 >= 18.12)
    ensure_node()

    # 1. 装依赖(本项目用 pnpm workspace;postinstall 会跑 electron-builder install-app-deps)
    #    --prod=false:强制安装 devDependencies。MCD 构建机可能带 NODE_ENV=production,
    #    否则会跳过 electron-vite / electron-builder 等(打包必需)。
    #    用默认 isolated linker:apps/desktop 才会有自己的 node_modules/.bin
    #    (cross-env/electron-vite/electron-builder),供后续 `pnpm --dir apps/desktop run` 解析。
    #    不能用 --node-linker=hoisted:它会把依赖拍平到仓库根、apps/desktop 下无 node_modules,
    #    导致脚本里 cross-env command not found。
    pnpm = ensure_pnpm()
    if run("%s install --prod=false" % pnpm) != 0:
        log("pnpm install failed")
        return 1

    # 1b. 安装 apps/desktop 自己的依赖(electron 工具链)。
    #     apps/desktop 是独立子 workspace(自带 pnpm-workspace.yaml / .npmrc:
    #     shamefully-hoist + electron 镜像),根 workspace 不含 apps/desktop 本身,
    #     根 install 不会给它装 node_modules,必须在该目录单独安装,否则后续
    #     cross-env / electron-vite / electron-builder 都找不到。
    if run("%s --dir apps/desktop install --prod=false" % pnpm) != 0:
        log("pnpm install (apps/desktop) failed")
        return 1

    # 2. 设版本号 / 渠道(更新 apps/desktop/package.json 与图标)
    if run("npm run workflow:set-desktop-version %s %s" % (version, channel)) != 0:
        log("set desktop version failed")
        return 1

    # 3. 按平台未签名打包
    if package_for_platform(channel, pnpm) != 0:
        log("electron-builder packaging failed")
        return 1

    # 4. 收集产物到 outputDir
    n = collect_artifacts(output_dir)
    if n == 0:
        log("no artifacts collected to %s" % output_dir)
        return 1

    log("MCD build done: %d artifact(s) -> %s" % (n, output_dir))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as identifier:  # noqa
        log("build exception: %s" % identifier)
        sys.exit(-1)
