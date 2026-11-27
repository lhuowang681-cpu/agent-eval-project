import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// lark-cli (the official Feishu/Lark CLI) ships as a prebuilt Go binary, fetched
// from GitHub releases (the `@larksuite/cli` npm package is just a downloader
// shim). We mirror the agent-browser approach: download the release archive at
// build time, verify its sha256, extract the single `lark-cli` binary into
// resources/bin, and let it ride along via electron-builder extraResources.
//
// Unlike agent-browser (a bare binary), the release asset is a .tar.gz / .zip,
// so there is an extra extraction step.
// Bumping this? Two follow-ups in packages/builtin-skills/src/feishu-cli/:
//  1. Re-run `npm run sync:lark-cli-skills` to regenerate skillsIndex.generated.ts
//     (embeds this version's `lark-cli skills list` output in the skill prompt).
//  2. Re-verify the hand-curated "Common Commands — Exact Syntax" block in
//     content.ts against each command's `--help` (see the NOTE there).
// Both silently drift from the bundled binary otherwise.
const VERSION = '1.0.64';
const REPO = 'larksuite/cli';

// sha256 of each release archive (from the release `checksums.txt`).
// Keyed by `<os>-<arch>`. MUST be updated together with VERSION.
const CHECKSUMS = {
  'darwin-amd64': '707d4b96040a656dc94c6f86c44c081ba0d58f24c12c0ad9d258ebb7babff771',
  'darwin-arm64': 'cdc3855abf55997f183fcf33ec649496ca197418dec98a45fd11faa102e89f95',
  'linux-amd64': '27ffb3f7c36d31feab0a9f1d670700c355bf8ef34ce237dcb7e205e0d254acc5',
  'linux-arm64': '53aa3b3ef1d6e9cafa1e00cca92f0d4804c3ea99da7f8ded00145537f229de5a',
  'windows-amd64': '662c921c740e8123a4378e3699dff4b3e493a832d8e5319342e683a760fecea6',
  'windows-arm64': '087767268d7318d269429289f999f5f972a7e757e07e7646774be0a23b49dc00',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '..', 'resources', 'bin');
const versionFile = path.join(binDir, '.lark-cli-version');

const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' };
// Go arch naming: amd64 / arm64 (not Node's x64).
const archMap = { arm64: 'arm64', x64: 'amd64' };

const goOs = platformMap[process.platform];
const goArch = archMap[process.arch];

console.info(`[lark-cli] platform=${process.platform} arch=${process.arch}`);
console.info(`[lark-cli] target: ${goOs}-${goArch}`);
console.info(`[lark-cli] binDir: ${binDir}`);

if (!goOs || !goArch) {
  console.error(`[lark-cli] ❌ Unsupported platform: ${process.platform}-${process.arch}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const archiveExt = isWindows ? 'zip' : 'tar.gz';
const archiveName = `lark-cli-${VERSION}-${goOs}-${goArch}.${archiveExt}`;
const expectedSha = CHECKSUMS[`${goOs}-${goArch}`];
const outputName = `lark-cli${isWindows ? '.exe' : ''}`;
const outputPath = path.join(binDir, outputName);

// Skip if already at the requested version.
if (fs.existsSync(versionFile)) {
  const existing = fs.readFileSync(versionFile, 'utf8').trim();
  if (existing === VERSION && fs.existsSync(outputPath)) {
    const { size } = await stat(outputPath);
    console.info(
      `[lark-cli] ✅ v${VERSION} already present (${(size / 1024 / 1024).toFixed(1)} MB), skipping.`,
    );
    process.exit(0);
  }
}

// GitHub first, then the npmmirror binary mirror as a domestic-network fallback.
const urls = [
  `https://github.com/${REPO}/releases/download/v${VERSION}/${archiveName}`,
  `https://registry.npmmirror.com/-/binary/lark-cli/v${VERSION}/${archiveName}`,
];

await mkdir(binDir, { recursive: true });

/**
 * Follow redirects and download to a writable stream.
 */
function download(url, dest, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    https
      .get(url, { headers: { 'User-Agent': 'lobehub-desktop' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.info(`[lark-cli] redirect → ${res.headers.location}`);
          res.resume();
          return download(res.headers.location, dest, maxRedirects - 1).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const file = createWriteStream(dest);
        pipeline(res, file).then(resolve, reject);
      })
      .on('error', reject);
  });
}

async function sha256(file) {
  const buf = await readFile(file);
  return createHash('sha256').update(buf).digest('hex');
}

const tmpArchive = path.join(os.tmpdir(), archiveName);

try {
  let lastErr;
  for (const url of urls) {
    try {
      console.info(`[lark-cli] ⬇️  Downloading v${VERSION} from ${url}`);
      await download(url, tmpArchive);
      break;
    } catch (err) {
      console.warn(`[lark-cli] download failed (${url}): ${err.message}`);
      lastErr = err;
    }
  }
  if (!fs.existsSync(tmpArchive)) throw lastErr || new Error('download failed');

  // Verify checksum before trusting the archive (binary comes over the network).
  if (expectedSha) {
    const actual = await sha256(tmpArchive);
    if (actual !== expectedSha) {
      throw new Error(`checksum mismatch: expected ${expectedSha}, got ${actual}`);
    }
    console.info(`[lark-cli] ✅ sha256 verified`);
  } else {
    console.warn(`[lark-cli] ⚠️  no checksum for ${goOs}-${goArch}, skipping verification`);
  }

  // Extract just the binary (it sits at the archive root). System `tar` handles
  // both .tar.gz and .zip (libarchive) on macOS/Linux/Win10+.
  if (isWindows) {
    execFileSync('tar', ['-xf', tmpArchive, '-C', binDir, outputName], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xzf', tmpArchive, '-C', binDir, outputName], { stdio: 'inherit' });
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`binary not found after extraction: ${outputPath}`);
  }

  if (!isWindows) {
    await chmod(outputPath, 0o755);
  }

  const { size } = await stat(outputPath);
  console.info(`[lark-cli] extracted ${(size / 1024 / 1024).toFixed(1)} MB → ${outputPath}`);

  await writeFile(versionFile, VERSION, 'utf8');
  console.info(`[lark-cli] ✅ v${VERSION} ready`);
} catch (err) {
  console.error(`[lark-cli] ❌ Failed: ${err.message}`);
  process.exit(1);
} finally {
  await rm(tmpArchive, { force: true }).catch(() => {});
}
