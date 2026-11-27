import type { GatewayConnectionStatus } from '@lobechat/electron-client-ipc';

import { ensureElectronIpc } from '@/utils/electron/ipc';

export interface GatewayDeviceInfo {
  description: string;
  deviceId: string;
  hostname: string;
  name: string;
  platform: string;
}

/**
 * Renderer-side facade for the desktop "connect this machine as an execution
 * device" controls (GatewayConnectionCtr in the Electron main process). Only
 * meaningful on desktop; callers gate on `isDesktop`.
 */
class GatewayConnectionService {
  connect = async (): Promise<{ error?: string; success: boolean }> => {
    return ensureElectronIpc().gatewayConnection.connect();
  };

  /** Best-effort connect that respects a prior explicit `disconnect()` opt-out. */
  connectIfEnabled = async (): Promise<{ error?: string; success: boolean }> => {
    return ensureElectronIpc().gatewayConnection.connectIfEnabled();
  };

  disconnect = async (): Promise<{ success: boolean }> => {
    return ensureElectronIpc().gatewayConnection.disconnect();
  };

  getConnectionStatus = async (): Promise<GatewayConnectionStatus> => {
    const { status } = await ensureElectronIpc().gatewayConnection.getConnectionStatus();
    return status;
  };

  getDeviceInfo = async (): Promise<GatewayDeviceInfo> => {
    return ensureElectronIpc().gatewayConnection.getDeviceInfo();
  };

  setDeviceName = async (name: string): Promise<{ success: boolean }> => {
    return ensureElectronIpc().gatewayConnection.setDeviceName({ name });
  };

  setDeviceDescription = async (description: string): Promise<{ success: boolean }> => {
    return ensureElectronIpc().gatewayConnection.setDeviceDescription({ description });
  };
}

export const gatewayConnectionService = new GatewayConnectionService();
