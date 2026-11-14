'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Tiny JSON-file store: one file per key, atomic writes, debounced, so a crash never corrupts data. */
class Store {
  constructor(dir) { this.dir = dir; this.cache = new Map(); this.timers = new Map(); fs.mkdirSync(dir, { recursive: true }); }
  file(key) { return path.join(this.dir, key.replace(/[^\w.-]/g, '_') + '.json'); }
  get(key, def) {
    if (this.cache.has(key)) return this.cache.get(key);
    try { const v = JSON.parse(fs.readFileSync(this.file(key), 'utf8')); this.cache.set(key, v); return v; }
    catch { return def; }
  }
  set(key, val) {
    this.cache.set(key, val);
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.flush(key), 250));
  }
  flush(key) {
    const f = this.file(key), tmp = f + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(this.cache.get(key))); fs.renameSync(tmp, f); } catch (e) { console.error('store write failed', key, e); }
  }
  flushAll() { for (const k of this.cache.keys()) this.flush(k); }
}
module.exports = { Store };
