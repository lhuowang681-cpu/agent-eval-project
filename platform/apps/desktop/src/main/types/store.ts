import type {
  DataSyncConfig,
  NetworkProxySettings,
  UpdateChannel,
} from '@lobechat/electron-client-ipc';

export interface ElectronMainStore {
  dataSyncConfig: DataSyncConfig;
  encryptedTokens: {
    accessToken?: string;
    expiresAt?: number;
    lastRefreshAt?: number;
    refreshToken?: string;
  };
  /** User-facing description for this device in the gateway device list. */
  gatewayDeviceDescription?: string;
  /**
   * Per-install random UUID. Doubles as the pre-login device id and the gateway
   * connection-dedupe key; the stable machine-derived deviceId replaces it for
   * routing once a user is known (see `resolveDeviceIdentity`).
   */
  gatewayDeviceId?: string;
  /** User-facing name for this device in the gateway device list. */
  gatewayDeviceName?: string;
  /**
   * Whether this desktop should auto-connect to the device gateway as an
   * execution device. Defaults ON: when unset (first run) the desktop
   * auto-connects; only an explicit user opt-out persists `false`.
   */
  gatewayEnabled?: boolean;
  /** Optional gateway URL override (otherwise env / default). */
  gatewayUrl?: string;
  locale: string;
  networkProxy: NetworkProxySettings;
  /**
   * Per-machine "keep awake" preference. When true, the desktop holds a
   * `powerSaveBlocker` and (on macOS) sets `pmset disablesleep 1` so the machine
   * — even with the lid closed — stays awake and keeps the device-gateway
   * WebSocket alive for scheduled tasks. Defaults OFF. Not synced to the cloud
   * user settings because it is inherently a property of this physical device.
   */
  preventSleep?: boolean;
  shortcuts: Record<string, string>;
  storagePath: string;
  themeMode: 'dark' | 'light' | 'system';
  updateChannel: UpdateChannel;
}

export type StoreKey = keyof ElectronMainStore;
