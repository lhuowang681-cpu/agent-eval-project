import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';
import { defineConfig } from 'electron-vite';
import type { PluginOption, ViteDevServer } from 'vite';

import {
  sharedOptimizeDeps,
  sharedRendererDefine,
  sharedRendererPlugins,
  sharedRollupOutput,
} from '../../plugins/vite/sharedRendererConfig';
import { getExternalDependencies } from './native-deps.config.mjs';

/**
 * Rewrite `/` to `/apps/desktop/index.html` so the electron-vite dev server
 * serves the desktop HTML entry when root is the monorepo root.
 */
function electronDesktopHtmlPlugin(): PluginOption {
  return {
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, _res, next) => {
        // Compare only the pathname — the renderer URL carries a query string
        // (e.g. `/?lng=zh-CN` injected for the stored locale), so a strict
        // `req.url === '/'` check would miss it and fall through to the root
        // `index.html` (the web entry) instead of the desktop entry, white-screening
        // the app.
        const pathname = req.url?.split('?')[0];
        if (pathname === '/' || pathname === '/index.html') {
          const queryIndex = req.url!.indexOf('?');
          const query = queryIndex === -1 ? '' : req.url!.slice(queryIndex);
          req.url = `/apps/desktop/index.html${query}`;
        }
        next();
      });
    },
    name: 'electron-desktop-html',
  };
}

const ROOT_DIR = path.resolve(__dirname, '../..');

/**
 * Load environment variables for desktop app.
 *
 * Selection rules:
 * - MCD build (MCD_BUILD=true): use .env (already set up by build.py based on hybridEnv)
 * - Dev mode (electron-vite dev): use .env.desktop.test
 * - Packaging, nightly/canary channel: use .env.desktop.test  (test environment)
 * - Packaging, stable channel (or unset): use .env.desktop.prod (production)
 *
 * Why channel-based selection for packaging: a packaged app has no parent process
 * to inherit runtime env from, so variables like DEVICE_GATEWAY_URL must be baked
 * in at build time (see `define` below). The channel (nightly vs stable) is the
 * existing signal for which environment the build targets — nightly/canary builds
 * point at FAT, stable builds point at prod — so we load the matching env file
 * here so its values flow into both `define` and the runtime `process.env`.
 */
function loadDesktopEnv() {
  const envFile = path.join(ROOT_DIR, '.env');
  const envTestFile = path.join(ROOT_DIR, '.env.desktop.test');
  const envProdFile = path.join(ROOT_DIR, '.env.desktop.prod');
  const isMcdBuild = process.env.MCD_BUILD === 'true';
  const isDev = process.env.NODE_ENV === 'development';
  const channel = process.env.UPDATE_CHANNEL;
  const isProdChannel = !channel || channel === 'stable';

  if (isMcdBuild && existsSync(envFile)) {
    // MCD build: .env is already set up by build.py based on hybridEnv
    dotenv.config({ path: envFile });
    console.info(`[electron-vite.config.ts] Loaded env from .env (MCD build)`);
  } else if (isDev || !isProdChannel) {
    // Dev mode, or nightly/canary packaging → test environment
    dotenv.config({ path: envTestFile });
    console.info(
      `[electron-vite.config.ts] Loaded env from .env.desktop.test (${isDev ? 'dev' : `${channel} channel`})`,
    );
  } else {
    // Stable packaging → production environment
    dotenv.config({ path: envProdFile });
    console.info(`[electron-vite.config.ts] Loaded env from .env.desktop.prod (stable channel)`);
  }
}

loadDesktopEnv();

const isDev = process.env.NODE_ENV === 'development';

const updateChannel = process.env.UPDATE_CHANNEL;
const desktopPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };

console.info(`[electron-vite.config.ts] Detected UPDATE_CHANNEL: ${updateChannel}`);

// Lexical core must stay a single module instance to keep LexicalComposerContext
// valid across @lobehub/editor's internal plugins and the outer LexicalComposer.
// Only list packages resolvable from the workspace root; the editor's nested
// @lexical/* subpackages get pre-bundled transitively via @lobehub/editor.
const lexicalDeps = ['lexical', '@lexical/utils'];

/**
 * Plugin to copy WASM files from node_modules to the output directory after build.
 * Some packages (like @ctrip/vampire-core) use readFileSync to load WASM at runtime,
 * but Vite doesn't automatically copy these assets.
 */
function copyWasmPlugin(): PluginOption {
  return {
    name: 'copy-wasm-files',
    closeBundle() {
      const wasmSource = path.resolve(
        ROOT_DIR,
        'node_modules/.pnpm/@ctrip+vampire-core@1.2.4/node_modules/@ctrip/vampire-core/libs/dal/dal_decrypt_wasm_bg.wasm',
      );
      const wasmDest = path.resolve(__dirname, 'dist/main/dal_decrypt_wasm_bg.wasm');

      if (existsSync(wasmSource)) {
        mkdirSync(path.dirname(wasmDest), { recursive: true });
        copyFileSync(wasmSource, wasmDest);
        console.info('✅ Copied dal_decrypt_wasm_bg.wasm to dist/main/');
      }
    },
  };
}

