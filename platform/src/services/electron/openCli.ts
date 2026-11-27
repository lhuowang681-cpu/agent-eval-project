import { ensureElectronIpc } from '@/utils/electron/ipc';

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

class OpenCliService {
  /**
   * Detect the bundled OpenCLI and read its version.
   */
  getStatus = async (): Promise<OpenCliStatus> => {
    return ensureElectronIpc().openCli.getStatus();
  };

  /**
   * Run `opencli doctor` to verify Chrome extension / daemon connectivity.
   */
  runDoctor = async (): Promise<OpenCliDoctorResult> => {
    return ensureElectronIpc().openCli.runDoctor();
  };

  /**
   * Open the Chrome extension install page in the default browser.
   */
  openExtensionPage = async (): Promise<void> => {
    return ensureElectronIpc().openCli.openExtensionPage();
  };
}

export const openCliService = new OpenCliService();
