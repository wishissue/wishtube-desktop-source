import { state } from '../core/state.js';
import { sources } from '../sources/manager.js';
import { trace } from '../core/trace.js';
import { feedSettings } from './filters.js';

const CAP = 1500, DAY = 86400000;

/** Persistent candidate pool: feed opens instantly from cache, then refreshes in the background.
 *  Every refresh asks the sources for different things (see sources.buildPool), and videos first seen in the last day
 *  that you have never been shown are "new": the feed puts a share of them near the top. */
export const pool = {
  videos: [], t: 0, refreshing: false, cursor: 0,
  async load() {
    const c = await window.wt.get('pool', null);
    if (c?.videos?.length) { this.videos = c.videos; this.t = c.t; this.cursor = c.cursor || 0; c.videos.forEach(v => state.remember(v)); }
  },
  /** How old the pool may be before Home refreshes it on open (Settings > Feed > Refresh). */
  stale() {
    const mode = feedSettings(state.settings).autoRefresh, age = Date.now() - this.t;
    return mode === 'manual' ? !this.t : age > (mode === 'hourly' ? 3600000 : 90000);
  },
  /** Videos discovered recently that the viewer has not been shown yet. */
  newIds(now = Date.now()) {
    const p = state.ranker.p, out = new Set();
    for (const v of this.videos) if (v.found && now - v.found < DAY && !(p.impressions[v.id] || 0) && !(p.watched[v.id] || 0)) out.add(v.id);
    return out;
  },
  async refresh(onPart) {
    if (this.refreshing) return; this.refreshing = true;
    const T = trace.scoped('feed'), t0 = performance.now();
    try {
      const fresh = await sources.buildPool({ ranker: state.ranker, followCursor: this.cursor,
        onPart: all => onPart?.(this.merge(all, false)), onLate: l => { this.merge(l, true); this.save(); } });
      this.cursor += 14;
      const before = this.videos.length, known = new Set(this.videos.map(v => v.id)), newcomers = fresh.filter(v => !known.has(v.id));
      state.ranker.observe(newcomers);                               // teaches the semantic layer from everything new we see
      this.merge(fresh, true);
      this.t = Date.now(); this.save(); state.saveProfile();
      T.ok(`${newcomers.length} videos you haven't seen before, ${this.videos.length} in the pool (${Math.round(performance.now() - t0)} ms)`);
      return { added: newcomers.length, before };
    } finally { this.refreshing = false; }
  },
  save() { window.wt.set('pool', { t: this.t, cursor: this.cursor, videos: this.videos.map(({ _lang, ...v }) => ({ ...v, desc: (v.desc || '').slice(0, 500) })) }); },
  /** Merge by id, newest fetch wins (first-seen time is kept), cap at 1500, drop the stalest. */
  merge(list, commit) {
    const m = new Map(this.videos.map(v => [v.id, v])), now = Date.now();
    for (const v of list) { const old = m.get(v.id); m.delete(v.id); m.set(v.id, { ...v, found: old?.found || v.found || now }); }   // re-insert so re-found videos count as recent
    const out = [...m.values()].slice(-CAP);
    if (commit) this.videos = out;
    return out;
  },
};
