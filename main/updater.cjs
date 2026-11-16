'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** In-app updater. Looks at the newest GitHub Release of the app's own repo, once a day, and can download + install it.
 *  Nothing is sent about the user: it is one plain GET to the public releases API. */
const REPO = 'wishissue/wishtube-desktop-source';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const DAY = 24 * 3600 * 1000;

/** 1 if a > b, -1 if a < b, 0 if equal. Accepts "v1.2.3" and ignores any "-beta" suffix. */
function compareVersions(a, b) {
  const p = v => String(v || '0').replace(/^v/i, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}

/** Choose the file that matches this computer from a release's assets. */
function pickAsset(assets, platform = process.platform) {
  const list = (assets || []).filter(a => a && a.name && a.browser_download_url);
  if (platform === 'linux') return list.find(a => /\.AppImage$/i.test(a.name)) || null;
  if (platform === 'win32') return list.find(a => /setup.*\.exe$/i.test(a.name)) || list.find(a => /\.exe$/i.test(a.name) && !/portable/i.test(a.name)) || list.find(a => /\.exe$/i.test(a.name)) || null;
  return null;
}

class Updater {
  constructor({ app, store, getWin, ua, shell, quit }) {
    Object.assign(this, { app, store, getWin, ua, shell, quit });
    this.info = null; this.busy = false; this.file = null; this.timer = null;
  }
  send(ch, payload) { try { this.getWin()?.webContents.send(ch, payload); } catch {} }
  prefs() { return { auto: true, lastCheck: 0, skip: null, ...(this.store.get('updates', {}) || {}) }; }
  save(patch) { this.store.set('updates', { ...this.prefs(), ...patch }); }
  state() {
    const p = this.prefs();
    return { current: this.app.getVersion(), auto: p.auto, lastCheck: p.lastCheck, update: this.info, canInstall: !!(this.info && this.info.asset), platform: process.platform };
  }

  /** Ask GitHub for the latest release. manual=true ignores the "skip this version" choice and reports errors. */
  async check(manual = false) {
    if (this.busy) return this.state();
    try {
      const res = await fetch(API, { headers: { 'User-Agent': this.ua, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(12000) });
      if (res.status === 404) { this.save({ lastCheck: Date.now() }); this.info = null; return { ...this.state(), error: manual ? 'No releases published yet.' : undefined }; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rel = await res.json(), version = String(rel.tag_name || '').replace(/^v/i, '');
      this.save({ lastCheck: Date.now() });
      if (version && compareVersions(version, this.app.getVersion()) > 0) {
        const a = pickAsset(rel.assets);
        this.info = { version, name: rel.name || 'v' + version, notes: String(rel.body || '').slice(0, 1500), page: rel.html_url, published: rel.published_at,
          asset: a ? { name: a.name, url: a.browser_download_url, size: a.size || 0 } : null };
        if (manual || this.prefs().skip !== version) this.send('update:available', this.info);
      } else this.info = null;
      return this.state();
    } catch (e) { return { ...this.state(), error: manual ? 'Couldn’t reach GitHub. Check your connection.' : undefined }; }
  }

  /** Check at start-up if a day has passed, then keep checking while the app stays open. */
  startDaily() {
    const tick = () => { const p = this.prefs(); if (p.auto && Date.now() - p.lastCheck >= DAY) this.check(false); };
    setTimeout(tick, 8000);
    this.timer = setInterval(tick, 3 * 3600 * 1000);
    this.timer.unref?.();
  }

  /** Download the installer/AppImage with progress, then install it. */
  async install() {
    const i = this.info; if (!i?.asset) throw new Error('No installer for this system. Use “Open release page”.');
    if (this.busy) return false; this.busy = true;
    const dir = path.join(this.app.getPath('userData'), 'updates'); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(i.asset.name)), tmp = dest + '.part';
    try {
      const res = await fetch(i.asset.url, { headers: { 'User-Agent': this.ua }, redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      const total = +res.headers.get('content-length') || i.asset.size || 0; let got = 0, last = 0;
      const out = fs.createWriteStream(tmp);
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
        got += chunk.length; const now = Date.now();
        if (now - last > 150) { last = now; this.send('update:progress', { got, total }); }
      }
      await new Promise((ok, no) => out.end(e => e ? no(e) : ok()));
      fs.renameSync(tmp, dest); this.send('update:progress', { got, total: total || got, done: true });
      return this.apply(dest);
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    finally { this.busy = false; }
  }

  apply(file) {
    if (process.platform === 'win32') { this.shell.openPath(file); setTimeout(() => this.quit(), 800); return { installing: true }; }
    const target = process.env.APPIMAGE;
    if (process.platform === 'linux' && target) {
      fs.chmodSync(file, 0o755);
      try { fs.copyFileSync(file, target + '.new'); fs.chmodSync(target + '.new', 0o755); fs.renameSync(target + '.new', target); fs.rmSync(file, { force: true }); }
      catch { this.shell.showItemInFolder(file); return { revealed: file }; }   // folder not writable: let the user move it
      this.app.relaunch({ execPath: target, args: [] }); setTimeout(() => this.quit(), 300); return { installing: true };
    }
    this.shell.showItemInFolder(file); return { revealed: file };
  }
  skip(version) { this.save({ skip: version }); }
  setAuto(on) { this.save({ auto: !!on }); }
}
module.exports = { Updater, compareVersions, pickAsset, REPO };
