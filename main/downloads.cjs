'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const safe = s => String(s).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'video';

class Downloads {
  constructor(app, getWin, ua, getDir) { this.app = app; this.getWin = getWin; this.ua = ua; this.getDir = getDir; this.items = new Map(); this.n = 0; }
  dir() { const d = this.getDir() || path.join(this.app.getPath('videos'), 'WishTube'); fs.mkdirSync(d, { recursive: true }); return d; }
  list() { return [...this.items.values()].map(({ ctrl, ...rest }) => rest); }
  push(it) { const { ctrl, ...rest } = it; this.getWin()?.webContents.send('dl:update', rest); }
  async start({ url, title, videoId }) {
    const id = 'dl' + (++this.n);
    const ext = ((new URL(url).pathname.match(/\.(mp4|webm|ogv|mkv|m4v)$/i)) || [null, 'mp4'])[1].toLowerCase();
    let file = path.join(this.dir(), `${safe(title)}.${ext}`);
    for (let i = 1; fs.existsSync(file); i++) file = path.join(this.dir(), `${safe(title)} (${i}).${ext}`);
    const it = { id, videoId, title, file, received: 0, total: 0, state: 'active', ctrl: new AbortController() };
    this.items.set(id, it);
    (async () => {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': this.ua }, signal: it.ctrl.signal });
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
        it.total = Number(res.headers.get('content-length')) || 0;
        const src = Readable.fromWeb(res.body);
        let last = 0;
        src.on('data', c => { it.received += c.length; const t = Date.now(); if (t - last > 250) { last = t; this.push(it); } });
        await pipeline(src, fs.createWriteStream(file + '.part'));
        fs.renameSync(file + '.part', file); it.state = 'done';
      } catch (e) {
        it.state = it.ctrl.signal.aborted ? 'cancelled' : 'error'; it.error = e.message;
        fs.rmSync(file + '.part', { force: true });
      }
      this.push(it);
    })();
    return id;
  }
  cancel(id) { this.items.get(id)?.ctrl.abort(); }
}
module.exports = { Downloads };
