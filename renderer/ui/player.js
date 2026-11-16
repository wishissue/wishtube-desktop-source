import { h, fmtDur, toast } from './dom.js';
import { icon } from './icons.js';
import { trace } from '../core/trace.js';
import { net, friendly } from '../core/net.js';
import { terminal } from './terminal.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const mod = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Self-built player: native <video> + hls.js, own controls, URL fallback chain, chapter ticks,
 * quality / speed / caption menus, full keyboard map, PiP, MediaSession, and watch-time accounting.
 */
export class Player {
  constructor({ video, stream, chapters = [], onTheater, onEnded, onNext, onPrev, onBrowser, startAt = 0, prefs, opts = {} }) {
    this.o = { speed: 1, skip: 10, captions: false, ...opts };
    this.onNext = onNext; this.onPrev = onPrev; this.onBrowser = onBrowser;
    this.v = video; this.stream = stream; this.chapters = chapters; this.onEnded = onEnded; this.onTheater = onTheater;
    this.watched = 0; this.maxPos = 0; this.last = null; this.urlIdx = 0; this.hls = null; this.startAt = startAt; this.menu = null; this.prefs = prefs;
    this.el = h('div.player', { tabIndex: 0 });
    this.media = h('video', { playsInline: true, crossOrigin: 'anonymous', preload: 'auto' });
    this.scope = opts.scope || 'play:' + video.id; this.T = trace.scoped(this.scope); this.t0 = opts.since || Date.now();
    this.pload = h('div.pload'); this.term = null; this.pinned = false; this.playedOnce = false; this.lazyTried = false;
    this.err = null;
    this.buildControls();
    this.el.append(this.media, h('div.topfade', video.title), this.pload, this.ctrls);
    this.bind();
    this.load(0);
  }

  /* ---------- live log (replaces the spinner) ---------- */
  /** Show exactly what is happening for this video. Hidden again as soon as it plays, unless pinned from the controls. */
  showLoad(title = 'WishTube · loading this video') {
    if (this.term) return;
    this.term = terminal({ scopes: [this.scope], since: this.t0, title, max: 10, className: 'over', headline: () => this.playedOnce ? 'Buffering' : 'Starting playback' });
    this.pload.replaceChildren(this.term.el);
  }
  hideLoad() { this.term?.stop(); this.term = null; this.pload.replaceChildren(); }

