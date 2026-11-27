import { existsSync } from 'node:fs';

import { shell } from 'electron';

import { openCliEntry } from '@/const/dir';
import { runOpenCli } from '@/modules/openCli/runOpenCli';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:OpenCliCtr');

/**
 * Where we send users to install the Browser Bridge Chrome extension.
 */
const OPENCLI_EXTENSION_URL =
  'https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk';

export interface OpenCliStatus {
  entry: string;
  /** When `installed` is false but the entry exists, the real failure detail (stderr/exit). */
  error?: string;
  installed: boolean;
  version?: string;
}

export interface OpenCliDoctorResult {
  connected: boolean;
  exitCode: number;
  stderr: string;
  stdout: string;
}

/**
 * OpenCLI Controller
 *
 * Exposes the optional OpenCLI integration to the renderer: detect the bundled
 * CLI, guide the user to install the Chrome extension, and verify connectivity
 * via `opencli doctor`.
 */
export default class OpenCliCtr extends ControllerModule {
  static override readonly groupName = 'openCli';

  /**
   * Detect the bundled OpenCLI and read its version.
   */
  @IpcMethod()
  async getStatus(): Promise<OpenCliStatus> {
    if (!existsSync(openCliEntry)) {
      logger.warn(`OpenCLI entry not found, treating as not bundled: ${openCliEntry}`);
      return { entry: openCliEntry, error: `entry not found: ${openCliEntry}`, installed: false };
    }

    const { exitCode, stderr, stdout } = await runOpenCli(['--version']);
    if (exitCode !== 0) {
      // The entry exists but `--version` failed at runtime. Surface the real cause
      // instead of collapsing to a bare "not installed", which hides spawn errors
      // (e.g. the ELECTRON_RUN_AS_NODE re-exec being blocked in a packaged app).
      const detail = (stderr || stdout).trim();
      logger.error(`opencli --version failed (exit=${exitCode}): ${detail || '(no output)'}`);
      return {
        entry: openCliEntry,
        error: detail || `opencli --version exited with code ${exitCode}`,
        installed: false,
      };
    }

    return {
      entry: openCliEntry,
      installed: true,
      version: stdout.trim().split('\n')[0],
    };
  }

  /**
   * Run `opencli doctor` to verify the Chrome extension / daemon connectivity.
   *
   * The vendored `doctor` command never sets a non-zero exit code (unlike opencli's
   * other subcommands) — it only prints a human-readable report, so `exitCode` is 0
   * even when the daemon/extension aren't connected. We instead detect the report's
   * own "Everything looks good!" line, which `renderBrowserDoctorReport` only emits
   * when there are zero issues and both daemon + extension are confirmed connected.
   */
  @IpcMethod()
  async runDoctor(): Promise<OpenCliDoctorResult> {
    const { exitCode, stdout, stderr } = await runOpenCli(['doctor']);
    const connected = exitCode === 0 && stdout.includes('Everything looks good!');
    logger.debug(`opencli doctor exit=${exitCode} connected=${connected}`);
    return { connected, exitCode, stderr, stdout };
  }

  /**
   * Open the Chrome extension install page in the user's default browser.
   */
  @IpcMethod()
  async openExtensionPage(): Promise<void> {
    logger.debug(`Opening OpenCLI extension page: ${OPENCLI_EXTENSION_URL}`);
    await shell.openExternal(OPENCLI_EXTENSION_URL);
  }
}
