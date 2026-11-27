import type { CreateServicesResult, IpcServiceConstructor, MergeIpcService } from '@/utils/ipc';

import AuthCtr from './AuthCtr';
import BrowserWindowsCtr from './BrowserWindowsCtr';
import DevtoolsCtr from './DevtoolsCtr';
import FeishuCliCtr from './FeishuCliCtr';
import GatewayConnectionCtr from './GatewayConnectionCtr';
import GitCtr from './GitCtr';
import LocalFileCtr from './LocalFileCtr';
import McpCtr from './McpCtr';
import McpInstallCtr from './McpInstallCtr';
import MenuController from './MenuCtr';
import NetworkProxyCtr from './NetworkProxyCtr';
import NotificationCtr from './NotificationCtr';
import OpenCliCtr from './OpenCliCtr';
import PowerCtr from './PowerCtr';
import RemoteServerConfigCtr from './RemoteServerConfigCtr';
import RemoteServerSyncCtr from './RemoteServerSyncCtr';
import ShellCommandCtr from './ShellCommandCtr';
import ShortcutController from './ShortcutCtr';
import SystemController from './SystemCtr';
import ToolDetectorCtr from './ToolDetectorCtr';
import TrayMenuCtr from './TrayMenuCtr';
import UpdaterCtr from './UpdaterCtr';
import UploadFileCtr from './UploadFileCtr';
import WebCrawlerCtr from './WebCrawlerCtr';

export const controllerIpcConstructors = [
  AuthCtr,
  BrowserWindowsCtr,
  DevtoolsCtr,
  FeishuCliCtr,
  GatewayConnectionCtr,
  GitCtr,
  LocalFileCtr,
  McpCtr,
  McpInstallCtr,
  MenuController,
  NetworkProxyCtr,
  NotificationCtr,
  OpenCliCtr,
  PowerCtr,
  RemoteServerConfigCtr,
  RemoteServerSyncCtr,
  ShellCommandCtr,
  ShortcutController,
  SystemController,
  ToolDetectorCtr,
  TrayMenuCtr,
  UpdaterCtr,
  UploadFileCtr,
  WebCrawlerCtr,
] as const satisfies readonly IpcServiceConstructor[];

type DesktopControllerIpcConstructors = typeof controllerIpcConstructors;
type DesktopControllerServices = CreateServicesResult<DesktopControllerIpcConstructors>;
export type DesktopIpcServices = MergeIpcService<DesktopControllerServices>;