  /* ---------- loading with fallback ---------- */
  load(i) {
    const url = this.stream.urls[i]; this.urlIdx = i; clearTimeout(this.wd);
    if (!url) return this.exhausted();
    this.destroyHls(); this.err?.remove(); this.err = null; this.tTry = Date.now();
    const isHls = /\.m3u8(\?|$)/.test(url), n = this.stream.urls.length, T = this.T;
    T.info(`Trying stream ${i + 1} of ${n}: ${net.host(url)}${isHls ? ' (HLS adaptive)' : ''}`);
    if (!this.playedOnce) this.showLoad();
    const ok = () => { if (this.startAt > 5 && !this.started) { this.media.currentTime = this.startAt; T.info(`Resuming from ${fmtDur(this.startAt)}`); } if (!this.started) { this.media.playbackRate = this.o.speed || 1; if (this.o.captions) this.media.addEventListener('loadedmetadata', () => { const t = this.media.textTracks[0]; if (t) t.mode = 'showing'; }, { once: true }); } this.started = true; };
    if (isHls && window.Hls?.isSupported()) {
      const E = window.Hls.Events, hls = this.hls = new window.Hls({ maxBufferLength: 60, maxMaxBufferLength: 120, capLevelToPlayerSize: false, startLevel: -1, enableWorker: true, backBufferLength: 90 });
      hls.loadSource(url); hls.attachMedia(this.media);
      hls.on(E.MANIFEST_LOADING, () => T.info('Downloading the playlist…'));
      hls.on(E.MANIFEST_PARSED, (_e, d) => { ok(); T.ok(`Playlist ready: ${d.levels.length} quality level${d.levels.length === 1 ? '' : 's'} (${[...new Set(d.levels.map(l => l.height).filter(Boolean))].sort((a, b) => b - a).join('p, ')}p)`); this.media.play().catch(() => {}); this.levels = hls.levels; });
      hls.once(E.FRAG_LOADED, (_e, d) => T.ok(`First segment received (${Math.round((d.frag.stats.loaded || 0) / 1024)} KB in ${Math.round(d.frag.stats.loading.end - d.frag.stats.loading.start)} ms)`));
      hls.on(E.LEVEL_SWITCHED, (_e, d) => { const l = hls.levels[d.level]; if (l?.height) T.info(`Quality: ${l.height}p${hls.autoLevelEnabled ? ' (automatic)' : ''}`); });
      hls.on(E.ERROR, (_e, d) => {
        if (!d.fatal) { T.warn(`Hiccup: ${d.details}${d.response?.code ? ' (HTTP ' + d.response.code + ')' : ''}`); return; }
        if (d.type === window.Hls.ErrorTypes.NETWORK_ERROR && (this.retry = (this.retry || 0) + 1) < 3) { T.warn(`Network error (${d.details}) — retry ${this.retry} of 2`); hls.startLoad(); }
        else if (d.type === window.Hls.ErrorTypes.MEDIA_ERROR && (this.mretry = (this.mretry || 0) + 1) < 3) { T.warn(`Decoder error (${d.details}) — recovering, attempt ${this.mretry} of 2`); hls.recoverMediaError(); }
        else this.next(`HLS failed: ${d.details}`);
      });
    } else {
      this.media.src = url;
      this.media.addEventListener('loadedmetadata', ok, { once: true });
      this.media.play().catch(() => {});
    }
    // Watchdog: a mirror that sends nothing is abandoned instead of waited for.
    this.wd = setTimeout(() => this.stalled(i), this.playedOnce ? 12000 : 9000);
  }
  async stalled(i) {
    if (this.playedOnce || i !== this.urlIdx || this.failedAll) return;
    const rest = this.stream.urls.slice(i + 1);
    this.T.warn(`${net.host(this.stream.urls[i])} produced no video in ${Math.round((Date.now() - this.tTry) / 1000)} s`);
    if (rest.length > 1) { const best = await net.race(rest, { scope: this.scope, timeout: 4000 }); if (i !== this.urlIdx || this.playedOnce) return; this.stream.urls = [...this.stream.urls.slice(0, i + 1), best, ...rest.filter(u => u !== best)]; }
    this.next('switching to the next mirror');
  }
  next(why) { this.T.warn(why); this.load(this.urlIdx + 1); }
  async exhausted() {
    if (this.stream.lazy && !this.lazyTried) {                         // slow last-resort route, asked for only now
      this.lazyTried = true; this.T.info('Every direct mirror failed — asking the network for another route (can take a few seconds)…');
      try { const more = await this.stream.lazy(); if (more.length) { const at = this.stream.urls.length; this.stream.urls.push(...more); this.T.ok(`Got ${more.length} more route${more.length === 1 ? '' : 's'}`); return this.load(at); } this.T.warn('No other route available'); } catch (e) { this.T.warn('Other route failed: ' + friendly(e)); }
    }
    this.fail();
  }
  fail() {
    clearTimeout(this.wd); this.failedAll = true; this.T.err('Every available stream failed');
    this.term?.stop(); this.term = null; this.pload.replaceChildren();
    this.err = h('div.perr', h('div', h('h2', 'This video couldn’t be played'), h('p.sub', 'The source may be down, private, or not available in your country.')),
      h('div.row', { style: { justifyContent: 'center', flexWrap: 'wrap' } }, h('button.btn.pri', { onclick: () => { this.err.remove(); this.err = null; this.failedAll = false; this.lazyTried = false; this.t0 = Date.now(); this.T.info('Trying again from the first stream'); this.load(0); } }, 'Try Again'),
        h('button.btn', { onclick: () => window.wt.openExternal(this.v.url) }, icon('ext', 16), 'Open Original'),
        this.onBrowser ? h('button.btn', { onclick: () => this.onBrowser() }, icon('compass', 16), 'Pretend as Browser') : null));
    this.el.append(this.err);
  }
  destroyHls() { this.hls?.destroy(); this.hls = null; }

