import { Queue } from './queue.js';
import { state } from './state.js';
import { sources } from '../sources/manager.js';

/** Global audio engine: one <audio> element that outlives page navigation, so music keeps playing while you browse (background audio).
 *  Any item can be played as audio, including videos (their audio track). */
const slimItem = v => ({ id: v.id, source: v.source, sid: v.sid, title: v.title, creator: v.creator, creatorId: v.creatorId, thumb: v.thumb, dur: v.dur, url: v.url, tags: (v.tags || []).slice(0, 6), cats: v.cats, license: v.license, date: v.date,
  ...(v.audio ? { audio: true } : {}), ...(v.music ? { music: true } : {}), ...(v.directUrl ? { directUrl: v.directUrl } : {}), ...(v.album ? { album: v.album } : {}), ...(v.albumId ? { albumId: v.albumId } : {}) });

class AudioEngine extends EventTarget {
  constructor() {
    super(); this.q = new Queue(); this.el = new window.Audio(); this.el.preload = 'auto'; this.hls = null; this.token = 0; this.loading = false; this.failed = null; this.urlIdx = 0; this.urls = []; this.ready = false;
    const e = this.el;
    e.addEventListener('play', () => this.emit('state')); e.addEventListener('pause', () => this.emit('state'));
    e.addEventListener('waiting', () => { this.loading = true; this.emit('state'); }); e.addEventListener('playing', () => { this.loading = false; this.emit('state'); });
    e.addEventListener('timeupdate', () => this.emit('tick')); e.addEventListener('durationchange', () => this.emit('tick'));
    e.addEventListener('ended', () => this.advance(true));
    e.addEventListener('error', () => this.fallback());
  }
  emit(t) { this.dispatchEvent(new Event(t)); if (t === 'change') this.persist(); }
  on(t, f) { this.addEventListener(t, f); return () => this.removeEventListener(t, f); }
  get current() { return this.q.current; }
  get playing() { return !this.el.paused; }
  get active() { return !!this.q.current; }

  persist() { clearTimeout(this._p); this._p = setTimeout(() => window.wt.set('queue', { ...this.q.toJSON(), items: this.q.items.map(slimItem) }), 800); }
  restore(saved) { if (saved?.items?.length) { this.q = Queue.from(saved); this.emit('change'); } }

  /* ---- queue operations ---- */
  async playList(items, start = 0) { if (!items.length) return; this.q.load(items.map(slimItem), start); this.emit('change'); await this.startCurrent(); }
  /** Play one item now, keeping the rest of the queue (it is inserted after the current one). */
  async playNow(item) { this.q.add(slimItem(item), { next: true }); this.q.jump(this.q.items.findIndex(x => x.id === item.id)); this.emit('change'); await this.startCurrent(); }
  add(item, { next = false } = {}) { const ok = this.q.add(slimItem(item), { next }); this.emit('change'); if (!this.q.current || (!this.playing && this.q.length === 1)) this.startCurrent(); return ok; }
  addMany(items) { items.forEach(i => this.q.add(slimItem(i))); this.emit('change'); }
  remove(i) { const wasCur = i === this.q.index; this.q.remove(i); this.emit('change'); if (wasCur) { if (this.q.current) this.startCurrent(); else this.stop(); } }
  move(a, b) { this.q.move(a, b); this.emit('change'); }
  clear() { this.q.clear(true); this.emit('change'); if (!this.q.current) this.stop(); }
  jump(i) { if (this.q.jump(i)) { this.emit('change'); this.startCurrent(); } }
  toggleShuffle() { this.q.setShuffle(!this.q.shuffle); this.emit('change'); }
  cycleRepeat() { this.q.cycleRepeat(); this.emit('change'); }

  /* ---- transport ---- */
  toggle() { if (!this.q.current) return; if (!this.el.src && !this.hls) return this.startCurrent(); this.el.paused ? this.el.play().catch(() => {}) : this.el.pause(); }
  pause() { this.el.pause(); }
  next() { this.advance(false); }
  prev() { if (this.el.currentTime > 3) { this.el.currentTime = 0; return; } if (this.q.prev()) { this.emit('change'); this.startCurrent(); } }
  seek(t) { if (Number.isFinite(t)) this.el.currentTime = Math.max(0, Math.min(t, this.el.duration || t)); }
  setVolume(v) { this.el.volume = Math.max(0, Math.min(1, v)); this.emit('state'); }
  stop() { this.token++; this.el.pause(); this.destroyHls(); this.el.removeAttribute('src'); this.el.load(); this.q.clear(); this.emit('change'); this.emit('state'); this.setSession(null); }
  advance(auto) { const n = this.q.next(auto); this.emit('change'); if (n) this.startCurrent(); else { this.emit('state'); } }

  /* ---- loading ---- */
  destroyHls() { this.hls?.destroy(); this.hls = null; }
  async startCurrent() {
    const item = this.q.current; if (!item) return; const my = ++this.token; this.failed = null; this.loading = true; this.emit('state'); this.setSession(item);
    document.querySelectorAll('.player video').forEach(v => v.pause());     // never two sounds at once
    try {
      let urls = item.directUrl ? [item.directUrl] : null;
      if (!urls) {
        const st = await sources.stream(item); if (my !== this.token) return;
        if (st.tracks?.length && !item.directUrl) {                         // an album: replace it with its tracks, play the first
          const tr = st.tracks.map((t, i) => ({ id: `${item.id}#${i}`, source: item.source, sid: item.sid, title: t.title, creator: t.artist || item.creator, creatorId: item.creatorId, thumb: item.thumb, dur: t.dur, url: item.url, directUrl: t.url, album: item.title, albumId: item.id, audio: true, music: true }));
          const at = this.q.index; this.q.items.splice(at, 1, ...tr); this.q._reorder(); this.emit('change'); return this.startCurrent();
        }
        urls = st.urls;
      }
      this.urls = urls; this.load(0, my);
    } catch (e) { if (my === this.token) this.fail(e.message); }
  }
  load(i, my) {
    const url = this.urls[i]; this.urlIdx = i; if (!url) return this.fail('No playable audio stream');
    this.destroyHls();
    if (/\.m3u8(\?|$)/.test(url) && window.Hls?.isSupported()) {
      const hls = this.hls = new window.Hls({ maxBufferLength: 40, enableWorker: true }); hls.loadSource(url); hls.attachMedia(this.el);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => { if (my === this.token) this.el.play().catch(() => {}); });
      hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal && my === this.token) this.load(i + 1, my); });
    } else { this.el.src = url; this.el.play().catch(() => {}); }
  }
  fallback() { if (!this.urls.length || this.failed) return; if (this.urlIdx + 1 < this.urls.length) this.load(this.urlIdx + 1, this.token); else this.fail('This track couldn’t be played'); }
  fail(msg) {
    this.failed = msg; this.loading = false; this.emit('state');
    import('../ui/dom.js').then(m => m.toast(`${msg}. Skipping…`, 2600));
    const t = this.token; setTimeout(() => { if (t === this.token && this.q.next(true)) { this.emit('change'); this.startCurrent(); } }, 900);       // a dead track must not stall the queue
  }

  setSession(item) {
    if (!('mediaSession' in navigator)) return;
    if (!item) { navigator.mediaSession.metadata = null; return; }
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.creator, album: item.album || '', artwork: item.thumb ? [{ src: item.thumb }] : [] });
    const A = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported action */ } };
    A('play', () => this.toggle()); A('pause', () => this.pause()); A('nexttrack', () => this.next()); A('previoustrack', () => this.prev()); A('seekto', d => this.seek(d.seekTime));
  }
}

export const audio = new AudioEngine();
