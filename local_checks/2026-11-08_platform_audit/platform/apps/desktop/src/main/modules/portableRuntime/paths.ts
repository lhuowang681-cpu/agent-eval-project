import path from 'node:path';

import { app } from 'electron';

import { RUNTIME_MANIFEST } from './manifest';
import type { RuntimeName } from './types';

export function getRuntimesRoot(): string {
  return path.join(app.getPath('userData'), 'runtimes');
}

export function getRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), name);
}

export function getRuntimeBinDir(name: RuntimeName): string {
  const subdir =
    process.platform === 'win32'
      ? RUNTIME_MANIFEST[name].binSubdir.win32
      : RUNTIME_MANIFEST[name].binSubdir.darwin;
  return subdir === '.' ? getRuntimeDir(name) : path.join(getRuntimeDir(name), subdir);
}

export function getRuntimeExecutable(name: RuntimeName): string {
  const exe =
    process.platform === 'win32'
      ? RUNTIME_MANIFEST[name].executable.win32
      : RUNTIME_MANIFEST[name].executable.darwin;
  return path.join(getRuntimeBinDir(name), exe);
}

export function getTempRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.tmp-${process.pid}`);
}

export function getNewRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.new`);
}

export function getOldRuntimeDir(name: RuntimeName): string {
  return path.join(getRuntimesRoot(), `${name}.old-${Date.now()}`);
}

export function assertInsideRuntimesRoot(target: string): void {
  const root = path.resolve(getRuntimesRoot());
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refused: path escape attempt: ${target}`);
  }
}
