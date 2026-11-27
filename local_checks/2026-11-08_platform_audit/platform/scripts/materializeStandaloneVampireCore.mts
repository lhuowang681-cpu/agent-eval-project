/**
 * Materialize @ctrip/vampire-core runtime closure into .next/standalone.
 *
 * 问题背景：
 *   项目 next.config 把 @ctrip/vampire-core 标为 serverExternalPackages。
 *   Next.js output tracing 追到 vampire-core 主包后不再深入 external，导致
 *   standalone 输出只包含 @ctrip/vampire-core 一个目录，而它 require 的
 *   @ctrip/foundation-framework / @ctrip/log / @ctrip/log-provider /
 *   @ctrip/vampire-common / @ctrip/vampire-request / @ctrip/vampire-runtime-context
 *   全部缺失，导致 bootstrap 挂掉、triplog 同链路失效。
 *
 * 方案：
 *   pnpm 结构下，顶层 node_modules/@ctrip 只有被项目直接依赖的包（vampire-core），
 *   间接依赖藏在 node_modules/.pnpm/@ctrip+vampire-core@<ver>/node_modules/@ctrip/ 下。
 *   构建后从该私有 node_modules 目录把整条 @ctrip/* 依赖树以及对应的
 *   native prebuild (cache/locker) 物化 (materialize) 到
 *   .next/standalone/node_modules/@ctrip/。
 *
 *   用 dereference copy（复制 symlink 指向的实体），保证运行时可用。
 *
 * 触发方式：build:captain / build:docker 后紧接一步执行。
 */
import { existsSync, mkdirSync } from 'node:fs';
import { cp, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const PROJECT_NODE_MODULES = join(projectRoot, 'node_modules');
const DEST_NODE_MODULES = join(projectRoot, '.next', 'standalone', 'node_modules');

/** vampire-core 主包所在的 pnpm 私有 node_modules；其兄弟目录即所有间接 @ctrip/* 依赖。 */
async function findVampireCorePnpmNodeModules(): Promise<string | null> {
  // node_modules/@ctrip/vampire-core 是 symlink → .pnpm/@ctrip+vampire-core@<ver>/node_modules/@ctrip/vampire-core
  const symlink = join(PROJECT_NODE_MODULES, '@ctrip', 'vampire-core');
  if (!existsSync(symlink)) return null;
  const realPath = await realpath(symlink);
  // realPath 形如 .../.pnpm/@ctrip+vampire-core@1.2.4/node_modules/@ctrip/vampire-core
  // 上溯 2 级就是 .../.pnpm/@ctrip+vampire-core@1.2.4/node_modules
  const pnpmNodeModules = resolve(realPath, '..', '..');
  return pnpmNodeModules;
}

/** 需要一并 materialize 的 @ctrip/* 依赖（跟随 vampire-core 一起走）。 */
const CTRIP_DEPS = [
  'vampire-core',
  'vampire-runtime-context',
  'foundation-framework',
  'vampire-request',
  'vampire-common',
  'log',
  'log-provider',
];

/** 平台相关 native prebuild 前缀。 */
const NATIVE_PREBUILD_PREFIXES = [
  'node-vampire-cache-prebuild',
  'node-vampire-locker-prebuild',
];

async function copyFromSource(pkgName: string, sourceRoot: string): Promise<boolean> {
  const src = join(sourceRoot, '@ctrip', pkgName);
  const dest = join(DEST_NODE_MODULES, '@ctrip', pkgName);

  if (!existsSync(src)) {
    return false;
  }

  const realSrc = await realpath(src);
  const s = await stat(realSrc);
  if (!s.isDirectory()) {
    return false;
  }

  mkdirSync(dirname(dest), { recursive: true });
  await cp(realSrc, dest, {
    recursive: true,
    dereference: true,
    force: true,
  });
  console.info(`[materialize-vampire] copied @ctrip/${pkgName}`);
  return true;
}

async function copyPackage(pkgName: string, pnpmNodeModules: string | null): Promise<void> {
  // 先尝试从 pnpm 私有 node_modules 拷（间接依赖只存在于此）
  if (pnpmNodeModules && (await copyFromSource(pkgName, pnpmNodeModules))) {
    return;
  }
  // 兜底：顶层 node_modules（vampire-core 主包走这条）
  if (await copyFromSource(pkgName, PROJECT_NODE_MODULES)) {
    return;
  }
  console.warn(`[materialize-vampire] skip ${pkgName}: not found in any candidate location`);
}

async function copyNativePrebuilds(pnpmNodeModules: string | null): Promise<void> {
  // native prebuild 在 pnpm 私有 node_modules 里以 @ctrip/node-vampire-*-prebuild-<platform-arch> 目录存在
  const searchRoots = [pnpmNodeModules, PROJECT_NODE_MODULES].filter(Boolean) as string[];
  for (const root of searchRoots) {
    const ctripDir = join(root, '@ctrip');
    if (!existsSync(ctripDir)) continue;
    const entries = await readdir(ctripDir);
    for (const name of entries) {
      if (NATIVE_PREBUILD_PREFIXES.some((p) => name.startsWith(p))) {
        await copyPackage(name, pnpmNodeModules);
      }
    }
  }
}

async function main() {
  if (!existsSync(join(projectRoot, '.next', 'standalone'))) {
    console.warn(
      '[materialize-vampire] .next/standalone not found; did you build with NEXT_BUILD_STANDALONE=1?',
    );
    process.exit(0);
  }

  const pnpmNodeModules = await findVampireCorePnpmNodeModules();
  if (!pnpmNodeModules) {
    console.warn(
      '[materialize-vampire] cannot resolve pnpm private node_modules for @ctrip/vampire-core; skipping',
    );
    process.exit(0);
  }
  console.info(`[materialize-vampire] source pnpm node_modules: ${pnpmNodeModules}`);
  console.info(`[materialize-vampire] dest node_modules       : ${DEST_NODE_MODULES}`);

  for (const pkg of CTRIP_DEPS) {
    await copyPackage(pkg, pnpmNodeModules);
  }

  await copyNativePrebuilds(pnpmNodeModules);

  // 自检：确保关键依赖真的到位；失败则让 build 挂掉，避免部署残缺产物
  const REQUIRED = [
    '@ctrip/vampire-core/dist/index.js',
    '@ctrip/vampire-core/dist/bin/boot_app.js',
    '@ctrip/vampire-runtime-context/dist/index.js',
    '@ctrip/foundation-framework/dist/DefaultFF.js',
    '@ctrip/log/package.json',
    '@ctrip/log-provider/package.json',
    '@ctrip/vampire-common/package.json',
    '@ctrip/vampire-request/package.json',
  ];
  const missing = REQUIRED.filter((rel) => !existsSync(join(DEST_NODE_MODULES, rel)));
  if (missing.length > 0) {
    console.error(
      '[materialize-vampire] post-check failed, missing files in standalone:\n' +
        missing.map((m) => `  - ${m}`).join('\n'),
    );
    process.exit(1);
  }

  console.info('[materialize-vampire] done, post-check passed.');
}

main().catch((err) => {
  console.error('[materialize-vampire] failed:', err);
  process.exit(1);
});

