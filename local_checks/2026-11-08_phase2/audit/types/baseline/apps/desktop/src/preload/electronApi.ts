import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, webUtils } from 'electron';

import { invoke } from './invoke';
import { onStreamInvoke } from './streamer';

export const setupElectronApi = () => {
  // Use `contextBridge` APIs to expose Electron APIs to
  // renderer only if context isolation is enabled, otherwise
  // just add to the DOM global.

  try {
    contextBridge.exposeInMainWorld('electron', electronAPI);
  } catch (error) {
    console.error(error);
  }

  contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    invoke,
    onStreamInvoke,
  });

  const os = require('node:os');
  const osInfo = os.release();
  const darwinMajorVersion = Number(osInfo.split('.')[0]);

  contextBridge.exposeInMainWorld('lobeEnv', {
    chromeVersion: process.versions.chrome,
    darwinMajorVersion,
    // Lets a desktop build default the bastion (canary) routing switch to on
    // (statically replaced at build stage, see electron.vite.config.ts define).
    defaultEnableCanary: process.env.DEFAULT_ENABLE_CANARY === 'true',
    electronVersion: process.versions.electron,
    isMacTahoe: process.platform === 'darwin' && darwinMajorVersion >= 25,
    nodeVersion: process.versions.node,
    // The cloud server this desktop build connects to (statically replaced at
    // build stage, see electron.vite.config.ts define). Exposed synchronously so
    // the renderer can derive share/login/avatar URLs matching the real server
    // domain instead of the upstream OFFICIAL_URL.
    officialCloudServer:
      process.env.OFFICIAL_CLOUD_SERVER || 'https://calcifer.train.ctripcorp.com',
    platform: process.platform,
  });
};
