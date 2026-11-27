import type { GatewayBroadcastEvents } from './gateway';
import type { NavigationBroadcastEvents } from './navigation';
import type { ProtocolBroadcastEvents } from './protocol';
import type { RemoteServerBroadcastEvents } from './remoteServer';
import type { SystemBroadcastEvents } from './system';
import type { ToolDetectorBroadcastEvents } from './toolDetector';
import type { AutoUpdateBroadcastEvents } from './update';

/**
 * main -> render broadcast events
 */

export interface MainBroadcastEvents
  extends
    AutoUpdateBroadcastEvents,
    GatewayBroadcastEvents,
    NavigationBroadcastEvents,
    RemoteServerBroadcastEvents,
    SystemBroadcastEvents,
    ToolDetectorBroadcastEvents,
    ProtocolBroadcastEvents {}

export type MainBroadcastEventKey = keyof MainBroadcastEvents;

export type MainBroadcastParams<T extends MainBroadcastEventKey> = Parameters<
  MainBroadcastEvents[T]
>[0];

export type { GatewayConnectionStatus } from './gateway';
export type {
  AuthorizationPhase,
  AuthorizationProgress,
  MarketAuthorizationParams,
} from './remoteServer';
export type { OpenSettingsWindowOptions } from './windows';
