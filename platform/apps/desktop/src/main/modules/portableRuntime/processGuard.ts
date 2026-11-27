import type { RuntimeName } from './types';

const managed = new Map<number, RuntimeName>();

export function registerManagedProcess(pid: number, name: RuntimeName): void {
  managed.set(pid, name);
}

export function unregisterManagedProcess(pid: number): void {
  managed.delete(pid);
}

export function ensureNotInUse(name: RuntimeName): {
  inUse: boolean;
  pids: number[];
} {
  const pids = Array.from(managed.entries())
    .filter(([, n]) => n === name)
    .map(([pid]) => pid)
    .filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        managed.delete(pid);
        return false;
      }
    });
  return { inUse: pids.length > 0, pids };
}