  /* ---------- controls ---------- */
  buildControls() {
    const btn = (ic, title, fn) => h('button.iconbtn', { title, onclick: e => { e.stopPropagation(); fn(e); } }, icon(ic, 20));
    this.bPlay = btn('play', 'Play (k)', () => this.toggle());
    this.bMute = btn('vol', 'Mute (m)', () => this.mute());
    this.vol = h('input', { type: 'range', min: 0, max: 1, step: 0.02, value: this.prefs.volume ?? 1, oninput: e => { this.media.volume = +e.target.value; this.media.muted = false; this.prefs.volume = +e.target.value; } });
    this.time = h('span.time', '0:00 / 0:00');
    this.buf = h('div.buf'); this.cur = h('div.cur'); this.knob = h('div.knob'); this.tip = h('div.tip', '0:00');
    this.bar = h('div.bar', this.buf, this.cur, this.knob);
    this.seek = h('div.seek', this.bar, this.tip);
    this.bCC = btn('cc', 'Captions (c)', () => this.captionsMenu());
    this.bSet = btn('gear', 'Quality & speed', () => this.settingsMenu());
    this.bTheater = btn('theater', 'Theater mode (t)', () => this.onTheater?.());
    this.bPip = btn('pip', 'Picture in picture (i)', () => this.pip());
    this.bFull = btn('full', 'Fullscreen (f)', () => this.fullscreen());
    this.ctrls = h('div.ctrls', { onclick: e => e.stopPropagation() }, this.seek,
      h('div.ctrlrow', this.bPlay, h('div.vol', this.bMute, this.vol), this.time, h('div.grow'), this.bCC, this.bSet, this.bPip, this.bTheater, this.bFull));
    this.renderTicks();
    let drag = false;
    const at = e => { const r = this.bar.getBoundingClientRect(); return mod((e.clientX - r.left) / r.width, 0, 1); };
    this.seek.addEventListener('pointerdown', e => { drag = true; this.seek.setPointerCapture(e.pointerId); this.seekTo(at(e) * this.media.duration); });
    this.seek.addEventListener('pointermove', e => { const p = at(e); this.tip.style.left = p * 100 + '%'; const t = p * (this.media.duration || 0), ch = [...this.chapters].reverse().find(c => c.t <= t); this.tip.textContent = fmtDur(t) + (ch ? ' · ' + ch.title : ''); if (drag) this.seekTo(t); });
    this.seek.addEventListener('pointerup', () => { drag = false; });
  }
  renderTicks() { const d = this.media.duration; this.seek.querySelectorAll('.tick').forEach(t => t.remove()); if (d) for (const c of this.chapters) if (c.t > 0) this.bar.append(h('div.tick', { style: { left: (c.t / d) * 100 + '%' } })); }

  setMenu(el) { this.menu?.remove(); this.menu = el; if (el) { this.el.append(el); setTimeout(() => { const off = e => { if (!el.contains(e.target)) { el.remove(); this.menu = null; removeEventListener('pointerdown', off, true); } }; addEventListener('pointerdown', off, true); }, 0); } }
  settingsMenu() {
    const items = [h('h4', 'Speed'), ...SPEEDS.map(s => h('button', { class: this.media.playbackRate === s ? 'sel' : '', onclick: () => { this.media.playbackRate = s; this.flash(s + '×'); this.setMenu(null); } }, s === 1 ? 'Normal' : s + '×'))];
    if (this.hls?.levels?.length > 1) {
      items.push(h('h4', 'Quality'), h('button', { class: this.hls.currentLevel === -1 ? 'sel' : '', onclick: () => { this.hls.currentLevel = -1; this.setMenu(null); } }, 'Auto'));
      [...this.hls.levels].map((l, i) => [l, i]).sort((a, b) => b[0].height - a[0].height).forEach(([l, i]) => items.push(h('button', { class: this.hls.currentLevel === i ? 'sel' : '', onclick: () => { this.hls.currentLevel = i; this.setMenu(null); } }, `${l.height}p`)));
    }
    this.setMenu(h('div.menu', items));
  }
  captionsMenu() {
    const caps = this.stream.captions || [], tracks = [...this.media.textTracks];
    if (!caps.length) return this.flash('No captions available');
    this.setMenu(h('div.menu', h('h4', 'Captions'), h('button', { class: tracks.every(t => t.mode !== 'showing') ? 'sel' : '', onclick: () => { tracks.forEach(t => t.mode = 'disabled'); this.setMenu(null); } }, 'Off'),
      ...caps.map((c, i) => h('button', { class: tracks[i]?.mode === 'showing' ? 'sel' : '', onclick: () => { tracks.forEach((t, j) => t.mode = j === i ? 'showing' : 'disabled'); this.setMenu(null); } }, c.label))));
  }

