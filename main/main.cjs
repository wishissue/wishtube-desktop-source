'use strict';
const { app, BrowserWindow, ipcMain, shell, session, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const { Downloads } = require('./downloads.cjs');
const browserPlayer = require('./browser.cjs');
const { Updater } = require('./updater.cjs');

const UA = `WishTube/${app.getVersion()} (+https://github.com/wishissue/wishtube-desktop-source)`;
let win = null, tray = null, quitting = false, store, downloads, bp, updater;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  const url = argv.find(a => /^https?:\/\//.test(a));
  if (url) win?.webContents.send('open-url', url);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Network runs in the main process: no CORS, one polite User-Agent. A dead host must fail FAST (a feed is only as quick as its slowest request):
 *  GETs get a short timeout and one quick retry, and only transient errors (429 / 5xx / network) are retried. */
async function netJson(url, opts = {}) {
  const tries = opts.body ? 1 : 2, timeout = Math.min(Math.max(+opts.timeout || 9000, 2000), 60000);
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: opts.body ? 'POST' : 'GET',
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body, signal: AbortSignal.timeout(timeout),
      });
      if (res.status === 429 || res.status >= 500) { last = new Error('HTTP ' + res.status); if (i < tries - 1) await sleep(350); continue; }
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { final: true });
      return await res.json();
    } catch (e) { last = e; if (e.final || i >= tries - 1) break; await sleep(250); }
  }
  throw last;
}

