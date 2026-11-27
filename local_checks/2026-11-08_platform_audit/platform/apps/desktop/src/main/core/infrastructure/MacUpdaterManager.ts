import os from 'node:os';

import type {
  ProgressInfo,
  UpdateChannel,
  UpdateInfo,
  UpdaterStage,
  UpdaterState,
} from '@lobechat/electron-client-ipc';
import { app as electronApp, autoUpdater } from 'electron';

import { isDev } from '@/const/env';
import { getDesktopEnv } from '@/env';
import { getBuildInfo } from '@/modules/macUpdater/buildInfo';
import { macUpdateProxy } from '@/modules/macUpdater/proxy';
import { createLogger } from '@/utils/logger';

import type { App as AppCore } from '../App';

const logger = createLogger('core:MacUpdaterManager');

/**
 * SOA "getCommonAppUpdateInfo" endpoints (ported from iDesk).
 * The server decides — per empcode (employee id) / buildId — whether to return a new
 * version, which is how gray release is controlled. The client only needs to call it.
 *
 * NOTE: appId and the exact gateway may differ for TripYoYo — see the plan's
 * "待确认前置条件". iDesk uses appId 900012; TripYoYo's MCD app_id is 900016.
 */
const SOA_PATH = '/restapi/soa2/15766/json/getCommonAppUpdateInfo';
// SOA gateway endpoints per hybridEnv (confirmed with ops):
//   PROD: apigateway.ctripcorp.com (production intranet gateway)
//   FAT : gateway.m.fws.qa.nt.ctripcorp.com (FAT test environment)
//   UAT : gateway.m.uat.qa.nt.ctripcorp.com (UAT test environment)
// Desktop runs inside the corporate network, so extranet == intranet.
const PROD_URL = `https://apigateway.ctripcorp.com${SOA_PATH}`;
const FAT_URL = `https://gateway.m.fws.qa.nt.ctripcorp.com${SOA_PATH}`;
const UAT_URL = `https://gateway.m.uat.qa.nt.ctripcorp.com${SOA_PATH}`;
const CFG: Record<string, { extranet: string; intranet: string }> = {
  PROD: { extranet: PROD_URL, intranet: PROD_URL },
  FAT: { extranet: FAT_URL, intranet: FAT_URL },
  UAT: { extranet: UAT_URL, intranet: UAT_URL },
};

/**
 * macOS-only auto updater. Implements the same public surface as UpdaterManager so it
 * can be dropped into App as `this.updaterManager` on macOS without touching
 * UpdaterCtr or the renderer. Unlike the electron-updater path (which polls a static
 * yml feed), this calls a Ctrip SOA endpoint that returns a direct zip downloadUrl,
 * then routes it through Squirrel.Mac via a local proxy (see modules/macUpdater/proxy).
 */
export class MacUpdaterManager {
  private app: AppCore;
  private working = false;

  private stage: UpdaterStage = 'idle';
  private latestUpdateInfo: UpdateInfo | null = null;
  private latestProgress: ProgressInfo | null = null;
  private latestError: string | null = null;

  private newVersion = '';
  private timer: NodeJS.Timeout | null = null;

  constructor(app: AppCore) {
    this.app = app;
  }

  get mainWindow() {
    return this.app.browserManager.getMainWindow();
  }

  // ---- public surface (mirrors UpdaterManager) ----

