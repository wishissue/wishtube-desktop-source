'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('wt', {
  json: (url, opts) => inv('net:json', url, opts),
  get: (k, d) => inv('store:get', k, d),
  set: (k, v) => inv('store:set', k, v),
  dataPath: () => inv('store:path'),
  dl: { start: i => inv('dl:start', i), pause: id => inv('dl:pause', id), resume: id => inv('dl:resume', id), cancel: id => inv('dl:cancel', id), retry: id => inv('dl:retry', id),
    remove: id => inv('dl:remove', id), clear: () => inv('dl:clear'), list: () => inv('dl:list'), caps: () => inv('dl:caps'), reveal: f => inv('dl:reveal', f), open: f => inv('dl:open', f) },
  openExternal: u => inv('open:external', u),
  fullscreen: on => inv('win:fullscreen', on),
  browser: {
    open: (url, bounds) => inv('browser:open', url, bounds), bounds: b => inv('browser:bounds', b), nav: a => inv('browser:nav', a),
    fullscreen: on => inv('browser:fullscreen', on), close: () => inv('browser:close'), clear: () => inv('browser:clear'),
  },
  relaunch: () => inv('app:relaunch'),
  alwaysOnTop: on => inv('win:alwaysOnTop', on),
  exportFile: (n, t) => inv('file:export', n, t),
  importFile: () => inv('file:import'),
  pickDir: () => inv('dir:pick'),
  on: (ch, fn) => { const h = (_e, ...a) => fn(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
});
