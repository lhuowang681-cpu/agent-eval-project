/**
 * Connection lifecycle of the desktop ↔ device-gateway WebSocket. Mirrors
 * `ConnectionStatus` in `@lobechat/device-gateway-client` (kept as an
 * independent copy so this zero-dep IPC package doesn't depend on the gateway
 * client).
 */
export type GatewayConnectionStatus =
  | 'authenticating'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting';

/**
 * Gateway connection events broadcast from the main process so the renderer can
 * reflect whether this desktop is currently online as an execution device.
 */
export interface GatewayBroadcastEvents {
  gatewayConnectionStatusChanged: (data: { status: GatewayConnectionStatus }) => void;
}
