import type {
  PlatformEntry,
  PlatformKey,
  RuntimeEntry,
  RuntimeManifest,
  RuntimeName,
} from './types';

export class UnsupportedPlatformError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UnsupportedPlatformError';
  }
}

export const RUNTIME_MANIFEST: RuntimeManifest = {
  node: {
    binSubdir: { darwin: 'bin', win32: '.' },
    executable: { darwin: 'node', win32: 'node.exe' },
    platforms: {
      'darwin-arm64': {
        archiveName: 'node-v24.14.0-darwin-arm64.tar.xz',
        format: 'tar.xz',
        rootPrefix: 'node-v24.14.0-darwin-arm64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-arm64.tar.xz',
      },
      'darwin-x64': {
        archiveName: 'node-v24.14.0-darwin-x64.tar.xz',
        format: 'tar.xz',
        rootPrefix: 'node-v24.14.0-darwin-x64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-darwin-x64.tar.xz',
      },
      'win32-arm64': {
        archiveName: 'node-v24.14.0-win-arm64.zip',
        format: 'zip',
        rootPrefix: 'node-v24.14.0-win-arm64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-win-arm64.zip',
      },
      'win32-x64': {
        archiveName: 'node-v24.14.0-win-x64.zip',
        format: 'zip',
        rootPrefix: 'node-v24.14.0-win-x64/',
        url: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip',
      },
    },
    shasumsUrl: 'http://mirrors.ops.ctripcorp.com/nodejs.org/dist/v24.14.0/SHASUMS256.txt',
    version: '24.14.0',
  },
  python: {
    binSubdir: { darwin: 'bin', win32: '.' },
    executable: { darwin: 'python3', win32: 'python.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: '3724aa4dafb5f7b6c2cf98e89914e4248dc6bd2fe40407df4a2d73de99615f16',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-aarch64-apple-darwin-install_only.tar.gz',
      },
      'darwin-x64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: '7c57fdd1fa675190093700eb0d8e7117e1f9eae7c30a46dea5f8d5266bcfc791',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-x86_64-apple-darwin-install_only.tar.gz',
      },
      'win32-arm64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: 'd459934cc52d28212a438cb6c9cfcb5396a8f23ed74cb47744d7af7fac618ad8',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-aarch64-pc-windows-msvc-install_only.tar.gz',
      },
      'win32-x64': {
        format: 'tar.gz',
        rootPrefix: 'python/',
        sha256: 'c6af85bb83d5158c9ff71f50dfad467853d1cd236f932b144e87e26e2ea2a83e',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/cpython-3.12.13+20260623-x86_64-pc-windows-msvc-install_only.tar.gz',
      },
    },
    releaseTag: '20260623',
    version: '3.12.13',
  },
  bun: {
    binSubdir: { darwin: '.', win32: '.' },
    executable: { darwin: 'bun', win32: 'bun.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'zip',
        rootPrefix: 'bun-darwin-aarch64/',
        sha256: 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/bun-v1.3.14-darwin-aarch64.zip',
      },
      'darwin-x64': {
        format: 'zip',
        rootPrefix: 'bun-darwin-x64/',
        sha256: '4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/bun-v1.3.14-darwin-x64.zip',
      },
      'win32-arm64': {
        format: 'zip',
        rootPrefix: 'bun-windows-aarch64/',
        sha256: '89841f5a57f2348b67ec0839b718f4bf4ea7d07c371c9ba4b77b6c790f918953',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/bun-v1.3.14-windows-aarch64.zip',
      },
      'win32-x64': {
        format: 'zip',
        rootPrefix: 'bun-windows-x64/',
        sha256: '0a0620930b6675d7ba440e81f4e0e00d3cfbe096c4b140d3fff02205e9e18922',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/bun-v1.3.14-windows-x64.zip',
      },
    },
    version: '1.3.14',
  },
  uv: {
    binSubdir: { darwin: '.', win32: '.' },
    executable: { darwin: 'uv', win32: 'uv.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'tar.gz',
        rootPrefix: 'uv-aarch64-apple-darwin/',
        sha256: '8f7fbf1708399b921857bce71e1d60f0d3ccf52a30caebc1c1a2f175dce13ab6',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/uv-v0.11.26-aarch64-apple-darwin.tar.gz',
      },
      'darwin-x64': {
        format: 'tar.gz',
        rootPrefix: 'uv-x86_64-apple-darwin/',
        sha256: '922b460202707dd5f4ccacbadbe7f6a546cc46e82a99bf50ca99a7977a78eddd',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/uv-v0.11.26-x86_64-apple-darwin.tar.gz',
      },
      'win32-arm64': {
        format: 'zip',
        rootPrefix: '',
        sha256: '98246149741f558e25e45ecf2b0b20f34de0634269f2bf0dcb4012d4b6ba289a',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/uv-v0.11.26-aarch64-pc-windows-msvc.zip',
      },
      'win32-x64': {
        format: 'zip',
        rootPrefix: '',
        sha256: '4e1278ede866be6c0bf32d2f466cc6de7a9fb399ecf20c9ce2d186e52424be47',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/uv-v0.11.26-x86_64-pc-windows-msvc.zip',
      },
    },
    version: '0.11.26',
  },
  rg: {
    binSubdir: { darwin: '.', win32: '.' },
    executable: { darwin: 'rg', win32: 'rg.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'tar.gz',
        rootPrefix: 'ripgrep-15.1.0-aarch64-apple-darwin/',
        sha256: '378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/ripgrep-v15.1.0-aarch64-apple-darwin.tar.gz',
      },
      'darwin-x64': {
        format: 'tar.gz',
        rootPrefix: 'ripgrep-15.1.0-x86_64-apple-darwin/',
        sha256: '64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/ripgrep-v15.1.0-x86_64-apple-darwin.tar.gz',
      },
      'win32-arm64': {
        format: 'zip',
        rootPrefix: 'ripgrep-15.1.0-aarch64-pc-windows-msvc/',
        sha256: '00d931fb5237c9696ca49308818edb76d8eb6fc132761cb2a1bd616b2df02f8e',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/ripgrep-v15.1.0-aarch64-pc-windows-msvc.zip',
      },
      'win32-x64': {
        format: 'zip',
        rootPrefix: 'ripgrep-15.1.0-x86_64-pc-windows-msvc/',
        sha256: '124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/ripgrep-v15.1.0-x86_64-pc-windows-msvc.zip',
      },
    },
    version: '15.1.0',
  },
  fd: {
    binSubdir: { darwin: '.', win32: '.' },
    executable: { darwin: 'fd', win32: 'fd.exe' },
    platforms: {
      'darwin-arm64': {
        format: 'tar.gz',
        rootPrefix: 'fd-v10.4.2-aarch64-apple-darwin/',
        sha256: '623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/fd-v10.4.2-aarch64-apple-darwin.tar.gz',
      },
      'win32-arm64': {
        format: 'zip',
        rootPrefix: 'fd-v10.4.2-aarch64-pc-windows-msvc/',
        sha256: '4f9110c2d5b33a7f760bfa5510f4c113d828109f7277d421b1053a9943c0fc92',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/fd-v10.4.2-aarch64-pc-windows-msvc.zip',
      },
      'win32-x64': {
        format: 'zip',
        rootPrefix: 'fd-v10.4.2-x86_64-pc-windows-msvc/',
        sha256: 'b2816e506390a89941c63c9187d58a3cc10e9a55f2ef0685f9ea0eccaf7c98c8',
        url: 'https://docs.c-ctrip.com/files/8/trn_zt_common_assets/fd-v10.4.2-x86_64-pc-windows-msvc.zip',
      },
    },
    version: '10.4.2',
  },
};

