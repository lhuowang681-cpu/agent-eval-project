import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { powerSaveBlocker } from 'electron';
import { macOS } from 'electron-is';

import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:PowerCtr');

const execFileAsync = promisify(execFile);

export interface SetPreventSleepResult {
  error?: string;
  success: boolean;
}

/**
 * PowerController
 *
 * Owns the per-machine "keep awake" preference that keeps this desktop online
 * for scheduled tasks. Two layers, both toggled together:
 *
 * 1. `powerSaveBlocker('prevent-app-suspension')` — held continuously while the
 *    preference is on. Blocks macOS App Nap + idle *system* sleep. No privilege.
 * 2. macOS `pmset -a disablesleep` — set via an admin-authorized osascript. This
 *    is the only user-space way to also survive **lid-close (clamshell) sleep**,
 *    which no power assertion can prevent. Requires a one-time admin prompt.
 *
 * The preference is decoupled from the gateway connection (unlike the blocker in
 * `gatewayConnectionSrv`, which only lives while connected): once the user turns
 * it on it stays on across reconnects and app restarts.
 */
export default class PowerController extends ControllerModule {
  static override readonly groupName = 'power';

  private powerSaveBlockerId: number | null = null;

  /**
   * Restore the always-on power-save blocker from the persisted preference. We
   * intentionally do NOT re-run `pmset` here (it would prompt for admin on every
   * launch): `disablesleep` is a system-level setting that already persists
   * across restarts. We only read it back to detect drift.
   */
  async afterAppReady() {
    const enabled = this.app.storeManager.get('preventSleep', false);
    if (!enabled) return;

    this.startPowerSaveBlocker();

    if (macOS()) {
      const disabled = await this.readSleepDisabled();
      if (disabled === false) {
        // Drifted (e.g. macOS reset it, or another tool changed it). Don't force
        // an admin prompt on startup; surface it in logs. The user can re-toggle.
        logger.warn(
          'preventSleep is ON but system SleepDisabled is 0 — clamshell sleep is not blocked. Re-toggle the switch to re-apply.',
        );
      }
    }
  }

  @IpcMethod()
  async getPreventSleep(): Promise<boolean> {
    return this.app.storeManager.get('preventSleep', false);
  }

  @IpcMethod()
  async setPreventSleep(enabled: boolean): Promise<SetPreventSleepResult> {
    if (enabled) {
      this.startPowerSaveBlocker();
      // macOS: also disable clamshell sleep. Requires admin; if the user cancels
      // we roll back the blocker and DON'T persist, so UI/state stay consistent.
      if (macOS()) {
        try {
          await this.setDisableSleep(true);
        } catch (error) {
          this.stopPowerSaveBlocker();
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`Failed to enable disablesleep: ${message}`);
          return { error: message, success: false };
        }
      }
      this.app.storeManager.set('preventSleep', true);
      logger.info('Prevent-sleep enabled');
      return { success: true };
    }

    // Disabling: best-effort restore, then persist off regardless.
    this.stopPowerSaveBlocker();
    if (macOS()) {
      try {
        await this.setDisableSleep(false);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to disable disablesleep: ${message}`);
        this.app.storeManager.set('preventSleep', false);
        return { error: message, success: false };
      }
    }
    this.app.storeManager.set('preventSleep', false);
    logger.info('Prevent-sleep disabled');
    return { success: true };
  }

  // ─── Power Save Blocker (no privilege) ───

  private startPowerSaveBlocker() {
    if (this.powerSaveBlockerId !== null) return;
    this.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    logger.info(`Power save blocker started (id=${this.powerSaveBlockerId})`);
  }

  private stopPowerSaveBlocker() {
    if (this.powerSaveBlockerId === null) return;
    powerSaveBlocker.stop(this.powerSaveBlockerId);
    logger.info(`Power save blocker stopped (id=${this.powerSaveBlockerId})`);
    this.powerSaveBlockerId = null;
  }

  // ─── macOS clamshell sleep (needs admin) ───

  /**
   * Toggle `pmset -a disablesleep` via an admin-authorized osascript. Rejects if
   * the user cancels the auth dialog (osascript "User canceled." / code -128).
   */
  private async setDisableSleep(on: boolean): Promise<void> {
    const value = on ? 1 : 0;
    // `do shell script … with administrator privileges` pops the standard macOS
    // auth dialog. Keep the inner command fully-qualified and literal.
    const script = `do shell script "/usr/bin/pmset -a disablesleep ${value}" with administrator privileges`;
    await execFileAsync('/usr/bin/osascript', ['-e', script]);
  }

  /**
   * Read current `SleepDisabled` from `pmset -g` (no privilege needed). Returns
   * `null` if the value can't be determined.
   */
  private async readSleepDisabled(): Promise<boolean | null> {
    try {
      const { stdout } = await execFileAsync('/usr/bin/pmset', ['-g']);
      const match = stdout.match(/SleepDisabled\s+(\d)/);
      if (!match) return null;
      return match[1] === '1';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to read SleepDisabled: ${message}`);
      return null;
    }
  }
}
