import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import {
  copyNativeModules,
  copyNativeModulesToSource,
  getAsarUnpackPatterns,
  getNativeModulesFilesConfig,
} from './native-deps.config.mjs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const packageJSON = JSON.parse(await fs.readFile(path.join(__dirname, 'package.json'), 'utf8'));

const channel = process.env.UPDATE_CHANNEL;
const arch = os.arch();

// 自定义更新服务器 URL (用于 stable 频道)
const updateServerUrl = process.env.UPDATE_SERVER_URL;

console.info(`🚄 Build Version ${packageJSON.version}, Channel: ${channel}`);
console.info(`🏗️ Building for architecture: ${arch}`);

// Resolve pnpm symlinks and copy transitive native dependencies into place
// BEFORE electron-builder evaluates the files config. Otherwise glob-based
// file inclusion misses JS-only transitive deps (e.g. file-uri-to-path) that
// pnpm does not hoist to the workspace root.
console.info('📦 Preparing native module dependencies for packaging...');
await copyNativeModulesToSource();

// Channel identity derived solely from UPDATE_CHANNEL env var.
// Supported channels: stable, beta, canary, dev, nightly
const isStable = !channel || channel === 'stable';
const isBeta = channel === 'beta';
const isCanary = channel === 'canary';
const isDev = channel === 'dev';
const isNightly = channel === 'nightly';

// Strip trailing channel path from URL for re-appending the correct channel
// Handles both base URL (https://cdn.example.com) and legacy URL with channel (https://cdn.example.com/stable)
const stripChannelSuffix = (url) => url.replace(/\/(stable|nightly|canary|beta)\/?$/, '');

// 根据 channel 配置 publish provider
// - 所有渠道 + UPDATE_SERVER_URL: 使用 generic (S3)
// - 无 UPDATE_SERVER_URL: 回退到 GitHub (本地开发)
const getPublishConfig = () => {
  const channelPath = isStable ? 'stable' : isNightly ? 'nightly' : channel || 'stable';

  if (updateServerUrl) {
    const baseUrl = stripChannelSuffix(updateServerUrl);
    const fullUrl = `${baseUrl}/${channelPath}`;
    console.info(`📦 ${channelPath} channel: Using generic provider (${fullUrl})`);
    return [
      {
        provider: 'generic',
        url: fullUrl,
      },
    ];
  }

  // 无 UPDATE_SERVER_URL 时不配置任何 publish provider。
  // 以前这里回退到上游 GitHub(lobehub/lobehub),会把上游 LobeHub 的 feed 写进
  // app-update.yml —— electron-updater(Windows、以及任何仍跑 electron-updater 的旧 mac 包)
  // 会据此把客户端"更新"成上游 LobeHub 版本(例如误弹 v2.2.x)。mac 现在走 MacUpdaterManager
  // (携程 SOA)本就不读 app-update.yml,这里返回 null 既杜绝误更新,也不再生成带上游地址的
  // app-update.yml。需要 electron-updater 时,通过 UPDATE_SERVER_URL 指向自己的 generic 源。
  console.info(
    `📦 ${channelPath} channel: No UPDATE_SERVER_URL, skipping publish (no app-update.yml)`,
  );
  return null;
};

// Keep only these Electron Framework localization folders (*.lproj)
// (aligned with previous Electron Forge build config)
// Keep zh_CN/zh_TW so chromium's navigator.language follows a Chinese-locale
// system instead of falling back to en-US (which made "跟随系统" always English).
const keepLanguages = new Set(['en', 'en_GB', 'en-US', 'en_US', 'zh_CN', 'zh_TW']);

// 根据版本类型确定协议 scheme
const getProtocolScheme = () => {
  if (isCanary) return 'tripyoyo-canary';
  if (isNightly) return 'tripyoyo-nightly';
  return 'tripyoyo';
};

const protocolScheme = getProtocolScheme();

// Determine icon file based on version type
// Returns the Icon base name (PascalCase, e.g. 'Icon-beta') used for .icns / .Assets.car;
// use `.toLowerCase()` for the .ico / .png variants (e.g. 'icon-beta').
const getIconFileName = () => {
  if (isStable) return 'Icon';
  if (isBeta) return 'Icon-beta';
  if (isCanary) return 'Icon-canary';
  if (isDev) return 'Icon-dev';
  if (isNightly) return 'Icon-nightly';
  return 'Icon';
};

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration
 */
