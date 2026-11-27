import type { InstallProgressEvent } from '../types/toolDetector';

export interface ToolDetectorBroadcastEvents {
  toolInstallProgress: (event: InstallProgressEvent) => void;
}