  /* ---------- actions ---------- */
  toggle() { this.media.paused ? this.media.play().catch(() => {}) : this.media.pause(); }
  mute() { this.media.muted = !this.media.muted; this.flash(this.media.muted ? 'Muted' : 'Unmuted'); }
  seekTo(t) { if (Number.isFinite(t)) { this.media.currentTime = mod(t, 0, this.media.duration || t); this.last = null; } }
  skip(d) { this.seekTo(this.media.currentTime + d); this.flash((d > 0 ? '+' : '−') + Math.abs(d) + 's'); }
  fullscreen() { document.fullscreenElement ? document.exitFullscreen() : this.el.requestFullscreen?.(); }
  pip() { document.pictureInPictureElement ? document.exitPictureInPicture() : this.media.requestPictureInPicture?.().catch(() => toast('Picture-in-picture isn’t available for this stream')); }
  flash(text) { this.el.querySelector('.flash')?.remove(); this.el.append(h('div.flash', text)); setTimeout(() => this.el.querySelector('.flash')?.remove(), 750); }

  bind() {
    const m = this.media;
    m.volume = this.prefs.volume ?? 1;
    m.addEventListener('play', () => { this.bPlay.replaceChildren(icon('pause', 20)); });
    m.addEventListener('pause', () => { this.bPlay.replaceChildren(icon('play', 20)); this.last = null; });
    let waitT = null;
    m.addEventListener('loadedmetadata', () => { this.T.ok(`Stream opened: ${m.videoWidth ? m.videoWidth + '×' + m.videoHeight + ', ' : ''}${fmtDur(m.duration) || 'live'}`); });
    m.addEventListener('waiting', () => { if (!this.playedOnce) return; clearTimeout(waitT); waitT = setTimeout(() => { if (m.readyState < 3 && !m.paused) { this.T.warn(`Buffering at ${fmtDur(m.currentTime) || '0:00'} — waiting for data from ${net.host(this.stream.urls[this.urlIdx] || '')}`); this.showLoad('WishTube · buffering'); } }, 900); });
    m.addEventListener('stalled', () => { if (!this.playedOnce) this.T.warn('The server stopped sending data (stalled)'); });
    m.addEventListener('playing', () => { clearTimeout(waitT); clearTimeout(this.wd); if (!this.playedOnce) { this.playedOnce = true; this.T.ok(`Playing — started in ${((Date.now() - this.t0) / 1000).toFixed(1)} s`); } this.hideLoad(); });
    m.addEventListener('canplay', () => { clearTimeout(waitT); if (!m.paused) this.hideLoad(); });
    m.addEventListener('volumechange', () => { this.bMute.replaceChildren(icon(m.muted || m.volume === 0 ? 'mute' : 'vol', 20)); });
    m.addEventListener('durationchange', () => this.renderTicks());
    m.addEventListener('error', () => { const c = m.error; this.next(`${net.host(this.stream.urls[this.urlIdx] || '')}: ${c ? ['', 'download aborted', 'network error', 'could not decode', 'format not supported'][c.code] || 'media error' : 'media error'}`); });
    m.addEventListener('ended', () => this.onEnded?.());
    m.addEventListener('progress', () => { const d = m.duration; if (d && m.buffered.length) this.buf.style.width = (m.buffered.end(m.buffered.length - 1) / d) * 100 + '%'; });
    m.addEventListener('timeupdate', () => {
      const d = m.duration || 0, t = m.currentTime;
      if (d) { const p = (t / d) * 100; this.cur.style.width = p + '%'; this.knob.style.left = p + '%'; }
      this.time.textContent = `${fmtDur(t) || '0:00'} / ${fmtDur(d) || '0:00'}`;
      if (this.last != null && t > this.last && t - this.last < 2.5) this.watched += (t - this.last) / m.playbackRate;   // real watch time, not seek jumps
      this.last = t; this.maxPos = Math.max(this.maxPos, t);
      this.onTick?.(t);
    });
    this.el.addEventListener('click', e => { if (e.target === m) this.toggle(); });
    this.el.addEventListener('dblclick', e => { if (e.target === m) this.fullscreen(); });
    document.addEventListener('fullscreenchange', this.fsH = () => this.bFull.replaceChildren(icon(document.fullscreenElement === this.el ? 'exitfull' : 'full', 20)));
    let idle; const wake = () => { this.el.classList.remove('idle'); clearTimeout(idle); idle = setTimeout(() => { if (!m.paused && !this.menu) this.el.classList.add('idle'); }, 2600); };
    this.el.addEventListener('mousemove', wake); wake();
    this.keyH = e => {
      if ((/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') || e.target.isContentEditable) return;
      if (e.key === ' ' && /^(BUTTON|A)$/.test(e.target.tagName)) return;   // Space activates a focused button, not the player
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key, dur = m.duration || 0;
      const map = {
        ' ': () => this.toggle(), k: () => this.toggle(), j: () => this.skip(-this.o.skip), l: () => this.skip(this.o.skip), ArrowLeft: () => this.skip(-5), ArrowRight: () => this.skip(5),
        ArrowUp: () => { m.volume = mod(m.volume + 0.05, 0, 1); this.vol.value = m.volume; this.flash(Math.round(m.volume * 100) + '%'); },
        ArrowDown: () => { m.volume = mod(m.volume - 0.05, 0, 1); this.vol.value = m.volume; this.flash(Math.round(m.volume * 100) + '%'); },
        n: () => this.onNext?.(), p: () => this.onPrev?.(), m: () => this.mute(), f: () => this.fullscreen(), t: () => this.onTheater?.(), i: () => this.pip(), c: () => this.captionsMenu(),
        '>': () => { m.playbackRate = SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(m.playbackRate) + 1)] || 1; this.flash(m.playbackRate + '×'); },
        '<': () => { m.playbackRate = SPEEDS[Math.max(0, SPEEDS.indexOf(m.playbackRate) - 1)] || 1; this.flash(m.playbackRate + '×'); },
        ',': () => { m.pause(); m.currentTime -= 1 / 30; }, '.': () => { m.pause(); m.currentTime += 1 / 30; },
        Home: () => this.seekTo(0), End: () => this.seekTo(dur - 1),
      };
      if (/^[0-9]$/.test(k) && dur) { this.seekTo(dur * +k / 10); e.preventDefault(); return; }
      if (map[k]) { map[k](); e.preventDefault(); }
    };
    document.addEventListener('keydown', this.keyH);
    // captions as <track> elements
    (this.stream.captions || []).forEach((c, i) => { const t = h('track', { kind: 'subtitles', src: c.url, srclang: c.lang, label: c.label, default: false }); m.append(t); });
  }

