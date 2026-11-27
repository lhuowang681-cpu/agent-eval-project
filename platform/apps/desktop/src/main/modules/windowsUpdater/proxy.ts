import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { parse as parseUrl } from 'node:url';

import { autoUpdater } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:windowsUpdater:proxy');

class WindowsUpdateProxy {
  private server: Server | null = null;
  private port: number | null = null;
  private portPromise: Promise<number>;
  private portResolve!: (port: number) => void;
  private patched = false;

  constructor() {
    this.portPromise = new Promise((resolve) => {
      this.portResolve = resolve;
    });
  }

  public start() {
    if (this.server) return;

    this.server = createServer((req, res) => this.handleRequest(req, res));
    this.server.listen(0, '127.0.0.1', () => {
      const address = this.server!.address();
      this.port = typeof address === 'object' && address ? address.port : null;
      logger.info(`Windows update proxy listening on 127.0.0.1:${this.port}`);
      if (this.port) this.portResolve(this.port);
    });

    this.patchAutoUpdater();
  }

  private show502(res: ServerResponse) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Invalid Request');
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    const reqUrl = req.url || '';
    const urlObj = parseUrl(reqUrl);
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

    logger.debug(`Proxying Squirrel.Windows request: ${targetUrl}`);
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

      if ((targetUrlObj.pathname || '').endsWith('/RELEASES')) {
        this.pipeRewrittenReleases(proxyRes, res);
        return;
      }

      this.pipeDownloadWithProgress(proxyRes, res, targetUrl, contentLength);
    });

    proxyReq.on('error', (error: Error) => {
      autoUpdater.emit('update-progress' as any, {
        error: true,
        errMsg: error?.message,
        percent: 0,
        targetUrl,
      });
      if (!res.headersSent) this.show502(res);
    });

    req.pipe(proxyReq);
  }

  private pipeRewrittenReleases(proxyRes: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on('end', () => {
      const content = Buffer.concat(chunks)
        .toString()
        .replaceAll(/(\s)(https?:\/\/[^/]+)\//g, (_match, prefix: string, origin: string) => {
          return `${prefix}http://127.0.0.1:${this.port}/${encodeURIComponent(origin)}/`;
        });
      res.end(content);
    });
  }

  private pipeDownloadWithProgress(
    proxyRes: IncomingMessage,
    res: ServerResponse,
    targetUrl: string,
    contentLength: number,
  ) {
    const targetUrlObj = parseUrl(targetUrl);
    const isNupkg = (targetUrlObj.pathname || '').endsWith('.nupkg');
    let receiveLength = 0;
    let lastPercent = 0;

    proxyRes.on('data', (chunk: Buffer) => {
      receiveLength += chunk.length;
      res.write(chunk);
      if (isNupkg && contentLength > 0) {
        const currentPercent = (receiveLength / contentLength) * 100;
        if (currentPercent >= lastPercent + 1) {
          lastPercent = Math.floor(currentPercent);
          autoUpdater.emit('update-progress' as any, {
            error: false,
            percent: lastPercent,
            targetUrl,
          });
        }
      }
    });

    proxyRes.on('end', () => res.end());
    proxyRes.on('error', (error: Error) => {
      autoUpdater.emit('update-progress' as any, {
        error: true,
        errMsg: error?.message,
        percent: lastPercent,
        targetUrl,
      });
    });
  }

  private patchAutoUpdater() {
    if (this.patched) return;
    this.patched = true;

    const originalSetFeedURL = autoUpdater.setFeedURL.bind(autoUpdater);
    const originalCheckForUpdates = autoUpdater.checkForUpdates.bind(autoUpdater);
    const originalQuitAndInstall = autoUpdater.quitAndInstall.bind(autoUpdater);

    autoUpdater.setFeedURL = (options: any) => {
      const opts = typeof options === 'string' ? { url: options } : { ...options };
      const url = opts.url;
      this.portPromise.then((port) => {
        const urlObj = parseUrl(url);
        opts.url = `http://127.0.0.1:${port}/${encodeURIComponent(
          `${urlObj.protocol}//${urlObj.host}`,
        )}${urlObj.path}`;
        originalSetFeedURL(opts);
      });
    };

    autoUpdater.checkForUpdates = () => {
      this.portPromise.then(() => originalCheckForUpdates());
    };

    autoUpdater.quitAndInstall = () => {
      this.portPromise.then(() => originalQuitAndInstall());
    };
  }
}

export const windowsUpdateProxy = new WindowsUpdateProxy();
