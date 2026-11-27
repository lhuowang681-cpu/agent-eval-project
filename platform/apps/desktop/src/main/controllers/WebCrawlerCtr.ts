import { type CrawlUniformResult, crawlPagesLocal } from '../modules/webCrawler';
import { ControllerModule, IpcMethod } from './index';

interface CrawlPagesParams {
  urls: string[];
}

/**
 * Local web crawler for the desktop app.
 *
 * Runs the crawl entirely in the Electron main process (the user's machine), so
 * it can reach intranet sites and bypass the shared server's network limits.
 *
 * The crawl lives in `./modules/webCrawler` — a self-contained module with no
 * dependency on `@lobechat/web-crawler`, whose crawl-impl barrel pulls in
 * server-only deps (`@lobechat/utils/server` → `next/headers` + auth) that do
 * not exist in the Electron build.
 *
 * ⚠️ 这里**必须静态 import**，不能用 `await import()` 懒加载。
 *
 * 懒加载会让 electron-vite/rollup 把它切成独立 chunk，而那个 chunk 连带**重复打包了
 * 主进程的引导模块**，于是首次调用时模块级副作用被二次执行，直接抛错：
 *   · `Attempted to register a second handler for '__ELECTRON_LOG__'`（electron-log）
 *   · `protocol.registerSchemesAsPrivileged should be called before app is ready`（core/App.ts:140）
 * 表现是 `crawlPages` **首次调用即失败**，桌面端网页抓取完全不可用 ——
 * 而这个功能存在的意义恰恰是「在用户机器上抓取、绕过服务端 SSRF 限制」。
 *
 * 代价是 happy-dom + ws / readability / node-html-markdown 会在启动时加载。
 * 正确性优先于这点启动开销；要恢复懒加载，得先让该 chunk 不再重复打包引导模块。
 */
export default class WebCrawlerCtr extends ControllerModule {
  static override readonly groupName = 'webCrawler';

  @IpcMethod()
  async crawlPages({ urls }: CrawlPagesParams): Promise<{ results: CrawlUniformResult[] }> {
    return crawlPagesLocal(urls);
  }
}
