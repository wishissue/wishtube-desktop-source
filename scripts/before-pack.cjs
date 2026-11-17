'use strict';
// electron-builder beforePack hook. `ffmpeg-static` downloads the binary for the machine that ran `npm install`, so a Windows or macOS
// build made on Linux (or an Intel build made on Apple Silicon) would otherwise ship the WRONG ffmpeg and every download/merge would fail.
// This swaps in the binary that matches the target being packed. ffprobe-static ships all platforms, those are filtered in package.json.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'arm', 3: 'arm64' };   // electron-builder Arch enum
const SUPPORTED = { darwin: ['x64', 'arm64'], linux: ['x64'], win32: ['x64'] };

exports.default = async function beforePack(ctx) {
  const platform = ctx.electronPlatformName, arch = ARCH[ctx.arch];
  if (!(SUPPORTED[platform] || []).includes(arch)) throw new Error(`Unsupported target ${platform}/${arch}`);
  const dir = path.dirname(require.resolve('ffmpeg-static/package.json'));
  for (const f of ['ffmpeg', 'ffmpeg.exe']) fs.rmSync(path.join(dir, f), { force: true });   // install.js skips the download if a binary is already there
  console.log(`  • fetching ffmpeg for ${platform}/${arch}`);
  execFileSync(process.execPath, [path.join(dir, 'install.js')], {
    cwd: dir, stdio: 'inherit', env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch },
  });
  const got = path.join(dir, platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (!fs.existsSync(got) || fs.statSync(got).size < 5e6) throw new Error('ffmpeg download for ' + platform + '/' + arch + ' failed');
  if (platform !== 'win32') fs.chmodSync(got, 0o755);
};
