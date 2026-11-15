'use strict';
/**
 * Download manager.
 *  - direct files : HTTP with Range resume, retry with back-off, stall detection, pause / resume
 *  - split A/V    : video + audio fetched separately (both resumable), then remuxed with ffmpeg (-c copy, no re-encode)
 *  - HLS          : ffmpeg reads the playlist (segments + separate audio rendition) and remuxes (-c copy)
 *  - audio only   : mp3 / m4a / opus through ffmpeg (stream-copied when the codec already matches)
 * Every finished file is probed with ffprobe, so a "video" without audio (or an unplayable file) is an error, never "Done".
 */
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { runFfmpeg, probe, locate } = require('./media/ffmpeg.cjs');
const { parseMaster, parseMedia } = require('./media/hls.cjs');

const MAX_ACTIVE = 3, RETRIES = 3, STALL_MS = 30000, HISTORY = 200;
const AUDIO_FORMATS = {
  mp3: { ext: 'mp3', codec: ['-c:a', 'libmp3lame', '-q:a', '2'], keep: ['mp3'], mux: 'mp3' },
  m4a: { ext: 'm4a', codec: ['-c:a', 'aac', '-b:a', '192k'], keep: ['aac'], mux: 'ipod' },
  opus: { ext: 'opus', codec: ['-c:a', 'libopus', '-b:a', '128k'], keep: ['opus'], mux: 'opus' },
};
const VIDEO_FORMATS = new Set(['best', 'mp4', 'webm', 'mkv']);
const KINDS = new Set(['muxed', 'split', 'hls']);
const BUSY = ['active', 'merging', 'verifying'];

const safe = s => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 110) || 'video';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const httpUrl = u => { try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && String(u).length <= 4096 ? x : null; } catch { return null; } };
const PRIVATE = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const extOf = u => ((new URL(u).pathname.match(/\.(mp4|webm|mkv|m4v|ogv|mov|mp3|m4a|opus|ogg|flac|wav)$/i) || [])[1] || '').toLowerCase();
const abortErr = (code, msg) => Object.assign(new Error(msg), { code });

class Downloads {
  constructor({ app, getWin, ua, getDir, store, allowLocal = false }) {
    Object.assign(this, { app, getWin, ua, getDir, store, allowLocal });
    this.items = new Map(); this.n = 0; this.queue = [];
    for (const d of store?.get('downloads', []) || []) {
      this.n = Math.max(this.n, Number(String(d.id).replace(/\D/g, '')) || 0);
      if (['active', 'queued', 'paused', ...BUSY].includes(d.state)) { d.state = 'error'; d.error = 'Interrupted when WishTube closed. Press Retry to continue.'; d.speed = 0; d.eta = null; }
      this.items.set(d.id, { ...d });
    }
  }

  caps() { const l = locate(); return { ffmpeg: !!l.ffmpeg, ffprobe: !!l.ffprobe, pause: process.platform !== 'win32' }; }
  dir() { const d = this.getDir?.() || path.join(this.app.getPath('videos'), 'WishTube'); fs.mkdirSync(d, { recursive: true }); return d; }
  pub(it) { const { ctrl, proc, win, pausing, cancelling, _t, t0, sizeNow, ...r } = it; return r; }
  list() { return [...this.items.values()].map(i => this.pub(i)); }
  persist() { this.store?.set('downloads', this.list().slice(-HISTORY)); }
  push(it, force) {
    const t = Date.now(); if (!force && it._t && t - it._t < 250) return; it._t = t;
    this.getWin?.()?.webContents.send('dl:update', this.pub(it));
  }
  owns(file) { return [...this.items.values()].some(i => i.file === file); }
  get(id) { return this.items.get(id); }

  /* ------------------------------ public API ------------------------------ */
  validate(req) {
    if (!req || typeof req !== 'object') throw new Error('Bad request');
    const o = req.option || {};
    if (!KINDS.has(o.kind)) throw new Error('Unknown download type');
    if (!o.url) throw new Error('No stream to download');
    if (o.kind === 'split' && !o.audioUrl) throw new Error('Split download needs an audio stream');
    for (const u of [o.url, o.audioUrl].filter(Boolean)) {
      const x = httpUrl(u); if (!x) throw new Error('Only http(s) streams can be downloaded');
      if (!this.allowLocal && PRIVATE.test(x.hostname)) throw new Error('That address is not allowed');
    }
    const format = String(req.format || 'best');
    if (!VIDEO_FORMATS.has(format) && !AUDIO_FORMATS[format]) throw new Error('Unknown format');
    return { o, format };
  }

