import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import { resourcesDir } from '@/const/dir';
import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:macUpdater:buildInfo');

/**
 * Build metadata written by build.py (MCD) into apps/desktop/resources/build-info.json
 * at build time. The file is bundled into the asar (see electron-builder.mjs `files`),
 * so the main process can read it at runtime.
 *
 * Needed by the auto-update SOA interface: the server matches versions / decides the
 * gray release by versionCode + build_id, and uses hybridEnv to pick the env.
 */
export interface BuildInfo {
  /** MCD app id, e.g. "900016" */
  app_id?: string;
  /** MCD build id (server matches the target version against this) */
  build_id?: string;
  buildTime?: number;
  /** Release channel (stable / nightly / canary) */
  channel?: string;
  /** Hybrid env: FAT / UAT / PROD */
  hybridEnv?: string;
  nativeEnv?: string;
  /** Version code, e.g. "100.000" */
  versionCode?: string;
  /** Semantic version name, e.g. "1.0.0" */
  versionName?: string;
}

let cached: BuildInfo | null | undefined;

/**
 * Read the bundled build-info.json. Returns null in dev / when the file is absent
 * (e.g. local builds that did not go through build.py).
 *
 * Falls back to app.getVersion() for versionName so callers always have a version.
 */
export const getBuildInfo = (): BuildInfo => {
  if (cached !== undefined) return cached ?? { versionName: app.getVersion() };

  const buildInfoPath = path.join(resourcesDir, 'build-info.json');

  try {
    if (existsSync(buildInfoPath)) {
      const raw = readFileSync(buildInfoPath, 'utf8');
      cached = JSON.parse(raw) as BuildInfo;
      logger.info(`Loaded build-info.json: ${JSON.stringify(cached)}`);
    } else {
      cached = null;
      logger.info(`build-info.json not found at ${buildInfoPath} (likely a local/dev build)`);
    }
  } catch (error) {
    cached = null;
    logger.warn(`Failed to read build-info.json: ${(error as Error).message}`);
  }

  // Always guarantee a versionName for the update request.
  const info = cached ?? {};
  if (!info.versionName) info.versionName = app.getVersion();
  return info;
};
