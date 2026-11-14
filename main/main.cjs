'use strict';
const { app, BrowserWindow, ipcMain, shell, session, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store } = require('./store.cjs');
const { Downloads } = require('./downloads.cjs');
const browserPlayer = require('./browser.cjs');

const UA = `WishTube/${app.getVersion()} (+https://github.com/wishissue/wishtube)`;
let win = null, tray = null, quitting = false, store, downloads, bp;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  const url = argv.find(a => /^https?:\/\//.test(a));
  if (url) win?.webContents.send('open-url', url);
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Network runs in the main process: no CORS, one polite User-Agent, retry with backoff on GETs. */
async function netJson(url, opts = {}) {
  const tries = opts.body ? 1 : 3;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: opts.body ? 'POST' : 'GET',
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
        body: opts.body, signal: AbortSignal.timeout(opts.timeout || 20000),
      });
      if (res.status === 429 || res.status >= 500) { last = new Error('HTTP ' + res.status); await sleep(400 * 2 ** i); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { last = e; if (i < tries - 1) await sleep(300 * 2 ** i); }
  }
  throw last;
}

/** Real see-through glass needs the OS: Windows 11 acrylic, macOS vibrancy, or a transparent window on Linux compositors.
 *  It can only be chosen when the window is created, so the choice is read from saved settings at launch. */
function glassMode() {
  const s = store?.get('settings', {}) || {};
  if (s.theme !== 'glass' || s.nativeGlass === false) return null;
  if (process.platform === 'win32') return Number(require('node:os').release().split('.')[2]) >= 22000 ? 'acrylic' : null;
  if (process.platform === 'darwin') return 'vibrancy';
  return 'transparent';
}
let glass = null;

function createWindow() {
  glass = glassMode();
  const glassOpts = glass === 'acrylic' ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
    : glass === 'vibrancy' ? { vibrancy: 'under-window', backgroundColor: '#00000000' }
    : glass === 'transparent' ? { transparent: true, backgroundColor: '#00000000' } : { backgroundColor: '#0e0f12' };
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 600,
    ...glassOpts, title: 'WishTube', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, '../renderer/icon.png'),
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
  store = new Store(path.join(app.getPath('userData'), 'data'));
  downloads = new Downloads(app, () => win, UA, () => store.get('settings', {}).downloadDir);

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

  bp = browserPlayer.register(ipcMain, app, () => win);
  const h = ipcMain.handle.bind(ipcMain);
  h('net:json', (_e, url, opts) => netJson(url, opts));
  h('store:get', (_e, key, def) => store.get(key, def));
  h('store:set', (_e, key, val) => { store.set(key, val); return true; });
  h('store:path', () => store.dir);
  h('dl:start', (_e, item) => downloads.start(item));
  h('dl:cancel', (_e, id) => downloads.cancel(id));
  h('dl:list', () => downloads.list());
  h('dl:reveal', (_e, file) => { shell.showItemInFolder(file); });
  h('open:external', (_e, url) => { if (/^https?:/.test(url)) shell.openExternal(url); });
  h('win:fullscreen', (_e, on) => { win.setFullScreen(!!on); });
  h('win:glass', () => glass);
  h('app:relaunch', () => { app.relaunch(); quitting = true; app.quit(); });
  h('win:alwaysOnTop', (_e, on) => { win.setAlwaysOnTop(!!on, 'floating'); return win.isAlwaysOnTop(); });
  h('file:export', async (_e, name, text) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false; fs.writeFileSync(r.filePath, text); return true;
  });
  h('file:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    return r.canceled || !r.filePaths[0] ? null : fs.readFileSync(r.filePaths[0], 'utf8');
  });
  h('dir:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  createWindow();
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, '../renderer/icon.png')).resize({ width: 22, height: 22 });
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
