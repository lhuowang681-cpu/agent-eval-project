import { randomBytes } from 'node:crypto';
import { createServer, get as httpGet, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Imported after the mock is registered (vi.mock is hoisted above imports).
import { macUpdateProxy } from '../proxy';

/**
 * The proxy emits progress / monkey-patches feed methods on electron.autoUpdater.
 * Mock it as a tiny event emitter so we can run the proxy's HTTP behaviour without
 * a real Electron runtime — this is the "post-SOA, pre-Squirrel" part of the macOS
 * auto-update flow (the part that IS automatable; the actual Squirrel install +
 * relaunch needs a signed, installed app and cannot run in CI).
 *
 * Built inside vi.hoisted (no outer imports) because vi.mock is hoisted above imports.
 */
const { autoUpdaterMock } = vi.hoisted(() => {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  const m: any = {
    checkForUpdates() {},
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((fn) => fn(...args));
      return true;
    },
    off(event: string, cb: (...args: any[]) => void) {
      listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
      return m;
    },
    on(event: string, cb: (...args: any[]) => void) {
      (listeners[event] ||= []).push(cb);
      return m;
    },
    quitAndInstall() {},
    setFeedURL() {},
  };
  return { autoUpdaterMock: m };
});

vi.mock('electron', () => ({ autoUpdater: autoUpdaterMock }));

/** A stand-in "download server" (plays the role of download2.ctripcorp.com). */
let origin: Server;
let originPort: number;
let originHits = 0;
// 2 MiB so the proxy streams many chunks and fires several 1%-granularity events.
const payload = randomBytes(2 * 1024 * 1024);

const get = (url: string): Promise<{ body: Buffer; status: number }> =>
  new Promise((resolve, reject) => {
    httpGet(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c as Buffer));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), status: res.statusCode || 0 }));
      res.on('error', reject);
    }).on('error', reject);
  });

beforeAll(async () => {
  origin = createServer((_req, res) => {
    originHits += 1;
    res.writeHead(200, {
      'Content-Length': String(payload.length),
      'Content-Type': 'application/zip',
    });
    res.end(payload);
  });
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r));
  originPort = (origin.address() as AddressInfo).port;

  macUpdateProxy.start();
});

afterAll(async () => {
  await new Promise<void>((r) => origin.close(() => r()));
  // Close the proxy's internal server so vitest can exit cleanly.
  (macUpdateProxy as unknown as { server?: Server }).server?.close();
});

describe('macUpdateProxy (post-SOA flow)', () => {
  it('returns the Squirrel-shaped /checkupdate feed wrapping the real downloadUrl', async () => {
    const downloadUrl = `http://127.0.0.1:${originPort}/TripYoYo-1.0.2-arm64-mac.zip`;

    const feedUrl = await macUpdateProxy.setProxyRes({ downloadUrl, versionName: '1.0.2' });

    // Squirrel.Mac is pointed at /checkupdate ...
    expect(feedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/checkupdate$/);

    // ... which must return { url, versionName, downloadUrl } where `url` is the
    // proxied path Squirrel will actually download from.
    const { body, status } = await get(feedUrl);
    expect(status).toBe(200);
    const json = JSON.parse(body.toString('utf8'));
    expect(json.versionName).toBe('1.0.2');
    expect(json.downloadUrl).toBe(downloadUrl);
    expect(json.url).toBe(feedUrl.replace('/checkupdate', `/${encodeURIComponent(downloadUrl)}`));
  });

  it('proxies the zip bytes intact and emits 1%-granularity progress events', async () => {
    const downloadUrl = `http://127.0.0.1:${originPort}/TripYoYo-1.0.2-arm64-mac.zip`;
    const feedUrl = await macUpdateProxy.setProxyRes({ downloadUrl, versionName: '1.0.2' });
    const { url: proxiedUrl } = JSON.parse((await get(feedUrl)).body.toString('utf8'));

    const progress: number[] = [];
    const onProgress = (s: { error?: boolean; percent?: number }) => {
      if (!s.error && typeof s.percent === 'number') progress.push(s.percent);
    };
    autoUpdaterMock.on('update-progress', onProgress);

    const before = originHits;
    const { body, status } = await get(proxiedUrl);
    autoUpdaterMock.off('update-progress', onProgress);

    // The download actually hit the origin server, and the bytes are byte-for-byte intact.
    expect(originHits).toBe(before + 1);
    expect(status).toBe(200);
    expect(body.length).toBe(payload.length);
    expect(body.equals(payload)).toBe(true);

    // Progress was reported, monotonically increasing, reaching ~100%.
    expect(progress.length).toBeGreaterThan(1);
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    expect(progress.at(-1)).toBeGreaterThanOrEqual(99);
  });

  it('returns 502 for a malformed proxy path', async () => {
    const feedUrl = await macUpdateProxy.setProxyRes({
      downloadUrl: `http://127.0.0.1:${originPort}/x.zip`,
      versionName: '1.0.2',
    });
    const base = feedUrl.replace('/checkupdate', '');
    const { status } = await get(`${base}/`);
    expect(status).toBe(502);
  });
});
