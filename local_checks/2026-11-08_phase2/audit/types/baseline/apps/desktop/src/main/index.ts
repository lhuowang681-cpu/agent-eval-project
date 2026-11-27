import { getCACertificates, setDefaultCACertificates } from 'node:tls';

import { app as electronApp } from 'electron';
import fixPath from 'fix-path';

import { App } from './core/App';
import { handleSquirrelStartup } from './modules/windowsUpdater/squirrelStartup';
import { createLogger } from './utils/logger';

const logger = createLogger('main:index');

// Intranet deployments talk to backends signed by the corporate CA
// (e.g. *.ctripcorp.com / calcifer.*, including the device gateway's wss://)
// which Node's bundled CA list doesn't trust by default, failing every
// HTTPS/WSS request with "unable to verify the first certificate".
//
// The Node CLI flag `--use-system-ca` would fix this, but packaged Electron
// apps silently drop NODE_OPTIONS except for `--max-http-header-size` and
// `--http-parser` (see electronjs.org/docs/latest/api/environment-variables) —
// a previous fix that injected `--use-system-ca` via NODE_OPTIONS + relaunch
// had zero effect once packaged, since the flag isn't in that allowlist.
// Calling the JS-level tls API instead merges the OS keychain's trusted CAs
// into Node's default trust store directly: identical behavior in dev and
// packaged builds, no relaunch, no dev/packaged branching needed.
try {
  setDefaultCACertificates([...getCACertificates('default'), ...getCACertificates('system')]);
} catch (error) {
  logger.error('Failed to merge system CA certificates into default trust store:', error);
}

if (handleSquirrelStartup()) {
  electronApp.exit(0);
}

// Must run before `new App()`: fix-path REPLACES process.env.PATH with the
// login-shell PATH. The App constructor appends the bundled binaries dir
// (Resources/bin) to process.env.PATH, so it has to run AFTER fixPath();
// otherwise the append gets clobbered and bundled CLIs become unresolvable.
fixPath();

const app = new App();

app.bootstrap();