  start(req) {
    const { o, format } = this.validate(req);
    const id = 'dl' + (++this.n), audio = !!AUDIO_FORMATS[format];
    const it = {
      id, videoId: String(req.videoId || '').slice(0, 300), title: String(req.title || 'video').slice(0, 300), creator: String(req.creator || '').slice(0, 200),
      thumb: httpUrl(req.thumb) ? req.thumb : null, quality: audio ? 'Audio' : (Number(o.height) ? Number(o.height) + 'p' : 'Original'), format, kind: o.kind, state: 'queued',
      received: 0, total: Number(o.size) > 0 ? Number(o.size) : 0, speed: 0, eta: null, progress: 0, file: null, error: null, streams: null, verified: false,
      created: Date.now(), dur: Number(req.dur) > 0 ? Number(req.dur) : 0, canPause: false, attempts: 0,
      opt: { kind: o.kind, url: o.url, audioUrl: o.audioUrl || null, height: Number(o.height) || 0, ext: String(o.ext || '').slice(0, 5) },
    };
    this.items.set(id, it); this.queue.push(id); this.pump(); this.push(it, true); this.persist();
    return id;
  }

  pump() {
    let free = MAX_ACTIVE - [...this.items.values()].filter(i => BUSY.includes(i.state)).length;
    while (free > 0 && this.queue.length) {
      const it = this.items.get(this.queue.shift()); if (!it || it.state !== 'queued') continue;
      free--; this.exec(it);
    }
  }

  pause(id) {
    const it = this.items.get(id); if (!it || it.state !== 'active') return false;
    if (it.proc) { if (!it.proc.pause()) return false; it.state = 'paused'; it.speed = 0; it.eta = null; this.push(it, true); return true; }
    it.pausing = true; it.ctrl?.abort(); return true;
  }
  resume(id) {
    const it = this.items.get(id); if (!it || it.state !== 'paused') return false;
    if (it.proc) { it.proc.resume(); it.state = 'active'; it.win = []; this.push(it, true); return true; }
    it.state = 'queued'; this.queue.push(id); this.pump(); this.push(it, true); return true;
  }
  cancel(id) {
    const it = this.items.get(id); if (!it || ['done', 'cancelled', 'error'].includes(it.state)) return false;
    it.cancelling = true; it.ctrl?.abort(); if (it.proc) { it.proc.resume(); it.proc.kill(); }
    if (['queued', 'paused'].includes(it.state) && !it.proc) { it.state = 'cancelled'; this.cleanup(it); this.push(it, true); this.persist(); }
    return true;
  }
  retry(id) {
    const it = this.items.get(id); if (!it || !['error', 'cancelled'].includes(it.state)) return false;
    Object.assign(it, { state: 'queued', error: null, speed: 0, eta: null, cancelling: false, pausing: false, attempts: 0 });
    this.queue.push(id); this.pump(); this.push(it, true); return true;
  }
  remove(id) { const it = this.items.get(id); if (!it) return false; if (BUSY.includes(it.state) || it.state === 'paused') this.cancel(id); this.cleanup(it); this.items.delete(id); this.persist(); return true; }
  clearFinished() { for (const [id, it] of [...this.items]) if (['done', 'error', 'cancelled'].includes(it.state)) { this.cleanup(it); this.items.delete(id); } this.persist(); }

  /* ------------------------------ execution ------------------------------ */
  cleanup(it) { if (it.file) for (const s of ['.v.part', '.a.part', '.src.part', '.part', '.mux.part']) fs.rmSync(it.file + s, { force: true }); }

  nameFor(it, ext) {
    const d = this.dir(), stem = safe(it.title) + (it.quality && !['Audio', 'Original'].includes(it.quality) ? ` (${it.quality})` : '');
    let file = path.join(d, `${stem}.${ext}`);
    for (let i = 1; fs.existsSync(file) || [...this.items.values()].some(x => x !== it && x.file === file); i++) file = path.join(d, `${stem} (${i}).${ext}`);
    return file;
  }

