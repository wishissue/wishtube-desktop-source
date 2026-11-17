'use strict';
// electron-builder afterPack hook. Changing a macOS app (renaming the executable, editing Info.plist) breaks the signature Electron ships with,
// and Apple Silicon refuses to start any arm64 app that is not at least ad-hoc signed. We have no paid Developer ID, so sign ad-hoc:
// `codesign` on a Mac, `rcodesign` (apple-codesign) when building on Linux/Windows. Ad-hoc is NOT notarised: Gatekeeper still asks on first launch.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  // ffprobe-static ships Intel and Apple Silicon builds; keep only the one for this target (saves ~65 MB per download).
  const arch = { 1: 'x64', 3: 'arm64' }[ctx.arch], probes = path.join(app, 'Contents/Resources/app.asar.unpacked/node_modules/ffprobe-static/bin/darwin');
  if (arch && fs.existsSync(probes)) for (const d of fs.readdirSync(probes)) if (d !== arch) fs.rmSync(path.join(probes, d), { recursive: true, force: true });
  const has = cmd => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0 || spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
  if (process.platform === 'darwin') { execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' }); console.log('  • ad-hoc signed (codesign)'); }
  else if (has('rcodesign')) { execFileSync('rcodesign', ['sign', app], { stdio: 'inherit' }); console.log('  • ad-hoc signed (rcodesign)'); }
  else console.warn('  ! rcodesign not found: the macOS app is UNSIGNED. On Apple Silicon run: codesign --force --deep -s - WishTube.app');
};
