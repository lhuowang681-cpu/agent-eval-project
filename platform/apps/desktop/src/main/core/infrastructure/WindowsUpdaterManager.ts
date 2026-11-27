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
import { windowsUpdateProxy } from '@/modules/windowsUpdater/proxy';
import { createLogger } from '@/utils/logger';

import type { App as AppCore } from '../App';

const logger = createLogger('core:WindowsUpdaterManager');

const SOA_PATH = '/restapi/soa2/15766/json/getCommonAppUpdateInfo';
const PROD_URL = `https://apigateway.ctripcorp.com${SOA_PATH}`;
const FAT_URL = `https://gateway.m.fws.qa.nt.ctripcorp.com${SOA_PATH}`;
const UAT_URL = `https://gateway.m.uat.qa.nt.ctripcorp.com${SOA_PATH}`;
const CFG: Record<string, { extranet: string; intranet: string }> = {
  FAT: { extranet: FAT_URL, intranet: FAT_URL },
  PROD: { extranet: PROD_URL, intranet: PROD_URL },
  UAT: { extranet: UAT_URL, intranet: UAT_URL },
};

export class WindowsUpdaterManager {
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

  public initialize = async () => {
    logger.info('Initializing WindowsUpdaterManager');

    if (!electronApp.isPackaged) {
      logger.info('Not packaged, skipping Windows auto-update');
      return;
    }

    windowsUpdateProxy.start();
    this.registerEvents();

    if (process.env.WINDOWS_UPDATE_MOCK_URL) {
      logger.warn('[MOCK] WINDOWS_UPDATE_MOCK_URL set, scheduling immediate update check (3s)');
      setTimeout(() => this.checkForUpdates({ manual: true }), 3000);
      return;
    }

    const min = 1 * 60 * 1000;
    const max = 60 * 60 * 1000;
    const timeout = Math.floor(Math.random() * (max - min + 1)) + min;
    logger.info(`Windows auto-update check interval: ${timeout}ms`);

    setTimeout(() => this.checkForUpdates(), timeout);
    this.timer = setInterval(() => this.checkForUpdates(), timeout + 10 * 60 * 1000);

    logger.info('WindowsUpdaterManager initialization completed');
  };

  public checkForUpdates = async ({ manual = false }: { manual?: boolean } = {}) => {
    if (this.newVersion) {
      logger.info('New version already detected, skipping check');
      return;
    }

    logger.info(`${manual ? 'Manually' : 'Auto'} checking for updates (windows)...`);
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
      logger.error('Windows update check failed:', message);
      this.setStage('error', { error: message });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    }
  };

  public downloadUpdate = async () => {
    logger.debug('downloadUpdate() is a no-op on Windows (download starts on check)');
  };

  public installNow = () => {
    logger.info('Windows: quit and install now');
    this.app.isQuiting = true;
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      logger.error('quitAndInstall error:', error);
    }
  };

  public installLater = () => {
    logger.info('Windows: update will install on next restart');
    this.mainWindow.broadcast('updateWillInstallLater');
  };

  public switchChannel = (_channel: UpdateChannel) => {
    logger.info('switchChannel is a no-op on Windows (gray release is server-controlled)');
  };

  public getUpdaterState = (): UpdaterState => {
    const state: UpdaterState = { stage: this.stage };
    if (this.latestProgress) state.progress = this.latestProgress;
    if (this.latestUpdateInfo) state.updateInfo = this.latestUpdateInfo;
    if (this.latestError) state.errorMessage = this.latestError;
    return state;
  };

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

  private get empCode(): string {
    return this.app.updaterEmpCode || '';
  }

  private async requestUpdateInfo(): Promise<{
    downloadUrl?: string;
    newVersion?: string;
    url?: string;
  } | null> {
    const mockUrl = process.env.WINDOWS_UPDATE_MOCK_URL;
    if (mockUrl) {
      const mockVersion = process.env.WINDOWS_UPDATE_MOCK_VERSION || '1.0.2';
      logger.warn(
        `[MOCK] WINDOWS_UPDATE_MOCK_URL set, skipping SOA. url=${mockUrl} v=${mockVersion}`,
      );
      return {
        downloadUrl: mockUrl,
        newVersion: mockVersion,
        url: mockUrl,
      };
    }

    const buildInfo = getBuildInfo();
    const env = (buildInfo.hybridEnv || 'PROD').toUpperCase();
    const cfg = CFG[env] || CFG.PROD;
    const url = cfg.extranet;

    const requestBody = {
      appId: buildInfo.app_id || '900016',
      buildId: buildInfo.build_id,
      currentType: 'GA',
      employee: this.empCode,
      env: 'product',
      head: { cid: this.empCode, cver: buildInfo.versionCode },
      locale: 'zh-CN',
      platform: 'Windows',
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
      buildId?: string;
      downloadUrl: string;
      versionCode?: string;
      versionName?: string;
    };

    const useOutside = getDesktopEnv().UPDATE_USE_OUTSIDE;
    if (!useOutside) {
      updateInfo.downloadUrl = updateInfo.downloadUrl.replace(
        'download2.ctrip.com',
        'download2.ctripcorp.com',
      );
    }

    return {
      downloadUrl: updateInfo.downloadUrl,
      newVersion: updateInfo.versionName,
      url: updateInfo.downloadUrl,
    };
  }

  private startDownload(feedURL: string) {
    if (this.working) return;
    this.working = true;
    logger.info(`Starting Squirrel.Windows download via feed: ${feedURL}`);

    this.setStage('downloading', {
      updateInfo: { releaseDate: new Date().toISOString(), version: this.newVersion },
    });

    try {
      autoUpdater.setFeedURL({ url: feedURL } as any);
      autoUpdater.checkForUpdates();
    } catch (error) {
      this.working = false;
      this.newVersion = '';
      const message = error instanceof Error ? error.message : String(error);
      logger.error('autoUpdater error:', message);
      this.setStage('error', { error: message });
    }
  }

  private registerEvents() {
    autoUpdater.on('error', (message: Error | string) => {
      this.working = false;
      this.newVersion = '';
      const msg = message instanceof Error ? message.message : String(message);
      logger.error('[WindowsUpdater] error', msg);
      this.setStage('error', { error: msg });
      setTimeout(() => {
        if (this.stage === 'error') this.setStage('idle');
      }, 3000);
    });

    autoUpdater.on('update-available', () => {
      logger.info('[WindowsUpdater] update-available');
    });

    autoUpdater.on('update-not-available', () => {
      logger.info('[WindowsUpdater] update-not-available');
      this.working = false;
      if (this.stage !== 'downloaded') {
        this.newVersion = '';
        this.setStage('idle');
      }
    });

    autoUpdater.on('update-progress' as any, (state: any) => {
      if (state?.error === true) {
        this.working = false;
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
      logger.info('[WindowsUpdater] update-downloaded', args?.[4]);
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
