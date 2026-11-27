import crypto from 'node:crypto';
import fs from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { request } from 'undici';

import { assertAllowedHost } from './manifest';

export class VerifyMismatchError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'VerifyMismatchError';
  }
}

export class DownloadError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'DownloadError';
  }
}

export interface DownloadProgress {
  downloaded: number;
  percent: number;
  total: number;
}

export async function downloadWithSha256(
  url: string,
  dest: string,
  expectedSha256: string,
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  assertAllowedHost(url);
  const res = await request(url, { method: 'GET' });
  if (res.statusCode >= 400) {
    throw new DownloadError(`HTTP ${res.statusCode} for ${url}`);
  }
  const totalHeader = res.headers['content-length'];
  const total = Array.isArray(totalHeader)
    ? Number(totalHeader[0])
    : totalHeader
      ? Number(totalHeader)
      : 0;

  let downloaded = 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);

  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      downloaded += chunk.length;
      if (onProgress && total > 0) {
        onProgress({
          downloaded,
          percent: Math.floor((downloaded / total) * 100),
          total,
        });
      }
      cb(null, chunk);
    },
  });

  await pipeline(res.body, tap, out);

  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    await fs.promises.unlink(dest).catch(() => undefined);
    throw new VerifyMismatchError(`SHA256 mismatch: expected ${expectedSha256}, got ${actual}`);
  }
}

export function parseShasumsFile(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([0-9a-f]+)\s+\*?(\S+)$/i.exec(trimmed);
    if (!match) continue;
    map.set(match[2], match[1].toLowerCase());
  }
  return map;
}

export async function fetchNodeSha256(shasumsUrl: string, archiveName: string): Promise<string> {
  assertAllowedHost(shasumsUrl);
  const res = await request(shasumsUrl, { method: 'GET' });
  if (res.statusCode >= 400) {
    throw new DownloadError(`Failed to fetch SHASUMS: HTTP ${res.statusCode}`);
  }
  const text = await res.body.text();
  const map = parseShasumsFile(text);
  const sha = map.get(archiveName);
  if (!sha) {
    throw new DownloadError(`SHA256 for ${archiveName} not found in SHASUMS file`);
  }
  return sha;
}