  public initialize = async () => {
    logger.info('Initializing MacUpdaterManager');

    if (!electronApp.isPackaged) {
      logger.info('Not packaged, skipping mac auto-update');
      return;
    }

    macUpdateProxy.start();
    this.registerEvents();

    // QA mock: when MAC_UPDATE_MOCK_URL is set, check almost immediately so the
    // post-SOA flow (download → install → relaunch) can be exercised without
    // waiting for the random interval below.
    if (process.env.MAC_UPDATE_MOCK_URL) {
      logger.warn('[MOCK] MAC_UPDATE_MOCK_URL set, scheduling immediate update check (3s)');
      setTimeout(() => this.checkForUpdates({ manual: true }), 3000);
      return;
    }

    // Random first-check delay + periodic interval (iDesk: 1~60min random).
    const min = 1 * 60 * 1000;
    const max = 60 * 60 * 1000;
    const timeout = Math.floor(Math.random() * (max - min + 1)) + min;
    logger.info(`Mac auto-update check interval: ${timeout}ms`);

    setTimeout(() => this.checkForUpdates(), timeout);
    this.timer = setInterval(() => this.checkForUpdates(), timeout + 10 * 60 * 1000);

    logger.info('MacUpdaterManager initialization completed');
  };

  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.newVersion) {
      // Already found a new version; no need to keep checking.
      logger.info('New version already detected, skipping check');
      return;
    }
    logger.info(`${manual ? 'Manually' : 'Auto'} checking for updates (mac)...`);
    this.setStage('checking');

    try {
      const body = await this.requestUpdateInfo();
      if (body?.url && body.newVersion) {
        this.newVersion = body.newVersion;
        this.startDownload(body.url);
      } else {
        this.setStage('latest');
        setTimeout(() => {
          if (this.stage === 'latest') this.setStage('idle');
        }, 5000);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Mac update check failed:', message);
      this.setStage('error', { error: message });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    }
  };

  /**
   * No-op on macOS: the check auto-starts the download (Squirrel.Mac downloads as
   * soon as setFeedURL + checkForUpdates fire). Kept for interface parity.
   */
  public downloadUpdate = async () => {
    logger.debug('downloadUpdate() is a no-op on macOS (download auto-starts on check)');
  };

  public installNow = () => {
    logger.info('Mac: quit and install now');
    this.app.isQuiting = true;
    try {
      autoUpdater.quitAndInstall();
    } catch (e) {
      logger.error('quitAndInstall error:', e);
    }
  };

  public installLater = () => {
    // Squirrel.Mac installs the already-downloaded update on next relaunch.
    logger.info('Mac: update will install on next restart');
    this.mainWindow.broadcast('updateWillInstallLater');
  };

  /** Channel switching is a no-op on macOS (gray release is server-side). */
  public switchChannel = (_channel: UpdateChannel) => {
    logger.info('switchChannel is a no-op on macOS (gray release is server-controlled)');
  };

  public getUpdaterState = (): UpdaterState => {
    const state: UpdaterState = { stage: this.stage };
    if (this.latestProgress) state.progress = this.latestProgress;
    if (this.latestUpdateInfo) state.updateInfo = this.latestUpdateInfo;
    if (this.latestError) state.errorMessage = this.latestError;
    return state;
  };

  // ---- dev simulation (interface parity with UpdaterManager; used by the dev menu) ----

  private get devMockUpdateInfo(): UpdateInfo {
    return {
      releaseDate: new Date().toISOString(),
      releaseNotes: `#### Version 1.0.0 Release Notes\n- Simulated update`,
      version: '1.0.0',
    };
  }

  public simulateUpdateAvailable = () => {
    if (!isDev) return;
    this.setStage('checking');
    setTimeout(() => {
      this.setStage('downloading', { updateInfo: this.devMockUpdateInfo });
      this.simulateDownloadProgress();
    }, 1000);
  };

  public simulateDownloadProgress = () => {
    if (!isDev) return;
    let percent = 0;
    const interval = setInterval(() => {
      percent += 10;
      if (percent <= 100) {
        const progress: ProgressInfo = {
          bytesPerSecond: 1024 * 1024,
          percent,
          total: 1024 * 1024 * 100,
          transferred: 1024 * 1024 * percent,
        };
        this.latestProgress = progress;
        this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
        this.mainWindow.broadcast('updateDownloadProgress', progress);
      }
      if (percent >= 100) {
        clearInterval(interval);
        this.simulateUpdateDownloaded();
      }
    }, 300);
  };

  public simulateUpdateDownloaded = () => {
    if (!isDev) return;
    this.setStage('downloaded', { updateInfo: this.devMockUpdateInfo });
    this.mainWindow.broadcast('updateDownloaded', this.devMockUpdateInfo);
  };

  // ---- internals ----

  private setStage(
    stage: UpdaterStage,
    opts?: { error?: string; progress?: ProgressInfo; updateInfo?: UpdateInfo },
  ) {
    this.stage = stage;
    if (opts?.updateInfo !== undefined) this.latestUpdateInfo = opts.updateInfo;
    if (opts?.progress !== undefined) this.latestProgress = opts.progress;
    if (opts?.error !== undefined) this.latestError = opts.error;

    if (stage === 'idle' || stage === 'checking') {
      this.latestProgress = null;
      this.latestError = null;
    }
    if (stage !== 'error') this.latestError = null;

    this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
    this.app.menuManager.rebuildAppMenu();
  }

  /**
   * Resolve the employee id (empcode) used for gray release. Per product, the
   * username in the user profile IS the employee id. The main process cannot read
   * the renderer auth state directly, so this is fed in from the renderer (see
   * App.setUpdaterEmpCode). Empty string is acceptable — the server can fall back to
   * device-level or full rollout.
   */
  private get empCode(): string {
    return this.app.updaterEmpCode || '';
  }

  private resolvePlatform(): string {
    const cpus = os.cpus();
    const isAppleSilicon =
      os.arch() === 'arm64' || (cpus.length > 0 && /Apple/i.test(cpus[0]?.model || ''));
    return isAppleSilicon ? 'Mac_ARM' : 'Mac';
  }

  /**
   * Call the SOA endpoint and normalize its response.
   * Returns { url (proxy feed), newVersion, downloadUrl } when an update is available.
   */
  private async requestUpdateInfo(): Promise<{
    downloadUrl?: string;
    newVersion?: string;
    url?: string;
  } | null> {
    // --- QA mock: exercise the post-SOA flow without the real update center ---
    // When MAC_UPDATE_MOCK_URL is set, skip the SOA call and pretend the server
    // returned that downloadUrl. The rest of the pipeline (proxy → Squirrel.Mac
    // download → signature check → install → relaunch) runs for real, so we can
    // verify everything after the interface against a locally served zip.
    const mockUrl = process.env.MAC_UPDATE_MOCK_URL;
    if (mockUrl) {
      const mockVersion = process.env.MAC_UPDATE_MOCK_VERSION || '1.0.2';
      logger.warn(`[MOCK] MAC_UPDATE_MOCK_URL set, skipping SOA. url=${mockUrl} v=${mockVersion}`);
      const updateInfo = { downloadUrl: mockUrl, versionName: mockVersion };
      const proxyFeedUrl = await macUpdateProxy.setProxyRes(updateInfo);
      return {
        downloadUrl: updateInfo.downloadUrl,
        newVersion: updateInfo.versionName,
        url: proxyFeedUrl,
      };
    }

    const buildInfo = getBuildInfo();
    const env = (buildInfo.hybridEnv || 'PROD').toUpperCase();
    const cfg = CFG[env] || CFG.PROD;
    // TripYoYo has no intranet/extranet detection yet; default to extranet.
    const url = cfg.extranet;

    const requestBody = {
      appId: buildInfo.app_id || '900016',
      buildId: buildInfo.build_id,
      currentType: 'GA',
      employee: this.empCode,
      env: 'product',
      head: { cid: this.empCode, cver: buildInfo.versionCode },
      locale: 'zh-CN',
      platform: this.resolvePlatform(),
    };

    logger.info(`Requesting update info: ${url}, platform=${requestBody.platform}`);
    logger.debug(`Request body: ${JSON.stringify(requestBody)}`);

    const response = await fetch(url, {
      body: JSON.stringify(requestBody),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`SOA request failed: HTTP ${response.status}`);
    }

    const ret = (await response.json()) as any;
    if (!ret?.updateInfo?.downloadUrl) {
      logger.info('No update available from server');
      return null;
    }

    const updateInfo = ret.updateInfo as {
      downloadUrl: string;
      versionCode?: string;
      versionName?: string;
    };

    // Optional intranet rewrite (kept from iDesk). Safe to leave as-is for extranet.
    const useOutside = getDesktopEnv().UPDATE_USE_OUTSIDE;
    if (!useOutside) {
      updateInfo.downloadUrl = updateInfo.downloadUrl.replace(
        'download2.ctrip.com',
        'download2.ctripcorp.com',
      );
    }

    // Wrap the real download URL behind the local proxy so Squirrel.Mac can consume it.
    const proxyFeedUrl = await macUpdateProxy.setProxyRes(updateInfo);
    return {
      downloadUrl: updateInfo.downloadUrl,
      newVersion: updateInfo.versionName,
      url: proxyFeedUrl,
    };
  }

  private startDownload(feedURL: string) {
    if (this.working) return;
    this.working = true;
    logger.info(`Starting Squirrel.Mac download via feed: ${feedURL}`);

    this.setStage('downloading', {
      updateInfo: { releaseDate: new Date().toISOString(), version: this.newVersion },
    });

    try {
      autoUpdater.setFeedURL({ url: feedURL } as any);
      autoUpdater.checkForUpdates();
    } catch (e) {
      this.working = false;
      // Reset so a manual "check for updates" can retry after a failed download/install.
      this.newVersion = '';
      const message = e instanceof Error ? e.message : String(e);
      logger.error('autoUpdater error:', message);
      this.setStage('error', { error: message });
    }
  }

  private registerEvents() {
    autoUpdater.on('error', (message: any) => {
      this.working = false;
      // Reset so a manual "check for updates" can retry after a failed download/install
      // (e.g. Squirrel signature validation failure). Otherwise the newVersion guard in
      // checkForUpdates would skip every subsequent check until the app restarts.
      this.newVersion = '';
      const msg = message instanceof Error ? message.message : String(message);
      logger.error('[MacUpdater] error', msg);
      this.setStage('error', { error: msg });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    });

    autoUpdater.on('update-available', () => {
      logger.info('[MacUpdater] update-available');
    });

    autoUpdater.on('update-not-available', () => {
      logger.info('[MacUpdater] update-not-available');
      this.working = false;
      if (this.stage !== 'downloaded') {
        // No update materialized; clear so a later check can run again.
        this.newVersion = '';
        this.setStage('idle');
      }
    });

    // Custom event emitted by the proxy while downloading the zip.
    autoUpdater.on('update-progress' as any, (state: any) => {
      if (state?.error === true) {
        this.working = false;
        // Proxy download failed; clear so a manual re-check isn't permanently skipped.
        this.newVersion = '';
        return;
      }
      const progress: ProgressInfo = {
        bytesPerSecond: 0,
        percent: state?.percent ?? 0,
        total: 0,
        transferred: 0,
      };
      this.latestProgress = progress;
      this.mainWindow.broadcast('updaterStateChanged', this.getUpdaterState());
      this.mainWindow.broadcast('updateDownloadProgress', progress);
    });

    autoUpdater.on('update-downloaded', (...args: any[]) => {
      logger.info('[MacUpdater] update-downloaded', args?.[4]);
      this.working = false;
      const info: UpdateInfo = {
        releaseDate: new Date().toISOString(),
        version: this.newVersion,
      };
      this.setStage('downloaded', { updateInfo: info });
      this.mainWindow.broadcast('updateDownloaded', info);
      if (this.timer) clearInterval(this.timer);
    });
  }
}