  addMediaSession(v, prev, next) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: v.title, artist: v.creator, artwork: v.thumb ? [{ src: v.thumb }] : [] });
    navigator.mediaSession.setActionHandler('play', () => this.media.play()); navigator.mediaSession.setActionHandler('pause', () => this.media.pause());
    navigator.mediaSession.setActionHandler('seekbackward', () => this.skip(-this.o.skip)); navigator.mediaSession.setActionHandler('seekforward', () => this.skip(this.o.skip));
    navigator.mediaSession.setActionHandler('nexttrack', next || null); navigator.mediaSession.setActionHandler('previoustrack', prev || null);
  }

  /** What the ranker needs to know about this viewing. */
  report() { const d = this.media.duration || this.v.dur || 0; return { seconds: this.watched, completion: d ? Math.min(1, this.maxPos / d) : undefined, position: this.media.currentTime, duration: d }; }

  destroy() {
    document.removeEventListener('keydown', this.keyH); document.removeEventListener('fullscreenchange', this.fsH);
    if (document.pictureInPictureElement === this.media) document.exitPictureInPicture().catch(() => {});
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    clearTimeout(this.wd); this.term?.stop(); this.destroyHls(); this.media.pause(); this.media.removeAttribute('src'); this.media.load(); this.el.remove();
  }
}
