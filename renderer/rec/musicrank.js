import { mixedOrder, titleScore } from './pick.js';

/** Music ordering: popular and well-made tracks first, but never the same list twice.
 *  Popularity is judged inside each source (view / download counts are only comparable within one provider), and where a provider
 *  reports no counts, by the position it returned the item in (we ask every provider for its most-popular-first order).
 *  Quality adds: track-like length, a title that looks like a song, not a podcast/mix/tutorial. */
const pctRanks = values => {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]), out = new Array(values.length), n = Math.max(1, idx.length - 1);
  idx.forEach(([, i], r) => { out[i] = r / n; });
  return out;
};

/** Annotate each item with `pop` (0..1). `list` must be in provider order for one source. */
export function scorePopularity(list) {
  const n = list.length; if (!n) return list;
  const known = list.map(v => v.views).filter(x => x != null).length >= Math.max(4, n * 0.5);
  const byViews = known ? pctRanks(list.map(v => Math.log10((v.views ?? 0) + 1))) : null;
  list.forEach((v, i) => { const order = 1 - i / Math.max(1, n), abs = Math.min(1, Math.log10((v.views ?? 0) + 1) / 6); v.pop = byViews ? 0.7 * (0.6 * byViews[i] + 0.4 * abs) + 0.3 * order : order; });
  return list;
}

/** 0..1 for how much it looks like a real track: songs are ~1.5 to 8 min; clips and hour-long mixes are not. */
export function durationFit(dur) {
  if (!dur) return 0.55;
  if (dur < 45) return 0; if (dur < 90) return 0.4; if (dur <= 480) return 1; if (dur <= 900) return 0.7; if (dur <= 1800) return 0.35; return 0.05;
}
export const trackQuality = v => 0.6 * durFitOf(v) + 0.4 * titleScore(v.title) + (v.thumb ? 0 : -0.1);
const durFitOf = v => durationFit(v.dur);

/** Interleave sources and order by quality. `sort`: 'popular' | 'trending' | 'new'. `seed` changes the order each session. */
export function rankMusic(items, { sort = 'popular', query = '', seed = 1 } = {}) {
  if (sort === 'new') return [...items].sort((a, b) => (b.date || 0) - (a.date || 0));
  const by = {}; for (const v of items) (by[v.source] ||= []).push(v);
  const score = new Map(), w = query ? 0.5 : 1;                       // a typed search keeps half its provider-relevance order
  for (const list of Object.values(by)) list.forEach((v, i) => {
    const relevance = query ? (1 - i / Math.max(1, list.length)) * (1 - w) : 0, q = trackQuality(v);
    const hard = v.dur && v.dur < 45 ? -0.25 : 0;
    score.set(v.id, Math.max(0, Math.min(1, 0.6 * ((v.pop ?? 0.3) * w + relevance) + 0.4 * q + hard)));
  });
  // a typed search should stay on-topic: only shuffle lightly (the best match stays near the top)
  return query ? [...items].sort((a, b) => score.get(b.id) - score.get(a.id)) : mixedOrder(items, v => score.get(v.id), seed, 0.4);
}
