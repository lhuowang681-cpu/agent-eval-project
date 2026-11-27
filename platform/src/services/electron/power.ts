import { ensureElectronIpc } from '@/utils/electron/ipc';

class PowerService {
  getPreventSleep = async (): Promise<boolean> => {
    return ensureElectronIpc().power.getPreventSleep();
  };

  setPreventSleep = async (enabled: boolean): Promise<{ error?: string; success: boolean }> => {
    return ensureElectronIpc().power.setPreventSleep(enabled);
  };
}

export const powerService = new PowerService();
