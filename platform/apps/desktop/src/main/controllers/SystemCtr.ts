import process from 'node:process';

import type { ElectronAppState, ThemeMode } from '@lobechat/electron-client-ipc';
import { app, dialog, nativeTheme, session, shell } from 'electron';
import { macOS } from 'electron-is';
import { pathExists, readdir } from 'fs-extra';

import { legacyLocalDbDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';
import {
  getAccessibilityStatus,
  getFullDiskAccessStatus,
  getMediaAccessStatus,
  openFullDiskAccessSettings,
  requestAccessibilityAccess,
  requestMicrophoneAccess,
  requestScreenCaptureAccess,
} from '@/utils/permissions';

import { ControllerModule, IpcMethod } from './index';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';

const logger = createLogger('controllers:SystemCtr');

export default class SystemController extends ControllerModule {
  static override readonly groupName = 'system';
  private systemThemeListenerInitialized = false;

  /**
   * Initialize system theme listener when app is ready
   */
  afterAppReady() {
    this.initializeSystemThemeListener();
  }

  /**
   * Handles the 'getDesktopAppState' IPC request.
   * Gathers essential application and system information.
   */
  @IpcMethod()
  async getAppState(): Promise<ElectronAppState> {
    const platform = process.platform;
    const arch = process.arch;

    return {
      // System Info
      arch,
      isLinux: platform === 'linux',
      isMac: platform === 'darwin',
      isWindows: platform === 'win32',
      locale: this.app.storeManager.get('locale', 'auto'),

      platform: platform as 'darwin' | 'win32' | 'linux',
      userPath: {
        // User Paths (ensure keys match UserPathData / DesktopAppState interface)
        desktop: app.getPath('desktop'),
        documents: app.getPath('documents'),
        downloads: app.getPath('downloads'),
        home: app.getPath('home'),
        music: app.getPath('music'),
        pictures: app.getPath('pictures'),
        userData: app.getPath('userData'),
        videos: app.getPath('videos'),
      },
    };
  }

  @IpcMethod()
  requestAccessibilityAccess() {
    return requestAccessibilityAccess();
  }

  @IpcMethod()
  getAccessibilityStatus() {
    const status = getAccessibilityStatus();
    return status === 'granted';
  }

  @IpcMethod()
  getFullDiskAccessStatus(): boolean {
    const status = getFullDiskAccessStatus();
    return status === 'granted';
  }

  /**
   * Prompt the user with a native dialog if Full Disk Access is not granted.
   *
   * @param options - Dialog options
   * @returns 'granted' if already granted, 'opened_settings' if user chose to open settings,
   *          'skipped' if user chose to skip, 'cancelled' if dialog was cancelled
   */
  @IpcMethod()
  async promptFullDiskAccessIfNotGranted(options?: {
    message?: string;
    openSettingsButtonText?: string;
    skipButtonText?: string;
    title?: string;
  }): Promise<'cancelled' | 'granted' | 'opened_settings' | 'skipped'> {
    // Check if already granted
    const status = getFullDiskAccessStatus();
    if (status === 'granted') {
      logger.info('[FullDiskAccess] Already granted, skipping prompt');
      return 'granted';
    }

    if (!macOS()) {
      logger.info('[FullDiskAccess] Not macOS, returning granted');
      return 'granted';
    }

    const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;

    // Get localized strings
    const t = this.app.i18n.ns('dialog');
    const title = options?.title || t('fullDiskAccess.title');
    const message = options?.message || t('fullDiskAccess.message');
    const openSettingsButtonText =
      options?.openSettingsButtonText || t('fullDiskAccess.openSettings');
    const skipButtonText = options?.skipButtonText || t('fullDiskAccess.skip');

    logger.info('[FullDiskAccess] Showing native prompt dialog');

    const result = await dialog.showMessageBox(mainWindow!, {
      buttons: [openSettingsButtonText, skipButtonText],
      cancelId: 1,
      defaultId: 0,
      message,
      title,
      type: 'info',
    });

    if (result.response === 0) {
      // User chose to open settings
      logger.info('[FullDiskAccess] User chose to open settings');
      await this.openFullDiskAccessSettings();
      return 'opened_settings';
    } else {
      // User chose to skip or cancelled
      logger.info('[FullDiskAccess] User chose to skip');
      return 'skipped';
    }
  }

  @IpcMethod()
  async getMediaAccessStatus(mediaType: 'microphone' | 'screen'): Promise<string> {
    return getMediaAccessStatus(mediaType);
  }

  @IpcMethod()
  async requestMicrophoneAccess(): Promise<boolean> {
    return requestMicrophoneAccess();
  }

  @IpcMethod()
  async requestScreenAccess(): Promise<boolean> {
    return requestScreenCaptureAccess();
  }

  @IpcMethod()
  async openFullDiskAccessSettings() {
    return openFullDiskAccessSettings();
  }

  @IpcMethod()
  openExternalLink(url: string) {
    return shell.openExternal(url);
  }

  @IpcMethod()
  async selectFolder(payload?: {
    defaultPath?: string;
    title?: string;
  }): Promise<string | undefined> {
    const mainWindow = this.app.browserManager.getMainWindow()?.browserWindow;

    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: payload?.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
      title: payload?.title || 'Select Folder',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return undefined;
    }

    return result.filePaths[0];
  }

  @IpcMethod()
  getSystemLocale(): string {
    return app.getLocale();
  }

  @IpcMethod()
  async updateLocale(locale: string) {
    this.app.storeManager.set('locale', locale);

    await this.app.i18n.changeLanguage(locale === 'auto' ? app.getLocale() : locale);
    this.app.browserManager.broadcastToAllWindows('localeChanged', { locale });

    return { success: true };
  }

  @IpcMethod()
  async updateThemeModeHandler(themeMode: ThemeMode) {
    this.app.storeManager.set('themeMode', themeMode);
    this.app.browserManager.broadcastToAllWindows('themeChanged', { themeMode });
    this.setSystemThemeMode(themeMode);
    this.app.browserManager.handleAppThemeChange();
  }

  @IpcMethod()
  async getSystemThemeMode() {
    return nativeTheme.themeSource;
  }

  /**
   * Detect whether user used the legacy local database in older desktop versions.
   * Legacy path: {app.getPath('userData')}/lobehub-storage/lobehub-local-db
   */
  @IpcMethod()
  async hasLegacyLocalDb(): Promise<boolean> {
    if (!(await pathExists(legacyLocalDbDir))) return false;

    try {
      const entries = await readdir(legacyLocalDbDir);
      return entries.length > 0;
    } catch {
      // If directory exists but cannot be read, treat as "used" to surface guidance.
      return true;
    }
  }

  /**
   * Clear the desktop app's runtime cache and sign-out the user, then reload
   * into the onboarding welcome screen. Wipes everything in the renderer's
   * local storage (cookies, localStorage, sessionStorage, service workers,
   * GPU/HTTP/code caches) and the remote-server/tokens in electron-store.
   *
   * Remote session/message data lives on the server (PostgreSQL via TRPC), not
   * in the browser, so it is untouched — re-login shows it again.
   *
   * Mirrors what `apps/desktop/scripts/clean-userdata.mjs` does to a running
   * session without deleting the userData directory on disk (which would crash
   * the live process).
   */
  @IpcMethod()
  async clearAppCache(): Promise<boolean> {
    logger.info('Clearing app cache and login state');

    // 1) Sign out: clear dataSyncConfig.active + encryptedTokens (store + in-memory)
    //    and broadcast remoteServerConfigUpdated so onboarding判定 flips to false.
    const remoteCtr = this.app.getController(RemoteServerConfigCtr);
    await remoteCtr?.clearRemoteServerConfig();

    // 2) Clear renderer session storage: cookies (login), service workers, cache
    //    shards, AND localStorage (canary toggle, UI prefs, onboarding markers —
    //    all of it). Keep indexdb untouched (it holds no business data in cloud
    //    mode, but we leave it alone to be safe). sessionStorage has no Electron
    //    clearStorageData storage type, so we wipe it via executeJavaScript below.
    const ses = session.defaultSession;
    await ses.clearStorageData({
      storages: ['cookies', 'serviceworkers', 'cachestorage', 'shadercache', 'localstorage'],
    });

    // 3) Clear disk HTTP cache and V8 code cache (safe to call while running,
    //    unlike fs.rmSync on the Cache subdirectories).
    await ses.clearCache();
    await ses.clearCodeCaches({});

    // 4) Wipe sessionStorage (Electron clearStorageData can't reach it) and
    //    re-wipe localStorage as a belt-and-suspenders in case step 2 missed
    //    anything. After this the renderer's entire browser storage is empty.
    const webContents = this.app.browserManager.getMainWindow()?.browserWindow.webContents;
    if (webContents) {
      await webContents.executeJavaScript(
        `try { sessionStorage.clear(); localStorage.clear(); } catch (e) {}`,
      );

      // 5) Navigate the main window to the onboarding welcome screen directly
      //    from the main process. This must happen here — not in the renderer —
      //    because `clearRemoteServerConfig` broadcasts `remoteServerConfigUpdated`,
      //    which trips AuthRequiredModal's force-login gate (active===false +
      //    onboarding-completed + not-on-onboarding-route → redirect to
      //    ?screen=login). That gate races the renderer's own location.replace
      //    and can win, landing the user on the login screen. A main-process
      //    loadURL is terminal: the page unloads before the gate effect runs,
      //    and the new URL's ?screen=welcome takes priority over any saved
      //    screen (which is now empty anyway). loadURL may throw if the dev
      //    server isn't up; the renderer handler has a client-side replace
      //    fallback for that case.
      const url = await this.app.buildRendererUrl('/desktop-onboarding?screen=welcome');
      await webContents.loadURL(url);
    }

    return true;
  }

  private async setSystemThemeMode(themeMode: ThemeMode) {
    nativeTheme.themeSource = themeMode;
  }

  private initializeSystemThemeListener() {
    if (this.systemThemeListenerInitialized) {
      logger.debug('System theme listener already initialized');
      return;
    }

    logger.info('Initializing system theme listener');

    // Listen for system theme changes
    nativeTheme.on('updated', () => {
      const isDarkMode = nativeTheme.shouldUseDarkColors;
      const systemTheme: ThemeMode = isDarkMode ? 'dark' : 'light';

      logger.info(`System theme changed to: ${systemTheme}`);

      // Broadcast system theme change to all renderer processes
      this.app.browserManager.broadcastToAllWindows('systemThemeChanged', {
        themeMode: systemTheme,
      });
    });

    this.systemThemeListenerInitialized = true;
    logger.info('System theme listener initialized successfully');
  }
}