export const ALLOWED_DOWNLOAD_HOSTS = new Set(['docs.c-ctrip.com', 'mirrors.ops.ctripcorp.com']);

export function getPlatformKey(): PlatformKey {
  const p = process.platform;
  const a = process.arch;
  if (p === 'win32' && a === 'x64') return 'win32-x64';
  if (p === 'win32' && a === 'arm64') return 'win32-arm64';
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64';
  if (p === 'darwin' && a === 'x64') return 'darwin-x64';
  throw new UnsupportedPlatformError(`Unsupported platform: ${p}-${a}`);
}

export function resolveRuntime(name: RuntimeName): {
  entry: RuntimeEntry;
  platform: PlatformEntry;
} {
  const entry = RUNTIME_MANIFEST[name];
  const key = getPlatformKey();
  const platform = entry.platforms[key];
  if (!platform) {
    throw new UnsupportedPlatformError(`Runtime ${name} not available on ${key}`);
  }
  return { entry, platform };
}

/**
 * 当前平台是否有该便携 runtime 的镜像条目。用于 UI 决定是否置灰安装按钮。
 * 平台键无法识别时视为不支持。
 */
export function hasRuntimeForCurrentPlatform(name: RuntimeName): boolean {
  let key: PlatformKey;
  try {
    key = getPlatformKey();
  } catch {
    return false;
  }
  return Boolean(RUNTIME_MANIFEST[name].platforms[key]);
}

export function assertAllowedHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Disallowed download protocol: ${parsed.protocol}`);
  }
  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new Error(`Disallowed download host: ${parsed.hostname}`);
  }
}
