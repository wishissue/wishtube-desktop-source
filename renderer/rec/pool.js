import { state } from '../core/state.js';
import { sources } from '../sources/manager.js';

/** Persistent candidate pool: feed opens instantly from cache, then refreshes in the background. */
export const pool = {
  videos: [], t: 0, refreshing: false,
  async load() {
    const c = await window.wt.get('pool', null);
    if (c?.videos?.length) { this.videos = c.videos; this.t = c.t; c.videos.forEach(v => state.remember(v)); }
  },
  stale() { return Date.now() - this.t > 15 * 60 * 1000; },
  async refresh(onPart) {
    if (this.refreshing) return; this.refreshing = true;
    try {
      const fresh = await sources.buildPool({ ranker: state.ranker, pages: 2, onPart: all => onPart?.(this.merge(all, false)) });
      const known = new Set(this.videos.map(v => v.id)), newcomers = fresh.filter(v => !known.has(v.id));
      state.ranker.observe(newcomers);                               // teaches the semantic layer from everything new we see
      this.merge(fresh, true);
      this.t = Date.now();
      window.wt.set('pool', { t: this.t, videos: this.videos.map(({ _lang, ...v }) => ({ ...v, desc: (v.desc || '').slice(0, 500) })) });
      state.saveProfile();
    } finally { this.refreshing = false; }
  },
  /** Merge by id, newest fetch wins, cap at 1500, drop the stalest. */
  merge(list, commit) {
    const m = new Map(this.videos.map(v => [v.id, v]));
    for (const v of list) m.set(v.id, v);
    const out = [...m.values()].slice(-1500);
    if (commit) this.videos = out;
    return out;
  },
};
