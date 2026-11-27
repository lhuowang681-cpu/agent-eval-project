import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { parse as parseUrl } from 'node:url';

import { autoUpdater } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:macUpdater:proxy');

/**
 * macOS update proxy (ported from iDesk src/main/autoUpdate/update.js).
 *
 * WHY: Squirrel.Mac (the engine behind Electron's built-in `autoUpdater` on macOS)
 * only accepts a feed URL that returns a small JSON `{ "url": "<zip-url>" }`, and it
 * downloads the zip itself with no progress reporting. Our update server
 * (getCommonAppUpdateInfo) instead returns a direct downloadUrl. So we run a tiny
 * local HTTP server on 127.0.0.1 that:
 *   1. Exposes a `/checkupdate` endpoint returning the Squirrel-shaped JSON.
 *   2. Proxies the actual zip download, emitting `update-progress` per 1% so the UI
 *      can show a progress bar.
 *
 * The proxied download URL is percent-encoded into the path so a single server can
 * forward to any origin.
 */
export interface ProxyUpdateInfo {
  [key: string]: unknown;
  downloadUrl: string;
  versionName?: string;
}

class MacUpdateProxy {
  private server: Server | null = null;
  private port: number | null = null;
  private portPromise: Promise<number>;
  private portResolve!: (port: number) => void;
  private proxyResponse: Record<string, unknown> = {};
  private patched = false;

  constructor() {
    this.portPromise = new Promise((resolve) => {
      this.portResolve = resolve;
    });
  }

  /**
   * Start the local proxy server and monkey-patch electron.autoUpdater so that
   * setFeedURL / checkForUpdates / quitAndInstall route through the proxy.
   * Idempotent.
   */
  public start() {
    if (this.server) return;

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(0, '127.0.0.1', () => {
      const address = this.server!.address();
      this.port = typeof address === 'object' && address ? address.port : null;
      logger.info(`Mac update proxy listening on 127.0.0.1:${this.port}`);
      if (this.port) this.portResolve(this.port);
    });

    this.patchAutoUpdater();
  }

  /**
   * Register the real download info and return the local feed URL that
   * Squirrel.Mac should poll. Called after the SOA interface returns a new version.
   */
  public setProxyRes(data: ProxyUpdateInfo): Promise<string> {
    return this.portPromise.then((port) => {
      this.proxyResponse = {
        ...data,
        url: `http://127.0.0.1:${port}/${encodeURIComponent(data.downloadUrl)}`,
      };
      return `http://127.0.0.1:${port}/checkupdate`;
    });
  }

  private show502(res: ServerResponse) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Invalid Request');
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    const reqUrl = req.url || '';
    const urlObj = parseUrl(reqUrl);

    // Squirrel.Mac polls this endpoint; return the JSON it expects.
    if (urlObj.pathname === '/checkupdate') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(JSON.stringify(this.proxyResponse));
      return;
    }

    // Otherwise the path is `/<encoded-target-url>` — proxy the download.
    const matches = (urlObj.path || '').match(/^\/([^/]+)(\/.*$)?/);
    if (!matches) {
      this.show502(res);
      return;
    }

    const targetUrl = decodeURIComponent(matches[1]) + (matches[2] || '');
    const targetUrlObj = parseUrl(targetUrl);
    const lib =
      targetUrlObj.protocol === 'https:' ? https : targetUrlObj.protocol === 'http:' ? http : null;
    if (!lib) {
      this.show502(res);
      return;
    }

    logger.debug(`Proxying download: ${targetUrl}`);
    const headers = { ...req.headers, host: targetUrlObj.host || '' };

    const proxyReq = lib.request(targetUrl, { headers, method: req.method }, (proxyRes) => {
      const proxyHeaders = { ...proxyRes.headers };
      const contentLength = Number.parseInt(proxyHeaders['content-length'] as string, 10) || 0;
      delete proxyHeaders['content-length'];
      delete proxyHeaders['content-encoding'];
      res.writeHead(proxyRes.statusCode || 502, proxyHeaders);

      if (proxyRes.statusCode !== 200) {
        logger.warn(`Proxy upstream returned ${proxyRes.statusCode} for ${targetUrl}`);
      }

      const isZip = (targetUrlObj.pathname || '').endsWith('.zip');
      let receiveLength = 0;
      let lastPercent = 0;

      proxyRes.on('data', (chunk: Buffer) => {
        receiveLength += chunk.length;
        res.write(chunk);
        if (isZip && contentLength > 0) {
          const currentPercent = (receiveLength / contentLength) * 100;
          if (currentPercent >= lastPercent + 1) {
            lastPercent = Math.floor(currentPercent);
            autoUpdater.emit('update-progress', {
              error: false,
              percent: lastPercent,
              targetUrl,
            });
          }
        }
      });
      proxyRes.on('end', () => res.end());
      proxyRes.on('error', (e: Error) => {
        autoUpdater.emit('update-progress', {
          error: true,
          errMsg: e?.message,
          percent: lastPercent,
          targetUrl,
        });
      });
    });

    proxyReq.on('error', (e: Error) => {
      autoUpdater.emit('update-progress', {
        error: true,
        errMsg: e?.message,
        percent: 0,
        targetUrl,
      });
      if (!res.headersSent) this.show502(res);
    });

    req.pipe(proxyReq);
  }

  /**
   * Patch electron.autoUpdater so its feed URL points at the local proxy, and so
   * its async methods wait for the proxy port to be ready.
   */
  private patchAutoUpdater() {
    if (this.patched) return;
    this.patched = true;

    const originalSetFeedURL = autoUpdater.setFeedURL.bind(autoUpdater);
    const originalCheckForUpdates = autoUpdater.checkForUpdates.bind(autoUpdater);
    const originalQuitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater);

    autoUpdater.setFeedURL = (options: any) => {
      // On macOS Electron's setFeedURL takes an object { url }.
      const opts = typeof options === 'string' ? { url: options } : { ...options };
      this.portPromise.then(() => originalSetFeedURL(opts));
    };

    autoUpdater.checkForUpdates = () => {
      this.portPromise.then(() => originalCheckForUpdates());
    };

    autoUpdater.quitAndInstall = () => {
      this.portPromise.then(() => originalQuitAndInstall());
    };
  }
}

export const macUpdateProxy = new MacUpdateProxy();
