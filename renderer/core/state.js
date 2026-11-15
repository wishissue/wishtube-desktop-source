import { Queue } from './queue.js';
import { Ranker } from '../rec/engine.js';
import { normalizeTheme } from './themes.js';
import { SOURCE_IDS, creatorKey } from './models.js';

const DEFAULTS = {
  theme: 'terminal', accent: null, density: 'comfortable', sidebar: true, sources: Object.fromEntries(SOURCE_IDS.map(s => [s, true])), order: SOURCE_IDS,
  ptInstance: 'https://framatube.org', mature: false, languages: ['en'], explore: 0.35, freshness: 0.5, diversity: 0.6,
  autoplay: true, motion: true, motionLevel: 'full', closeToTray: false, downloadDir: null, onboarded: false, interests: [],
  font: 'theme', uiScale: 1, thumbSize: 272, radius: null, rail: 'full', railSide: 'left', nav: {}, bgMode: 'theme', bgPreset: 'aurora', bgBlur: 0, bgDim: 0.35, panelOpacity: 0.72,
  player: { speed: 1, skip: 10, captions: false, theater: false, rememberVolume: true },
};
const EMPTY_LIB = { liked: {}, saved: {}, later: {}, playlists: {}, history: [], follows: {}, hiddenCreators: [], hiddenVideos: [], resume: {}, searches: [] };
export const FONTS = { theme: null, inter: 'Inter, system-ui, sans-serif', noto: '\"Noto Sans\", system-ui, sans-serif', mono: '\"JetBrains Mono\", ui-monospace, monospace', system: 'system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif', serif: 'Georgia, \"Times New Roman\", serif' };
export const BG_PRESETS = {
  aurora: 'radial-gradient(60vw 50vh at 10% 0%, #3b5bdb88, transparent 65%), radial-gradient(50vw 50vh at 95% 30%, #c026d388, transparent 65%), radial-gradient(60vw 50vh at 40% 105%, #0ea5a588, transparent 65%), #070912',
  sunset: 'linear-gradient(160deg, #1b1035 0%, #5a1e6b 38%, #d1495b 72%, #f4a259 100%)',
  ocean: 'linear-gradient(170deg, #021a2e 0%, #05526e 45%, #0a8aa0 80%, #3cc6b8 100%)',
  forest: 'linear-gradient(165deg, #06120c 0%, #0f3d2a 50%, #2f7d4a 100%)',
  graphite: 'linear-gradient(160deg, #0d0e11 0%, #22252c 55%, #3a3f4a 100%)',
  paper: 'linear-gradient(160deg, #f7f3ea 0%, #e9e2d0 100%)',
};
/** Readable text colour for an accent background. */
export function contrast(hex) { const n = parseInt((hex || '#000').replace('#', '').padEnd(6, '0').slice(0, 6), 16), l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#000' : '#fff'; }
const slim = v => { const { _lang, ...r } = v; return { ...r, desc: (r.desc || '').slice(0, 1200) }; };

class Bus { constructor() { this.l = {}; } on(e, f) { (this.l[e] ||= new Set()).add(f); return () => this.l[e].delete(f); } emit(e, d) { this.l[e]?.forEach(f => f(d)); } }

export const state = {
  bus: new Bus(), settings: { ...DEFAULTS }, lib: structuredClone(EMPTY_LIB), ranker: new Ranker(), known: new Map(), ready: false, vq: new Queue(),

  async load() {
    const [s, l, p] = await Promise.all([window.wt.get('settings', null), window.wt.get('library', null), window.wt.get('profile', null)]);
    this.settings = { ...DEFAULTS, ...(s || {}), sources: { ...DEFAULTS.sources, ...(s?.sources || {}) }, player: { ...DEFAULTS.player, ...(s?.player || {}) }, nav: { ...(s?.nav || {}) } };
    this.bgImage = await window.wt.get('bgimage', null);
    this.lib = { ...structuredClone(EMPTY_LIB), ...(l || {}) };
    this.ranker = new Ranker(p || undefined, this.settings);
    this.ready = true;
    this.applyTheme();
    for (const v of [...Object.values(this.lib.liked), ...Object.values(this.lib.saved), ...Object.values(this.lib.later), ...this.lib.history.map(h => h.video)]) if (v) this.known.set(v.id, v);
  },
  saveSettings() { this.ranker.setSettings(this.settings); window.wt.set('settings', this.settings); this.applyTheme(); this.bus.emit('settings'); },
  saveLib() { window.wt.set('library', this.lib); this.bus.emit('library'); },
  saveProfile: (() => { let t; return function () { clearTimeout(t); t = setTimeout(() => { window.wt.set('profile', state.ranker.toJSON()); }, 3000); }; })(),
  flushProfile() { window.wt.set('profile', this.ranker.toJSON()); },

  applyTheme() {
    const r = document.documentElement, t = normalizeTheme(this.settings.theme), S = this.settings;
    const apply = () => {
      r.dataset.theme = t;
      const cl = r.classList, st = r.style, set = (k, v) => v == null ? st.removeProperty(k) : st.setProperty(k, v);
      if (S.accent && S.accent !== '#7c8cff') { st.setProperty('--accent', S.accent); st.setProperty('--on-accent', contrast(S.accent)); st.setProperty('--prog', S.accent); } else ['--accent', '--on-accent', '--prog'].forEach(k => st.removeProperty(k));
      const level = S.motion === false ? 'off' : S.motionLevel || 'full';
      cl.toggle('no-motion', level === 'off'); cl.toggle('calm', level === 'reduced');
      set('--user-font', FONTS[S.font] || null); set('--ui-scale', S.uiScale && S.uiScale !== 1 ? S.uiScale : null);
      set('--col', S.thumbSize && S.thumbSize !== 272 ? S.thumbSize + 'px' : null);
      for (const d of ['compact', 'comfortable', 'spacious']) cl.toggle('dens-' + d, S.density === d);
      cl.toggle('custom-r', S.radius != null); set('--cr', S.radius != null ? S.radius + 'px' : null);
      for (const m of ['full', 'icons', 'hidden']) cl.toggle('rail-' + m, S.rail === m);
      cl.toggle('rail-right', S.railSide === 'right');
      // background: a built-in gradient or the user's own image sits behind translucent panels
      const bg = document.getElementById('bg'), on = S.bgMode === 'preset' || (S.bgMode === 'image' && this.bgImage);
      cl.toggle('has-bg', !!on); set('--panel-op', S.panelOpacity * 100 + '%'); set('--bg-dim', S.bgDim); set('--bg-blur', S.bgBlur + 'px');
      if (bg) bg.style.backgroundImage = !on ? '' : S.bgMode === 'image' ? `url("${this.bgImage}")` : BG_PRESETS[S.bgPreset] || BG_PRESETS.aurora;
    };
    // smooth cross-fade between themes (Chromium View Transitions), skipped on first paint and with motion off
    if (this._themed && this._themed !== t && this.settings.motion !== false && this.settings.motionLevel !== 'off' && document.startViewTransition) document.startViewTransition(apply); else apply();
    this._themed = t;
  },

  follows() { return new Set(Object.keys(this.lib.follows)); },
  hidden() { return { creators: new Set(this.lib.hiddenCreators), videos: new Set(this.lib.hiddenVideos) }; },
  isFollowing: function (v) { return !!this.lib.follows[creatorKey(v)]; },
  remember(v) { this.known.set(v.id, v); },

  toggleList(name, v) {
    const l = this.lib[name], on = !l[v.id];
    if (on) { l[v.id] = slim(v); if (name === 'liked') this.ranker.record(v, 'like'); if (name === 'saved') this.ranker.record(v, 'save'); if (name === 'later') this.ranker.record(v, 'later'); }
    else { delete l[v.id]; if (name === 'liked') this.ranker.record(v, 'unlike'); }
    this.saveLib(); this.saveProfile(); return on;
  },
  toggleFollow(v, info = {}) {
    const k = creatorKey(v), on = !this.lib.follows[k];
    if (on) { this.lib.follows[k] = { source: v.source, creatorId: v.creatorId, name: info.name || v.creator, avatar: info.avatar || null }; this.ranker.record(v, 'follow'); }
    else { delete this.lib.follows[k]; this.ranker.record(v, 'unfollow'); }
    this.saveLib(); this.saveProfile(); return on;
  },
  notInterested(v) { this.lib.hiddenVideos.push(v.id); this.ranker.record(v, 'hide'); this.saveLib(); this.saveProfile(); },
  hideCreator(v) { this.lib.hiddenCreators.push(creatorKey(v)); this.ranker.record(v, 'hideCreator'); this.saveLib(); this.saveProfile(); },
  addHistory(v, progress, dur) {
    const h = this.lib.history, i = h.findIndex(x => x.id === v.id), e = { id: v.id, t: Date.now(), progress, dur, video: slim(v) };
    if (i >= 0) h.splice(i, 1); h.unshift(e); if (h.length > 600) h.length = 600;
    this.saveLib();
  },
  /* ---- playlists: user-made, stored locally ---- */
  createPlaylist(name) { const id = 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); this.lib.playlists[id] = { id, name: String(name).trim().slice(0, 80) || 'Playlist', created: Date.now(), items: [] }; this.saveLib(); return id; },
  addToPlaylist(pid, v) { const p = this.lib.playlists[pid]; if (!p || p.items.some(x => x.id === v.id)) return false; p.items.push(slim(v)); this.ranker.record(v, 'save'); this.saveLib(); return true; },
  removeFromPlaylist(pid, vid) { const p = this.lib.playlists[pid]; if (p) { p.items = p.items.filter(x => x.id !== vid); this.saveLib(); } },
  movePlaylistItem(pid, from, to) { const p = this.lib.playlists[pid]; if (!p || from === to) return; const [x] = p.items.splice(from, 1); p.items.splice(to, 0, x); this.saveLib(); },
  renamePlaylist(pid, name) { const p = this.lib.playlists[pid]; if (p && name.trim()) { p.name = name.trim().slice(0, 80); this.saveLib(); } },
  deletePlaylist(pid) { delete this.lib.playlists[pid]; this.saveLib(); },
  addSearch(q) { q = q.trim().slice(0, 200); if (!q || /^https?:\/\//i.test(q)) return; this.lib.searches = [q, ...this.lib.searches.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 30); this.saveLib(); },
  removeSearch(q) { this.lib.searches = this.lib.searches.filter(x => x !== q); this.saveLib(); },
  clearSearches() { this.lib.searches = []; this.saveLib(); },
  setResume(id, sec) { this.lib.resume[id] = sec; window.wt.set('library', this.lib); },

  exportProfile() { return JSON.stringify({ app: 'wishtube', v: 2, settings: this.settings, library: this.lib, profile: this.ranker.toJSON() }); },
  async importProfile(text) {
    const d = JSON.parse(text); if (d.app !== 'wishtube') throw new Error('Not a WishTube profile');
    if (d.settings) this.settings = { ...DEFAULTS, ...d.settings };
    if (d.library) this.lib = { ...structuredClone(EMPTY_LIB), ...d.library };
    if (d.profile) this.ranker = new Ranker(d.profile, this.settings);
    this.saveSettings(); this.saveLib(); this.flushProfile();
  },
};