  /** Updates bytes / speed (sliding window) / progress / ETA. `frac` is overall progress when known. */
  meter(it, bytes, frac) {
    const t = Date.now(); (it.win ||= []).push([t, bytes]); while (it.win.length > 2 && t - it.win[0][0] > 4000) it.win.shift();
    const [t0, b0] = it.win[0]; if (it.win.length > 1 && t > t0) it.speed = Math.max(0, (bytes - b0) / ((t - t0) / 1000));
    it.received = bytes;
    if (frac != null) it.progress = Math.max(it.progress || 0, Math.min(0.99, frac));
    it.eta = it.progress > 0.02 && it.speed > 0 ? Math.round(((Date.now() - it.t0) / 1000) * (1 - it.progress) / it.progress) : null;
    this.push(it);
  }

  async exec(it) {
    Object.assign(it, { state: 'active', error: null, cancelling: false, pausing: false, win: [], t0: Date.now() }); it.attempts++;
    const audio = AUDIO_FORMATS[it.format];
    it.canPause = (!audio && it.kind !== 'hls') || this.caps().pause;
    this.push(it, true);
    try {
      if (audio) await this.runAudio(it, audio);
      else if (it.kind === 'muxed') await this.runMuxed(it);
      else if (it.kind === 'split') await this.runSplit(it);
      else await this.runHls(it);
      await this.verify(it);
      Object.assign(it, { state: 'done', progress: 1, speed: 0, eta: null, finished: Date.now() });
    } catch (e) {
      it.speed = 0; it.eta = null;
      if (e.code === 'PAUSED' || it.pausing) it.state = 'paused';
      else if (it.cancelling || e.code === 'CANCELLED') { it.state = 'cancelled'; this.cleanup(it); }
      else { it.state = 'error'; it.error = e.message || String(e); }
    }
    it.ctrl = null; it.proc = null; this.push(it, true); this.persist(); this.pump();
  }

