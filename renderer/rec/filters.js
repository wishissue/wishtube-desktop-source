import { creatorKey } from '../core/models.js';
import { titleQuality, mulberry32 } from './engine.js';

const DAY = 86400000;
export const FEED_DEFAULTS = {
  lengths: ['short', 'medium', 'long'],        // short < 5 min, medium 5-20, long > 20 (unknown length is always allowed)
  maxAge: 0,                                   // days; 0 = any
  hideWatched: true,                           // hide videos you finished
  perCreator: 3,                               // max videos from one creator in the main grid; 0 = no limit
  cleanTitles: true,                           // drop ALL-CAPS / !!! / empty-looking titles
  needThumb: false,                            // drop videos without a thumbnail
  muted: [],                                   // words / creators you never want to see
  topics: [],                                  // topics you want more of (also used to search every source)
  shelves: { continue: true, follows: true, interests: true, trending: true },
  autoRefresh: 'open',                         // 'open' = fresh videos every time you open Home, 'hourly', 'manual'
  newShare: 0.4,                               // how much of the first screens should be videos you haven't been shown before
};
export const FEED_PRESETS = {
  balanced: { label: 'Balanced', explore: 0.35, freshness: 0.5, diversity: 0.6, newShare: 0.4 },
  discover: { label: 'Discovery', explore: 0.85, freshness: 0.5, diversity: 0.85, newShare: 0.6 },
  familiar: { label: 'Familiar', explore: 0.1, freshness: 0.35, diversity: 0.4, newShare: 0.2 },
  latest: { label: 'Latest', explore: 0.3, freshness: 1, diversity: 0.6, newShare: 0.5 },
};
export const LENGTH_BANDS = { short: [0, 300], medium: [300, 1200], long: [1200, Infinity] };

export const feedSettings = S => ({ ...FEED_DEFAULTS, ...(S?.feed || {}), shelves: { ...FEED_DEFAULTS.shelves, ...(S?.feed?.shelves || {}) } });

/** A muted entry matches as a whole word in title/tags, or the creator name. */
export function mutedMatcher(words) {
  const list = (words || []).map(w => String(w).trim().toLowerCase()).filter(Boolean);
  if (!list.length) return () => false;
  const res = list.map(w => new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'iu'));
  return v => { const hay = `${v.title} ${(v.tags || []).join(' ')} ${v.creator || ''}`; return res.some(r => r.test(hay)); };
}

/** Everything the Feed settings promise, applied before ranking. Pure: pass `watched` (id -> 0..1) and `now`. */
export function feedFilter(videos, S, { watched = {}, now = Date.now() } = {}) {
  const f = feedSettings(S), isMuted = mutedMatcher(f.muted);
  const bands = f.lengths.length && f.lengths.length < 3 ? f.lengths.map(k => LENGTH_BANDS[k]).filter(Boolean) : null;
  return videos.filter(v => {
    if (bands && v.dur > 0 && !bands.some(([a, b]) => v.dur >= a && v.dur < b)) return false;
    if (f.maxAge && v.date && now - v.date > f.maxAge * DAY) return false;
    if (f.hideWatched && (watched[v.id] || 0) >= 0.8) return false;
    if (f.needThumb && !v.thumb) return false;
    if (f.cleanTitles && titleQuality(v.title) < 0.55) return false;
    return !isMuted(v);
  });
}

/** Keep at most `n` per creator, preserving order. */
export function capPerCreator(ranked, n, get = r => r.v) {
  if (!n) return ranked; const by = {};
  return ranked.filter(r => (by[creatorKey(get(r))] = (by[creatorKey(get(r))] || 0) + 1) <= n);
}

/** Make sure the first `window` slots hold roughly `share` videos the viewer hasn't been shown before ("new" = in `newIds`),
 *  without otherwise disturbing the ranking. Ranked order is kept inside each group. */
export function freshen(ranked, newIds, { share = 0.4, window = 24, get = r => r.v } = {}) {
  if (!newIds?.size || share <= 0 || ranked.length < 6) return ranked;
  const isNew = r => newIds.has(get(r).id), fresh = ranked.filter(isNew), old = ranked.filter(r => !isNew(r));
  const slots = Math.min(window, ranked.length), want = Math.min(fresh.length, Math.round(slots * Math.min(1, share)));
  if (!want) return ranked;
  const head = [], f = fresh.slice(), o = old.slice(); let given = 0;
  for (let i = 0; i < slots; i++) {                                  // spread the new ones evenly through the head instead of clumping them at the start
    const due = Math.floor(((i + 1) * want) / slots) > given;
    if ((due && f.length) || !o.length) { head.push(f.shift()); given++; } else head.push(o.shift());
  }
  const idx = new Map(ranked.map((r, i) => [r, i]));
  return [...head.filter(Boolean), ...[...f, ...o].sort((a, b) => idx.get(a) - idx.get(b))];
}

/** A different topic mix every refresh: your own topics and learned interests first, then random exploration. */
export function pickQueries({ topics = [], learned = [], pool = [], random = mulberry32(Date.now()), nOwn = 2, nRandom = 2 } = {}) {
  const shuffle = a => a.map(x => [random(), x]).sort((p, q) => p[0] - q[0]).map(x => x[1]);
  const own = shuffle([...topics, ...learned]).slice(0, nOwn), rest = shuffle(pool.filter(t => !own.includes(t))).slice(0, nRandom);
  return [...own, ...rest];
}
