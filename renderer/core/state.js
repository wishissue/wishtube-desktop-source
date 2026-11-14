import { Ranker } from '../rec/engine.js';
import { SOURCE_IDS, creatorKey } from './models.js';

const DEFAULTS = {
  theme: 'terminal', accent: null, density: 'comfortable', sidebar: true, sources: Object.fromEntries(SOURCE_IDS.map(s => [s, true])), order: SOURCE_IDS,
  ptInstance: 'https://framatube.org', mature: false, languages: ['en'], explore: 0.35, freshness: 0.5, diversity: 0.6,
  autoplay: true, motion: true, closeToTray: false, downloadDir: null, onboarded: false, interests: [],
};
const EMPTY_LIB = { liked: {}, saved: {}, later: {}, history: [], follows: {}, hiddenCreators: [], hiddenVideos: [], resume: {} };
const slim = v => { const { _lang, ...r } = v; return { ...r, desc: (r.desc || '').slice(0, 1200) }; };

class Bus { constructor() { this.l = {}; } on(e, f) { (this.l[e] ||= new Set()).add(f); return () => this.l[e].delete(f); } emit(e, d) { this.l[e]?.forEach(f => f(d)); } }

export const state = {
  bus: new Bus(), settings: { ...DEFAULTS }, lib: structuredClone(EMPTY_LIB), ranker: new Ranker(), known: new Map(), ready: false,

  async load() {
    const [s, l, p] = await Promise.all([window.wt.get('settings', null), window.wt.get('library', null), window.wt.get('profile', null)]);
    this.settings = { ...DEFAULTS, ...(s || {}), sources: { ...DEFAULTS.sources, ...(s?.sources || {}) } };
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
    const r = document.documentElement; let t = this.settings.theme;
    if (t === 'dark') t = 'terminal'; else if (t === 'light') t = 'classic'; else if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'classic' : 'terminal';
    if (!['terminal', 'glass', 'bit', 'classic'].includes(t)) t = 'terminal';
    r.dataset.theme = t;
    if (this.settings.accent && this.settings.accent !== '#7c8cff') r.style.setProperty('--accent', this.settings.accent); else r.style.removeProperty('--accent');
    r.classList.toggle('no-motion', !this.settings.motion);
    document.body?.classList.toggle('compact', this.settings.density === 'compact');
    document.body?.classList.toggle('collapsed', !this.settings.sidebar);
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
