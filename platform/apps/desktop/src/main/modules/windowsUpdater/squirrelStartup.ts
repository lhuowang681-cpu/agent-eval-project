import { spawn } from 'node:child_process';
import path from 'node:path';

import { app } from 'electron';

import { createLogger } from '@/utils/logger';

const logger = createLogger('modules:windowsUpdater:squirrelStartup');

const runUpdateExe = (args: string[], done: () => void) => {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  logger.info(`Spawning '${updateExe}' with args '${args.join(' ')}'`);
  spawn(updateExe, args, { detached: true }).on('close', done);
};

export const handleSquirrelStartup = (): boolean => {
  if (process.platform !== 'win32') return false;

  const command = process.argv[1];
  if (!command?.startsWith('--squirrel-')) return false;

  const target = path.basename(process.execPath);
  logger.info(`Processing Squirrel.Windows command: ${command}`);

  if (command === '--squirrel-install' || command === '--squirrel-updated') {
    runUpdateExe([`--createShortcut=${target}`], () => app.quit());
    return true;
  }

  if (command === '--squirrel-uninstall') {
    runUpdateExe([`--removeShortcut=${target}`], () => app.quit());
    return true;
  }

  if (command === '--squirrel-obsolete') {
    app.quit();
    return true;
  }

  return false;
};
