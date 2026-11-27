import type { UpdateChannel, UpdaterState } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

class AutoUpdateService {
  checkUpdate = async () => {
    return ensureElectronIpc().autoUpdate.checkForUpdates();
  };

  installNow = async () => {
    return ensureElectronIpc().autoUpdate.quitAndInstallUpdate();
  };

  installLater = async () => {
    return ensureElectronIpc().autoUpdate.installLater();
  };

  downloadUpdate() {
    return ensureElectronIpc().autoUpdate.downloadUpdate();
  }

  getUpdateChannel = async (): Promise<UpdateChannel> => {
    return ensureElectronIpc().autoUpdate.getUpdateChannel();
  };

  getBuildChannel = async (): Promise<string> => {
    return ensureElectronIpc().autoUpdate.getBuildChannel();
  };

  setUpdateChannel = async (channel: UpdateChannel): Promise<void> => {
    return ensureElectronIpc().autoUpdate.setUpdateChannel(channel);
  };

  getUpdaterState = async (): Promise<UpdaterState> => {
    return ensureElectronIpc().autoUpdate.getUpdaterState();
  };

  /**
   * Feed the employee id (the user's `username`) to the macOS updater so the server
   * can apply gray release. No-op effect on non-mac platforms (the main process
   * stores it but only MacUpdaterManager uses it).
   */
  setUpdaterEmpCode = async (empCode: string): Promise<void> => {
    return ensureElectronIpc().autoUpdate.setUpdaterEmpCode(empCode);
  };
}

export const autoUpdateService = new AutoUpdateService();
