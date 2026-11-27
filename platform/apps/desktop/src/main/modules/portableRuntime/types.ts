export type RuntimeName = 'node' | 'python' | 'bun' | 'uv' | 'rg' | 'fd';
export type PlatformKey = 'win32-x64' | 'win32-arm64' | 'darwin-arm64' | 'darwin-x64';
/**
 * `raw` means the "archive" is actually a single executable binary (e.g. pnpm).
 * PortableRuntimeManager copies it into the runtime dir and renames it to the
 * platform's `executable` name.
 */
export type ArchiveFormat = 'tar.gz' | 'tar.xz' | 'zip' | 'raw';

export interface PlatformEntry {
  archiveName?: string;
  format: ArchiveFormat;
  rootPrefix: string;
  sha256?: string;
  url: string;
}

export interface RuntimeEntry {
  binSubdir: { darwin: string; win32: string };
  executable: { darwin: string; win32: string };
  platforms: Partial<Record<PlatformKey, PlatformEntry>>;
  releaseTag?: string;
  shasumsUrl?: string;
  version: string;
}

export interface RuntimeManifest {
  bun: RuntimeEntry;
  fd: RuntimeEntry;
  node: RuntimeEntry;
  python: RuntimeEntry;
  rg: RuntimeEntry;
  uv: RuntimeEntry;
}

export type InstallPhase = 'download' | 'verify' | 'extract' | 'switch' | 'done' | 'error';

export interface InstallProgressEvent {
  downloaded?: number;
  error?: string;
  message?: string;
  percent?: number;
  phase: InstallPhase;
  toolName: RuntimeName;
  total?: number;
}

export interface InstalledRuntime {
  installedAt: string;
  name: RuntimeName;
  sha256: string;
  sourceUrl: string;
  version: string;
}

export interface RuntimeInstallResult {
  error?: string;
  skipped?: boolean;
  success: boolean;
  toolName: RuntimeName;
  version?: string;
}

export interface RuntimeUninstallResult {
  alreadyGone?: boolean;
  error?: string;
  success: boolean;
  toolName: RuntimeName;
}

export interface RuntimeMetaFile {
  downloadedAt: string;
  platformKey: PlatformKey;
  sha256: string;
  sourceUrl: string;
  version: string;
}
