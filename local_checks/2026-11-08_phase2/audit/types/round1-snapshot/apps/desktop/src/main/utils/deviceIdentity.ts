import { createHash, randomUUID } from 'node:crypto';

import { machineIdSync } from 'node-machine-id';

/**
 * Constant mixed into the deviceId hash. Not a secret — it only namespaces the
 * hash input to this app so the same OS machine id used elsewhere can't produce
 * a colliding value. Kept in sync with the gateway / server expectations.
 */
const SALT = 'lobehub-device-salt';

export type IdentitySource = 'fallback' | 'machine-id';

export interface DeviceIdentity {
  deviceId: string;
  identitySource: IdentitySource;
}

export interface DeriveDeviceIdOptions {
  /**
   * Reuse an existing id when the machine identifier is unavailable (e.g. the
   * desktop's previously stored Electron Store UUID). Keeps a device stable
   * across the fallback path.
   */
  fallbackId?: string;
  /**
   * Override the raw machine-id reader. Defaults to `node-machine-id`. Exists so
   * callers in restricted environments and tests can inject a value without
   * mocking the module.
   */
  readMachineId?: () => string;
}

/**
 * Derive a stable deviceId for `(machine, user)`.
 *
 * Same machine + same user → same id (survives app reinstall, since the machine
 * id is OS-level). Same machine + different user → different id, so the server
 * can't correlate accounts on one machine. When the machine id can't be read,
 * falls back to `fallbackId` (or a fresh random UUID) and flags the source so
 * callers/UI can surface that this device may not survive a reinstall.
 *
 * Inlined here (instead of depending on `@lobechat/device-identity`) because the
 * desktop is a self-contained nested pnpm workspace and we keep its main-process
 * dependency graph small.
 */
export const deriveDeviceId = (
  userId: string,
  options: DeriveDeviceIdOptions = {},
): DeviceIdentity => {
  const readMachineId = options.readMachineId ?? (() => machineIdSync(true));

  try {
    const machineId = readMachineId();
    if (!machineId) throw new Error('empty machine id');

    // Fast sha256 is deliberate: this derives an opaque, stable identifier from
    // a high-entropy machine UUID — it is NOT password storage. userId is mixed
    // in solely for cross-account isolation, not as a hashed credential.
    const deviceId = createHash('sha256')
      .update(`${machineId}|${userId}|${SALT}`)
      .digest('hex')
      .slice(0, 32);

    return { deviceId, identitySource: 'machine-id' };
  } catch {
    return { deviceId: options.fallbackId ?? randomUUID(), identitySource: 'fallback' };
  }
};
