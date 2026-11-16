/** Shared "mostly the good stuff, but never the same list twice" ordering, used by Music and Shorts.
 *  About 70% of the slots go to the best-scoring items, the other 30% to everything else (discovery), all in a
 *  seeded shuffle: the same seed gives the same order while you browse, a new seed (new session / refresh) gives a new one. */
export const GOOD_SHARE = 0.7, TOP_FRACTION = 0.4;

export function rng(seed) {                                          // mulberry32
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Weighted shuffle (higher score = likely earlier). Each item's randomness depends only on id + seed, so it is stable as lists grow. */
function shuffleBy(list, score, seed, k = 4) {
  return list.map(v => { const u = (hash(String(v.id) + ':' + seed) + 1) / 4294967297; return { v, key: Math.log(u) / Math.exp(k * Math.max(0, Math.min(1, score(v)))) }; })
    .sort((a, b) => b.key - a.key).map(x => x.v);
}

/** Order `items` by `score` (0..1): good ones first-ish (about 70% of the time), the rest mixed in. */
export function mixedOrder(items, score, seed = 1, floor = 0) {
  const low = floor ? items.filter(v => score(v) < floor) : []; if (low.length && low.length < items.length) { const lset = new Set(low); return [...mixedOrder(items.filter(v => !lset.has(v)), score, seed), ...low.sort((a, b) => score(b) - score(a))]; }   // clearly poor items go last, never into the "discovery" slots
  const n = items.length; if (n < 3) return [...items].sort((a, b) => score(b) - score(a));
  const sorted = [...items].sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
  const cut = Math.max(1, Math.ceil(n * TOP_FRACTION));
  const good = shuffleBy(sorted.slice(0, cut), score, seed, 2), rest = shuffleBy(sorted.slice(cut), score, seed, 3);
  const r = rng(seed ^ 0x9e3779b9), out = [];
  while (good.length || rest.length) out.push((good.length && (!rest.length || r() < GOOD_SHARE)) ? good.shift() : rest.shift());
  return out;
}

/** 0..1 percentile of each item's view count inside its own source (counts are only comparable within one provider). */
export function viewPercentiles(items) {
  const out = new Map(), by = {}; for (const v of items) (by[v.source] ||= []).push(v);
  for (const list of Object.values(by)) {
    const known = list.filter(v => v.views != null);
    if (known.length < Math.max(3, list.length * 0.5)) { list.forEach(v => out.set(v.id, null)); continue; }   // no counts: unknown, not bad
    const sorted = [...known].sort((a, b) => a.views - b.views), n = Math.max(1, sorted.length - 1);
    sorted.forEach((v, i) => out.set(v.id, 0.65 * (i / n) + 0.35 * Math.min(1, Math.log10(v.views + 1) / 6)));   // rank inside the source, plus how big the number really is (1M views = top) list.filter(v => v.views == null).forEach(v => out.set(v.id, null));
  }
  return out;
}

const JUNK = /\b(podcast|interview|tutorial|lesson|lecture|sermon|how to|reaction|review|gameplay|walkthrough|news|livestream|live stream|unboxing|trailer|asmr|vlog|stream highlights?|compilation|meme|prank)\b/i;
/** 0..1: does the title look like it is what it claims? Penalises obvious non-content and shouting. */
export function titleScore(t = '') {
  let s = 0.7; if (JUNK.test(t)) s -= 0.45; if (t.length < 4) s -= 0.3;
  const letters = t.replace(/[^A-Za-z]/g, ''); if (letters.length > 8 && letters === letters.toUpperCase()) s -= 0.15;
  if ((t.match(/[!?]/g) || []).length > 3) s -= 0.1;
  return Math.max(0, s);
}
