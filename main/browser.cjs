'use strict';
/**
 * "Pretend as Browser": shows a video's original website inside WishTube using a real Chromium page.
 * The page lives in its own WebContentsView with a separate session partition, no preload, no Node, a sandbox,
 * and top-level navigation limited to the provider's own site. Nothing here touches DRM, logins or paywalls:
 * if the site asks for a sign-in or blocks the region, the user simply sees what the site shows.
 */
const { WebContentsView, session, shell } = require('electron');

const PARTITION = 'persist:wishtube-browser';
const { site, parseHttp, cleanBounds } = require('./netguard.cjs');

class BrowserPlayer {
  constructor(app, getWin) {
    this.app = app; this.getWin = getWin; this.view = null; this.origin = null; this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.fs = false; this.htmlFs = false; this.error = null; this.loading = false;
    const ses = session.fromPartition(PARTITION);
    // Everything is denied except fullscreen, so a site can't reach camera, mic, location, notifications, etc.
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen'));
    ses.setPermissionCheckHandler((_wc, perm) => perm === 'fullscreen');
    this.ses = ses;
  }

  allowed(url) { const u = parseHttp(url); return !!u && !!this.origin && site(u.hostname) === this.origin; }

  emit() {
    const wc = this.view?.webContents, win = this.getWin();
    if (!wc || wc.isDestroyed() || !win) return;
    win.webContents.send('browser:state', {
      loading: this.loading, url: wc.getURL(), title: wc.getTitle(), error: this.error, fs: this.fs,
      canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(),
    });
  }

  open(url, bounds) {
    const win = this.getWin(), u = parseHttp(url);
    if (!win || !u) throw new Error('Not a web address');
    this.close();
    this.origin = site(u.hostname); this.error = null; this.loading = true; this.fs = false; this.htmlFs = false;
    this.bounds = cleanBounds(bounds) || this.bounds;

    const view = this.view = new WebContentsView({ webPreferences: {
      partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
      nodeIntegrationInSubFrames: false, webviewTag: false, allowRunningInsecureContent: false, spellcheck: false,
    } });
    const wc = view.webContents;
    // It is a regular Chromium page, so it identifies like one (no "Electron" or app tokens).
    wc.setUserAgent(this.app.userAgentFallback.replace(/\s(Electron|WishTube)\/\S+/g, ''));
    win.contentView.addChildView(view);
    this.layout();

    const guard = (e, target) => { if (!this.allowed(target)) { e.preventDefault(); this.error = `Blocked a jump to another site (${(parseHttp(target)?.hostname) || 'unsupported address'}).`; this.emit(); } };
    wc.on('will-navigate', (e, target) => guard(e, target));
    wc.on('will-redirect', (e, target) => guard(e, target));
    wc.setWindowOpenHandler(({ url: target }) => {                      // pop-ups: same site loads here, anything else goes to the system browser
      if (this.allowed(target)) setImmediate(() => wc.loadURL(target)); else if (parseHttp(target)) shell.openExternal(target);
      return { action: 'deny' };
    });
    wc.on('did-start-loading', () => { this.loading = true; this.error = null; this.emit(); });
    wc.on('did-stop-loading', () => { this.loading = false; this.emit(); });
    wc.on('did-navigate', () => this.emit()); wc.on('did-navigate-in-page', () => this.emit()); wc.on('page-title-updated', () => this.emit());
    wc.on('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) { this.loading = false; this.error = `Couldn’t load the page (${desc}).`; this.emit(); } });
    wc.on('render-process-gone', (_e, d) => { this.loading = false; this.error = `The page crashed (${d.reason}).`; this.emit(); });
    wc.on('enter-html-full-screen', () => { this.htmlFs = true; this.setFullscreen(true); });
    wc.on('leave-html-full-screen', () => { this.htmlFs = false; this.setFullscreen(false); });
    wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape' && this.fs && !this.htmlFs) { e.preventDefault(); this.setFullscreen(false); } });
    wc.loadURL(u.href).catch(() => {});
    this.emit();
  }

  layout() {
    const win = this.getWin(); if (!this.view || !win) return;
    if (this.fs) { const [w, h] = win.getContentSize(); this.view.setBounds({ x: 0, y: 0, width: w, height: h }); }
    else this.view.setBounds(this.bounds);
  }
  setBounds(b) { const c = cleanBounds(b); if (!c) return; this.bounds = c; if (!this.fs) this.layout(); }

  setFullscreen(on) {
    const win = this.getWin(); if (!this.view || !win) return;
    this.fs = !!on; win.setFullScreen(this.fs);
    if (!this.fs && this.htmlFs) { this.htmlFs = false; this.view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {}); }
    setTimeout(() => { this.layout(); this.emit(); }, 120);     // let the OS finish resizing first
  }
  onWindowResize() { if (this.fs) this.layout(); }

  nav(action) {
    const wc = this.view?.webContents; if (!wc) return;
    const nh = wc.navigationHistory;
    if (action === 'back' && nh.canGoBack()) nh.goBack(); else if (action === 'forward' && nh.canGoForward()) nh.goForward();
    else if (action === 'reload') { this.error = null; wc.reload(); } else if (action === 'stop') wc.stop();
  }

  async clearData() {
    await this.ses.clearStorageData(); await this.ses.clearCache(); await this.ses.clearAuthCache?.();
    return true;
  }

  close() {
    const win = this.getWin();
    if (this.fs && win) win.setFullScreen(false);
    if (this.view) { try { win?.contentView.removeChildView(this.view); } catch {} try { this.view.webContents.close(); } catch {} }
    this.view = null; this.origin = null; this.fs = false; this.htmlFs = false; this.error = null; this.loading = false;
  }
}

/** Registers IPC. Every handler only accepts calls from the app window itself, never from the embedded site. */
function register(ipcMain, app, getWin) {
  const bp = new BrowserPlayer(app, getWin);
  const trusted = e => { const w = getWin(); if (!w || e.sender !== w.webContents) throw new Error('Untrusted sender'); };
  const on = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { trusted(e); return fn(...a); });
  on('browser:open', (url, bounds) => { bp.open(url, bounds); return true; });
  on('browser:bounds', b => { bp.setBounds(b); return true; });
  on('browser:nav', action => { if (['back', 'forward', 'reload', 'stop'].includes(action)) bp.nav(action); return true; });
  on('browser:fullscreen', onOff => { bp.setFullscreen(!!onOff); return true; });
  on('browser:close', () => { bp.close(); return true; });
  on('browser:clear', () => bp.clearData());
  return bp;
}

module.exports = { register };
