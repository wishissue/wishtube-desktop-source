import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { compareVersions, pickAsset } = createRequire(import.meta.url)('../main/updater.cjs');

test('version compare handles v-prefix, lengths and double digits', () => {
  assert.equal(compareVersions('v0.3.0', '0.2.0'), 1); assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.2.9', '0.2.10'), -1); assert.equal(compareVersions('1.0', '0.9.9'), 1); assert.equal(compareVersions('0.3.0-beta', '0.3.0'), 0);
});
test('asset picker chooses the right file per platform', () => {
  const A = n => ({ name: n, browser_download_url: 'https://github.com/x/' + n });
  const assets = [A('WishTube-0.3.0-portable.exe'), A('WishTube-Setup-0.3.0.exe'), A('WishTube-0.3.0-linux-x86_64.AppImage'), A('notes.txt')];
  assert.equal(pickAsset(assets, 'win32').name, 'WishTube-Setup-0.3.0.exe');
  assert.equal(pickAsset(assets, 'linux').name, 'WishTube-0.3.0-linux-x86_64.AppImage');
  assert.equal(pickAsset(assets, 'darwin'), null); assert.equal(pickAsset([], 'linux'), null);
});

test('asset picker chooses the disk image that matches this Mac', () => {
  const A = n => ({ name: n, browser_download_url: 'https://github.com/x/' + n });
  const assets = [A('WishTube-0.3.1-mac-x64.dmg'), A('WishTube-0.3.1-mac-arm64.dmg'), A('WishTube-0.3.1-mac-arm64.dmg.blockmap'), A('WishTube-Setup-0.3.1.exe')];
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'WishTube-0.3.1-mac-arm64.dmg');
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'WishTube-0.3.1-mac-x64.dmg');
  assert.equal(pickAsset([A('WishTube-0.3.1-mac-arm64.zip')], 'darwin', 'x64').name, 'WishTube-0.3.1-mac-arm64.zip');   // a zip is better than nothing
});