/** Ask several mirrors for their first byte at the same time and report the fastest that answers. Only http(s); headers only, no body is read. */
async function raceUrls(urls, opts = {}) {
  const list = (Array.isArray(urls) ? urls : []).filter(u => typeof u === 'string' && u.length < 2048 && /^https?:\/\//i.test(u)).slice(0, 8);
  let done = false; const timeout = Math.min(Math.max(+opts.timeout || 4500, 1000), 15000), t0 = Date.now(), failed = [], ctrls = list.map(() => new AbortController());
  if (!list.length) return { url: null, ms: 0, failed };
  const probes = list.map((url, i) => (async () => {
    const timer = setTimeout(() => ctrls[i].abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' }, signal: ctrls[i].signal });
      if (!(res.status === 200 || res.status === 206)) throw new Error('HTTP ' + res.status);
      res.body?.cancel().catch(() => {});
      return { url, ms: Date.now() - t0 };
    } catch (e) { if (!done) failed.push({ url, error: ctrls[i].signal.aborted && !e.message.startsWith('HTTP') ? 'timed out' : String(e.message || e).slice(0, 60) }); throw e; }
    finally { clearTimeout(timer); }
  })());
  try { const win = await Promise.any(probes); done = true; ctrls.forEach(c => c.abort()); return { ...win, failed: [...failed] }; }
  catch { done = true; return { url: null, ms: Date.now() - t0, failed: [...failed] }; }
}

const NATIVE_BG = '#0e0f12';

/** macOS shows one global menu bar. Without an Edit menu Cmd+C / Cmd+V do nothing in text fields, and without an app menu Cmd+Q and Cmd+H are gone. */
function macMenu() {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { role: 'windowMenu' },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: NATIVE_BG, title: 'WishTube', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '../renderer/icon-512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.on('close', e => { if (!quitting && store?.get('settings', {}).closeToTray) { e.preventDefault(); win.hide(); } });
  win.on('enter-full-screen', () => win.webContents.send('fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('fullscreen', false));
  win.on('resize', () => bp?.onWindowResize());
  win.on('closed', () => { bp?.close(); win = null; });
}

app.whenReady().then(() => {
  if (!gotLock) return;   // a second copy must not build a window, tray or shortcuts before it quits
  store = new Store(path.join(app.getPath('userData'), 'data'));
  downloads = new Downloads({ app, getWin: () => win, ua: UA, getDir: () => store.get('settings', {}).downloadDir, store });

  // Media hosts rarely send CORS headers; hls.js and captions need them. Applied to our own window only.
  session.defaultSession.webRequest.onHeadersReceived((d, cb) => {
    const h = { ...d.responseHeaders };
    for (const k of Object.keys(h)) if (k.toLowerCase().startsWith('access-control-')) delete h[k];
    h['Access-Control-Allow-Origin'] = ['*']; h['Access-Control-Allow-Headers'] = ['*']; h['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
    cb({ responseHeaders: h });
  });
  // Deny everything except what the player genuinely needs. Electron gates HTML fullscreen behind a permission, so denying all broke the fullscreen button.
  const ALLOWED = new Set(['fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(ALLOWED.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ALLOWED.has(perm));

  updater = new Updater({ app, store, getWin: () => win, ua: UA, shell, quit: () => { quitting = true; app.quit(); } });
  bp = browserPlayer.register(ipcMain, app, () => win);
  const h = ipcMain.handle.bind(ipcMain);
  h('net:json', (_e, url, opts) => netJson(url, opts));
  h('net:race', (_e, urls, opts) => raceUrls(urls, opts));
  h('store:get', (_e, key, def) => store.get(key, def));
  h('store:set', (_e, key, val) => { store.set(key, val); return true; });
  h('store:path', () => store.dir);
  const id = x => (typeof x === 'string' && /^dl\d{1,9}$/.test(x) ? x : null);
  h('dl:start', (_e, item) => { try { return { id: downloads.start(item) }; } catch (e) { return { error: e.message }; } });
  h('dl:pause', (_e, x) => !!id(x) && downloads.pause(x)); h('dl:resume', (_e, x) => !!id(x) && downloads.resume(x));
  h('dl:cancel', (_e, x) => !!id(x) && downloads.cancel(x)); h('dl:retry', (_e, x) => !!id(x) && downloads.retry(x));
  h('dl:remove', (_e, x) => !!id(x) && downloads.remove(x)); h('dl:clear', () => { downloads.clearFinished(); return true; });
  h('dl:list', () => downloads.list()); h('dl:caps', () => downloads.caps());
  h('dl:reveal', (_e, file) => { if (typeof file === 'string' && downloads.owns(file)) shell.showItemInFolder(file); });   // only files WishTube itself downloaded
  h('dl:open', (_e, file) => { if (typeof file === 'string' && downloads.owns(file) && fs.existsSync(file)) return shell.openPath(file); });
  h('open:external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  h('win:fullscreen', (_e, on) => { win?.setFullScreen(!!on); });
  h('update:state', () => updater.state());
  h('update:check', () => updater.check(true));
  h('update:install', async () => { try { return await updater.install(); } catch (e) { return { error: String(e.message || e) }; } });
  h('update:skip', (_e, v) => { if (typeof v === 'string') updater.skip(v.slice(0, 40)); return true; });
  h('update:auto', (_e, on) => { updater.setAuto(on); return true; });
  h('update:page', () => { const p = updater.info?.page; if (typeof p === 'string' && /^https:\/\/github\.com\//.test(p)) shell.openExternal(p); });
  h('app:relaunch', () => { app.relaunch(); quitting = true; app.quit(); });
  h('win:alwaysOnTop', (_e, on) => { if (!win) return false; win.setAlwaysOnTop(!!on, 'floating'); return win.isAlwaysOnTop(); });
  h('file:export', async (_e, name, text) => {
    const r = await dialog.showSaveDialog(win || undefined, { defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false; fs.writeFileSync(r.filePath, text); return true;
  });
  h('file:import', async () => {
    const r = await dialog.showOpenDialog(win || undefined, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    return r.canceled || !r.filePaths[0] ? null : fs.readFileSync(r.filePaths[0], 'utf8');
  });
  h('dir:pick', async () => {
    const r = await dialog.showOpenDialog(win || undefined, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  macMenu();
  createWindow();
  win.webContents.once('did-finish-load', () => updater.startDaily());
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '../renderer/icon-512.png')).resize({ width: process.platform === 'darwin' ? 18 : 22, height: process.platform === 'darwin' ? 18 : 22 });
    tray = new Tray(img);
    tray.setToolTip('WishTube');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show WishTube', click: () => { win?.show(); win?.focus(); } },
      { label: 'Play / Pause', click: () => win?.webContents.send('media', 'toggle') },
      { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { win?.isVisible() ? win.focus() : win?.show(); });
  } catch { /* some desktops have no tray; the app works without it */ }
  for (const [acc, cmd] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'prev']])
    try { globalShortcut.register(acc, () => win?.webContents.send('media', cmd)); } catch {}
  app.on('activate', () => { if (!win) createWindow(); else win.show(); });
});
app.on('before-quit', () => { quitting = true; store?.flushAll(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
