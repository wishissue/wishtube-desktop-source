'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (c, ...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('wt', {
  json: (url, opts) => inv('net:json', url, opts),
  get: (k, d) => inv('store:get', k, d),
  set: (k, v) => inv('store:set', k, v),
  dataPath: () => inv('store:path'),
  download: item => inv('dl:start', item),
  cancelDownload: id => inv('dl:cancel', id),
  downloads: () => inv('dl:list'),
  reveal: f => inv('dl:reveal', f),
  openExternal: u => inv('open:external', u),
  fullscreen: on => inv('win:fullscreen', on),
  alwaysOnTop: on => inv('win:alwaysOnTop', on),
  exportFile: (n, t) => inv('file:export', n, t),
  importFile: () => inv('file:import'),
  pickDir: () => inv('dir:pick'),
  on: (ch, fn) => { const h = (_e, ...a) => fn(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
});