/**
 * Plugin to mock @ctrip/vampire-core in dev mode.
 * This package has native modules compiled for Node.js that are incompatible with Electron.
 */
function mockVampireCorePlugin(): PluginOption {
  return {
    name: 'mock-vampire-core',
    resolveId(source) {
      if (source === '@ctrip/vampire-core') {
        return { id: source, external: true };
      }
      return null;
    },
  };
}

export default defineConfig({
  main: {
    build: {
      minify: !isDev,
      outDir: 'dist/main',
      rollupOptions: {
        // Native modules must be externalized to work correctly.
        // `bufferutil` / `utf-8-validate` are optional native add-ons of `ws`
        // (pulled in transitively via happy-dom in the local web crawler). `ws`
        // `require()`s them inside a try/catch and falls back to pure JS when
        // absent, so we externalize them to keep the require as a runtime call
        // instead of letting Rollup choke on the unresolved import.
        //
        // `electron-log` 必须外部化：它在主进程侧有 `ipcMain.handle('__ELECTRON_LOG__')`
        // 这种**模块级副作用**，被打进 bundle 后一旦出现第二个模块实例
        // （`WebCrawlerCtr` 里 `await import('../modules/webCrawler')` 的懒加载 chunk
        // 就会造成这种情况），就会重复注册并抛
        // `Attempted to register a second handler for '__ELECTRON_LOG__'` ——
        // 实测导致 `webCrawler.crawlPages` **首次调用即失败**，桌面端网页抓取完全不可用。
        // externalize 后它是一个进程内唯一的 CJS 实例，副作用只跑一次。
        external: [
          ...getExternalDependencies(),
          'bufferutil',
          'utf-8-validate',
          'electron-log',
        ],
        output: {
          // Prevent debug package from being bundled into index.js to avoid side-effect pollution
          manualChunks(id) {
            if (id.includes('node_modules/debug')) {
              return 'vendor-debug';
            }

            // Split i18n json resources by namespace (ns), not by locale.
            // Example: ".../resources/locales/zh-CN/common.json?import" -> "locales-common"
            const normalizedId = id.replaceAll('\\', '/').split('?')[0];
            const match = normalizedId.match(/\/locales\/[^/]+\/([^/]+)\.json$/);

            if (match?.[1]) return `locales-${match[1]}`;
          },
        },
      },
      sourcemap: isDev ? 'inline' : false,
    },
    plugins: [copyWasmPlugin(), mockVampireCorePlugin()],
    define: {
      'process.env.DEVICE_GATEWAY_URL': JSON.stringify(process.env.DEVICE_GATEWAY_URL),
      'process.env.OFFICIAL_CLOUD_SERVER': JSON.stringify(process.env.OFFICIAL_CLOUD_SERVER),
      'process.env.UPDATE_CHANNEL': JSON.stringify(process.env.UPDATE_CHANNEL),
      'process.env.UPDATE_SERVER_URL': JSON.stringify(process.env.UPDATE_SERVER_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/main'),
        '~common': path.resolve(__dirname, 'src/common'),
        '@ctrip/vampire-core': path.resolve(__dirname, 'src/main/mocks/vampire-core.ts'),
      },
    },
  },
  preload: {
    build: {
      minify: !isDev,
      outDir: 'dist/preload',
      sourcemap: isDev ? 'inline' : false,
    },
    // Mirror the main process define so the preload can statically inline the
    // build-time cloud server URL (differs between test/prod desktop builds).
    define: {
      'process.env.DEFAULT_ENABLE_CANARY': JSON.stringify(process.env.DEFAULT_ENABLE_CANARY),
      'process.env.OFFICIAL_CLOUD_SERVER': JSON.stringify(process.env.OFFICIAL_CLOUD_SERVER),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src/main'),
        '~common': path.resolve(__dirname, 'src/common'),
      },
    },
  },
  renderer: {
    root: ROOT_DIR,
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
        output: sharedRollupOutput,
      },
    },
    define: {
      ...sharedRendererDefine({ isMobile: false, isElectron: true }),
      __MAIN_VERSION__: JSON.stringify(desktopPackageJson.version),
    },
    optimizeDeps: {
      ...sharedOptimizeDeps,
      // Force Lexical + @lobehub/editor to be pre-bundled together so that
      // LexicalComposerContext stays a single instance. Otherwise the editor's
      // internal plugins (e.g. ReactListPlugin) and the outer LexicalComposer
      // resolve to different module copies, throwing
      // "cannot find a LexicalComposerContext".
      include: [...(sharedOptimizeDeps.include ?? []), '@lobehub/editor', ...lexicalDeps],
    },
    plugins: [
      electronDesktopHtmlPlugin(),
      ...(sharedRendererPlugins({ platform: 'desktop' }) as PluginOption[]),
    ],
    resolve: {
      dedupe: ['react', 'react-dom', ...lexicalDeps],
    },
  },
});