  /** Resumable HTTP download into `part`, continuing from whatever is already on disk. `span` maps it onto a slice of overall progress. */
  async fetchTo(it, url, part, { offset = 0, span = [0, 1] } = {}) {
    for (let attempt = 0; ; attempt++) {
      const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
      const ctrl = it.ctrl = new AbortController();
      const arm = () => setTimeout(() => ctrl.abort(new Error('Connection stalled')), STALL_MS); let stall = arm();
      try {
        const res = await fetch(url, { headers: { 'User-Agent': this.ua, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: ctrl.signal, redirect: 'follow' });
        if (res.status === 416 && have) { clearTimeout(stall); return have; }               // already complete
        if (!res.ok || !res.body) throw Object.assign(new Error('HTTP ' + res.status), { fatal: res.status >= 400 && res.status < 500 && res.status !== 429 });
        let start = have;
        if (have && res.status !== 206) { fs.rmSync(part, { force: true }); start = 0; }     // server ignored Range: start over
        const len = Number(res.headers.get('content-length')) || 0, cr = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
        const total = cr ? +cr[1] : len ? start + len : 0;
        const src = Readable.fromWeb(res.body); let got = start;
        src.on('data', c => {
          got += c.length; clearTimeout(stall); stall = arm();
          this.meter(it, offset + got, total ? span[0] + (span[1] - span[0]) * (got / total) : null);
        });
        await pipeline(src, fs.createWriteStream(part, { flags: start ? 'a' : 'w' }));
        clearTimeout(stall); return got;
      } catch (e) {
        clearTimeout(stall);
        if (it.pausing) throw abortErr('PAUSED', 'paused');
        if (it.cancelling) throw abortErr('CANCELLED', 'Cancelled');
        const why = ctrl.signal.reason?.message || e.cause?.message || e.message;
        if (e.fatal || attempt >= RETRIES - 1) throw new Error(why);
        it.error = `Retrying (${attempt + 1}/${RETRIES - 1}): ${why}`; this.push(it, true); await sleep(800 * 2 ** attempt);
        it.error = null;
      }
    }
  }

  async runMuxed(it) {
    const ext = it.opt.ext || extOf(it.opt.url) || 'mp4';
    it.file ||= this.nameFor(it, ext);
    await this.fetchTo(it, it.opt.url, it.file + '.part');
    fs.renameSync(it.file + '.part', it.file);
  }

  async runSplit(it) {
    const vext = it.opt.ext || extOf(it.opt.url) || 'mp4';
    const container = it.format === 'mkv' ? 'mkv' : (vext === 'webm' || it.format === 'webm') ? 'webm' : 'mp4';
    it.file ||= this.nameFor(it, container);
    const vp = it.file + '.v.part', ap = it.file + '.a.part';
    const vBytes = await this.fetchTo(it, it.opt.url, vp, { span: [0, 0.85] });
    await this.fetchTo(it, it.opt.audioUrl, ap, { offset: vBytes, span: [0.85, 0.95] });
    await this.mux(it, [vp, ap], container);
    fs.rmSync(vp, { force: true }); fs.rmSync(ap, { force: true });
  }

  /** HLS without ffmpeg's network stack: fetch the segments ourselves (4 in parallel, in order), so progress, pause, retry and cancel are real. */
  async fetchHls(it, playlistUrl, part, { span = [0, 1] } = {}) {
    const pl = parseMedia(await this.text(playlistUrl), playlistUrl);
    if (pl.encrypted) throw new Error('This stream is encrypted (' + pl.encrypted + ') and can\u2019t be downloaded');
    if (pl.live) throw new Error('Live streams can\u2019t be downloaded');
    if (!pl.segments.length) throw new Error('The playlist has no segments');
    const jobs = [...(pl.map ? [pl.map] : []), ...pl.segments], key = part;
    const st = (it.hls ||= {})[key] ||= { idx: 0, bytes: 0 };
    if (fs.existsSync(part)) fs.truncateSync(part, st.bytes); else { st.idx = 0; st.bytes = 0; }
    const ctrl = it.ctrl = new AbortController(), out = fs.createWriteStream(part, { flags: st.bytes ? 'a' : 'w' });
    const get = async seg => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(seg.url, { headers: { 'User-Agent': this.ua, ...(seg.range ? { Range: `bytes=${seg.range[0]}-${seg.range[1]}` } : {}) }, signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(STALL_MS)]) });
          if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { fatal: res.status >= 400 && res.status < 500 && res.status !== 429 });
          let buf = Buffer.from(await res.arrayBuffer()); if (seg.range && res.status === 200) buf = buf.subarray(seg.range[0], seg.range[1] + 1);
          return buf;
        } catch (e) {
          if (it.pausing || it.cancelling) throw e; if (e.fatal || attempt >= RETRIES - 1) throw e; await sleep(600 * 2 ** attempt);
        }
      }
    };
    try {
      for (let i = st.idx; i < jobs.length; i += 4) {
        const bufs = await Promise.all(jobs.slice(i, i + 4).map(get));
        for (const b of bufs) { if (!out.write(b)) await new Promise(r => out.once('drain', r)); st.bytes += b.length; }
        st.idx = Math.min(jobs.length, i + 4); it.received = (it.received || 0);
        this.meter(it, st.bytes + (it.base0 || 0), span[0] + (span[1] - span[0]) * (st.idx / jobs.length));
      }
    } catch (e) {
      await new Promise(r => out.end(r));
      if (it.pausing) throw abortErr('PAUSED', 'paused'); if (it.cancelling) throw abortErr('CANCELLED', 'Cancelled');
      throw new Error(e.cause?.message || e.message);
    }
    await new Promise(r => out.end(r)); return st.bytes;
  }

  async runHls(it) {
    const variants = parseMaster(await this.text(it.opt.url), it.opt.url);
    let video = it.opt.url, audio = it.opt.audioUrl;
    if (variants?.length) {
      const want = it.opt.height || 99999, v = variants.find(x => x.height && x.height <= want) || variants[variants.length - 1];
      video = v.url; audio = v.audioUrl || audio; if (v.height && !it.opt.height) it.quality = v.height + 'p';
    }
    const container = it.format === 'mkv' ? 'mkv' : it.format === 'webm' ? 'webm' : 'mp4';
    it.file ||= this.nameFor(it, container);
    const vp = it.file + '.v.part', ap = it.file + '.a.part';
    await this.fetchHls(it, video, vp, { span: [0, audio ? 0.8 : 0.92] });
    if (audio) await this.fetchHls(it, audio, ap, { span: [0.8, 0.92] });
    await this.mux(it, audio ? [vp, ap] : [vp], container);
    fs.rmSync(vp, { force: true }); fs.rmSync(ap, { force: true }); delete it.hls;
  }

  /** Remux local part files into one container. -c copy: never re-encodes. */
  async mux(it, parts, container) {
    it.state = 'merging'; this.push(it, true);
    const ins = parts.flatMap(p => ['-protocol_whitelist', 'file', '-i', p]);
    const maps = ['-map', '0:v:0', '-map', parts.length > 1 ? '1:a:0' : '0:a:0?'];
    const run = (fmt, out, faststart) => this.ffmpegJob(it, [...ins, ...maps, '-c', 'copy', ...(faststart ? ['-movflags', '+faststart'] : []), '-f', fmt, out + '.mux.part'], it.dur);
    const out = it.file;
    try { await run(container === 'mkv' ? 'matroska' : container, out, container === 'mp4'); fs.renameSync(out + '.mux.part', out); }
    catch (e) {
      if (e.code === 'CANCELLED' || container === 'mkv') throw e;
      const alt = out.replace(/\.[^.]+$/, '.mkv');                  // the codecs can't live in this container (e.g. VP9 in MP4)
      await run('matroska', alt, false); fs.renameSync(alt + '.mux.part', alt); it.file = alt;
    }
    it.state = 'active';
  }

  async runAudio(it, fmt) {
    it.file ||= this.nameFor(it, fmt.ext);
    const src = it.file + '.src.part';
    if (!fs.existsSync(src) || !it.srcDone) {
      let url = it.opt.audioUrl || it.opt.url;
      if (it.kind === 'hls') {
        const vs = parseMaster(await this.text(it.opt.url), it.opt.url);
        if (vs?.length) url = vs.find(v => v.audioUrl)?.audioUrl || [...vs].sort((a, b) => (a.height || 9e9) - (b.height || 9e9))[0].url;
        await this.fetchHls(it, url, src, { span: [0, 0.85] });
      } else await this.fetchTo(it, url, src, { span: [0, 0.85] });
      it.srcDone = true;
    }
    let codec = fmt.codec;                                           // stream-copy when the source already has the right codec
    const p = await probe(src).catch(e => { throw new Error('The source is not playable audio: ' + e.message); });
    if (!p.audio.length) throw new Error('This stream has no audio track');
    if (fmt.keep.includes(p.audio[0].codec)) codec = ['-c:a', 'copy'];
    await this.ffmpegJob(it, ['-protocol_whitelist', 'file', '-i', src, '-vn', '-map', '0:a:0', ...codec, '-f', fmt.mux, it.file + '.mux.part'], p.duration || it.dur);
    fs.renameSync(it.file + '.mux.part', it.file); fs.rmSync(src, { force: true }); it.srcDone = false;
  }

  async text(url) {
    const res = await fetch(url, { headers: { 'User-Agent': this.ua }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.text()).slice(0, 2e6);
  }

  ffmpegJob(it, args, dur) {
    const out = args[args.length - 1];
    const job = runFfmpeg(args, { onProgress: p => {
      if (p.size != null) this.meter(it, p.size, null);
      if (p.timeSec != null && dur) it.progress = Math.max(it.progress || 0, Math.min(0.99, p.timeSec / dur));
      this.push(it);
    } });
    it.proc = job;
    return job.promise.catch(e => { fs.rmSync(out, { force: true }); throw e; }).finally(() => { if (it.proc === job) it.proc = null; });
  }

  async verify(it) {
    it.state = 'verifying'; this.push(it, true);
    if (!it.file || !fs.existsSync(it.file)) throw new Error('The file was not created');
    const size = fs.statSync(it.file).size; if (size < 1024) { fs.rmSync(it.file, { force: true }); throw new Error('The downloaded file is empty'); }
    it.received = it.total = size;
    let p;
    try { p = await probe(it.file); }
    catch (e) {
      if (e.code === 'NO_FFPROBE') { it.verified = false; return; }
      fs.rmSync(it.file, { force: true }); throw new Error('The downloaded file is not playable media: ' + e.message);
    }
    const wantVideo = !AUDIO_FORMATS[it.format], v = p.video[0], a = p.audio[0];
    if (wantVideo && !v) { fs.rmSync(it.file, { force: true }); throw new Error('The downloaded file has no video track'); }
    if (!a) { fs.rmSync(it.file, { force: true }); throw new Error('The downloaded file has no audio track (the provider served a video-only stream)'); }
    it.streams = { video: v ? `${v.width}x${v.height} ${v.codec}` : null, audio: a.codec, duration: Math.round(p.duration) };
    if (v?.height && it.quality === 'Original') it.quality = v.height + 'p';
    it.verified = true;
  }
}

module.exports = { Downloads, safe, AUDIO_FORMATS };