const config = {
  /**
   * BeforePack hook for post-config preparation:
   * 1. Re-run native module symlink resolution (already done at config load time,
   *    kept here as a safety net in case earlier build steps reset node_modules).
   * 2. Download lark-cli (Feishu CLI) binary.
   * 3. Vendor OpenCLI npm package.
   * 4. Build and embed the tripyoyo CLI bundle.
   *
   * @see https://github.com/electron-userland/electron-builder/issues/9254
   */
  beforePack: async () => {
    await copyNativeModulesToSource();

    console.info('📦 Downloading lark-cli (Feishu CLI) binary...');
    execSync('node scripts/download-lark-cli.mjs', { stdio: 'inherit', cwd: __dirname });

    console.info('📦 Vendoring OpenCLI npm package...');
    execSync('node scripts/install-opencli.mjs', { stdio: 'inherit', cwd: __dirname });

    // Build and embed the tripyoyo CLI (@ctrip/tripyoyo-cli) so it ships with the
    // app and the runtime-environment detector can resolve it. apps/cli is an
    // independent nested pnpm workspace (its own pnpm-workspace.yaml), so the
    // repo-root install does NOT cover it — install its deps here, matching the
    // CLI's own `prepublishOnly`. tsdown emits a single ESM bundle at dist/index.js.
    console.info('📦 Building tripyoyo CLI bundle...');
    const cliDir = path.resolve(__dirname, '../cli');
    // --ignore-scripts: CI build machines ship an older pnpm that treats ignored
    // build scripts (esbuild's postinstall) as a hard error, making `pnpm install`
    // exit non-zero so the `&& pnpm run build` short-circuits and the build never
    // runs. --ignore-scripts skips those lifecycle scripts silently regardless of
    // pnpm version. It is safe here: tsdown uses rolldown, whose platform binding
    // ships via optionalDependencies (not a build script), and esbuild's
    // postinstall isn't needed (tsdown does not use esbuild at runtime).
    // Install/build are split so a real build failure streams its own output via
    // stdio:'inherit' instead of being swallowed by execSync's combined error.
    execSync('pnpm install --ignore-scripts', { cwd: cliDir, stdio: 'inherit' });
    execSync('pnpm run build', { cwd: cliDir, stdio: 'inherit' });
    await fs.copyFile(
      path.join(cliDir, 'dist', 'index.js'),
      path.resolve(__dirname, 'resources/bin/tripyoyo-cli.js'),
    );
    // Sidecar package.json for the bundle: the CLI's pkg.ts resolves
    // `../package.json` for its own name/version, and Node needs `type: module`
    // to load the ESM bundle. Packaged, this maps to Resources/package.json — the
    // dir one level up from Resources/bin/tripyoyo-cli.js (see extraResources).
    const cliPkg = JSON.parse(await fs.readFile(path.join(cliDir, 'package.json'), 'utf8'));
    await fs.writeFile(
      path.resolve(__dirname, 'resources/cli-package.json'),
      JSON.stringify({ name: cliPkg.name, type: 'module', version: cliPkg.version }),
    );
    console.info('✅ tripyoyo CLI bundle copied to resources/bin/tripyoyo-cli.js');
  },
  /**
   * AfterPack hook for post-processing:
   * 1. Copy native modules to asar.unpacked (resolving pnpm symlinks)
   * 2. Copy Liquid Glass Assets.car for macOS 26+
   * 3. Remove unused Electron Framework localizations
   *
   * @see https://github.com/electron-userland/electron-builder/issues/9254
   * @see https://github.com/MultiboxLabs/flow-browser/pull/159
   * @see https://github.com/electron/packager/pull/1806
   */
  afterPack: async (context) => {
    const isMac = ['darwin', 'mas'].includes(context.electronPlatformName);

    // Determine resources path based on platform
    let resourcesPath;
    if (isMac) {
      resourcesPath = path.join(
        context.appOutDir,
        `${context.packager.appInfo.productFilename}.app`,
        'Contents',
        'Resources',
      );
    } else {
      // Windows and Linux: resources is directly in appOutDir
      resourcesPath = path.join(context.appOutDir, 'resources');
    }

    // Copy native modules to asar.unpacked, resolving pnpm symlinks
    const unpackedNodeModules = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules');
    await copyNativeModules(unpackedNodeModules);

    // macOS-specific post-processing
    if (!isMac) {
      return;
    }

    const iconFileName = getIconFileName();
    const assetsCarSource = path.join(__dirname, 'build', `${iconFileName}.Assets.car`);
    const assetsCarDest = path.join(resourcesPath, 'Assets.car');

    // Remove unused Electron Framework localizations to reduce app size
    const frameworkResourcePath = path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
    );

    try {
      const entries = await fs.readdir(frameworkResourcePath);
      await Promise.all(
        entries.map(async (file) => {
          if (!file.endsWith('.lproj')) return;

          const lang = file.split('.')[0];
          if (keepLanguages.has(lang)) return;

          await fs.rm(path.join(frameworkResourcePath, file), { force: true, recursive: true });
        }),
      );
    } catch {
      // Non-critical: folder may not exist depending on packaging details
    }

    try {
      await fs.access(assetsCarSource);
      await fs.copyFile(assetsCarSource, assetsCarDest);
      console.info(`✅ Copied Liquid Glass icon: ${iconFileName}.Assets.car`);
    } catch {
      // Non-critical: Assets.car not found or copy failed
      // App will use fallback .icns icon on all macOS versions
      console.info(`⏭️  Skipping Assets.car (not found or copy failed)`);
    }
  },
  // 携程专属 bundle id。不能再用上游的 com.lobehub.lobehub-desktop:那会与已安装的原生
  // LobeHub.app 撞 bundle id,导致 Squirrel/electron-updater 的缓存目录与 ShipIt 互相串更新。
  appId: 'com.ctrip.tripyoyo',
  appImage: {
    artifactName: '${productName}-${version}.${ext}',
  },

  // Native modules must be unpacked from asar to work correctly
  asarUnpack: getAsarUnpackPatterns(),

  detectUpdateChannel: true,

  directories: {
    buildResources: 'build',
    output: 'release',
  },

  dmg: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
    background: 'resources/dmg.png',
    contents: [
      { type: 'file', x: 150, y: 240 },
      { type: 'link', path: '/Applications', x: 450, y: 240 },
    ],
    iconSize: 80,
    window: {
      height: 400,
      width: 600,
    },
  },

  electronDownload: {
    mirror: 'https://npmmirror.com/mirrors/electron/',
  },

  files: [
    'dist',
    'resources',
    'dist/renderer/**/*',
    '!resources/locales',
    '!resources/dmg.png',
    '!resources/dmg@2x.png',
    // Exclude all node_modules first
    '!node_modules',
    // Then explicitly include native modules using object form (handles pnpm symlinks)
    ...getNativeModulesFilesConfig(),
  ],
  generateUpdatesFilesForAllChannels: true,
  linux: {
    category: 'Utility',
    icon: `build/${getIconFileName().toLowerCase()}.png`,
    maintainer: 'electronjs.org',
    target: ['AppImage', 'snap', 'deb', 'rpm', 'tar.gz'],
  },
  mac: {
    compression: 'maximum',
    icon: `build/${getIconFileName()}.icns`,
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      CFBundleIconName: 'AppIcon',
      CFBundleURLTypes: [
        {
          CFBundleURLName: 'TripYoYo Protocol',
          CFBundleURLSchemes: [protocolScheme],
        },
      ],
      NSAppleEventsUsageDescription:
        'Application needs to control System Settings to help you grant Full Disk Access automatically.',
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSScreenCaptureUsageDescription:
        'Application requests access to record and analyze screen content for AI assistance.',
    },
    gatekeeperAssess: false,
    hardenedRuntime: true,
    identity: 'Xiecheng Tourism Network Technology (Shanghai) Co., Ltd. (F63YXXUDZP)',
    notarize: false,
    target: [
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'dmg' },
      { arch: [arch === 'arm64' ? 'arm64' : 'x64'], target: 'zip' },
    ],
  },
  npmRebuild: true,
  protocols: [
    {
      name: 'TripYoYo Protocol',
      schemes: [protocolScheme],
    },
  ],
  publish: getPublishConfig(),

  // Release notes 配置
  // 可以通过环境变量 RELEASE_NOTES 传入，或从文件读取
  // 这会被写入 latest-mac.yml / latest.yml 中，供 generic provider 使用
  releaseInfo: {
    releaseNotes: process.env.RELEASE_NOTES || undefined,
  },

  extraResources: [
    { from: 'resources/bin', to: 'bin' },
    // Sidecar package.json for the embedded tripyoyo CLI bundle (see beforePack).
    // Lands at Resources/package.json so the bundle's `../package.json` resolves.
    { from: 'resources/cli-package.json', to: 'package.json' },
    // OpenCLI vendored npm package tree (see scripts/install-opencli.mjs).
    // Placed outside the asar so the entry can be spawned with the built-in Node.
    // NOTE: electron-builder's copy filter (app-builder-lib util/filter.js) ALWAYS
    // drops a `node_modules` that is a direct child of the copy root — it is a
    // hard-coded `if (relative === 'node_modules') return false`, unfixable by any
    // `filter`. So install-opencli.mjs vendors into `resources/opencli/runtime/`,
    // making it `runtime/node_modules` (nested → survives). Keep them in sync.
    { from: 'resources/opencli', to: 'opencli' },
  ],

  squirrelWindows: {
    artifactName: '${productName}-${version}-setup.${ext}',
  },

  win: {
    executableName: 'TripYoYo',
    icon: `build/${getIconFileName().toLowerCase()}.ico`,
    target: [{ arch: ['x64'], target: 'squirrel' }],
  },
};

export default config;
