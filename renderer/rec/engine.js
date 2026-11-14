// WishTube "Atlas" ranker. Everything runs on this machine; nothing about you leaves it.
//
//  1. Taste is a set of interest clusters (you can like cooking AND kernel hacking) plus a short-lived session vector.
//  2. Signals are graded: finishing a video counts far more than opening one; skipping and hiding push away.
//  3. The score is a logistic model whose weights are learned online from YOUR clicks, watches and ignores.
//  4. Uncertain creators get explored (Thompson-style sampling), seeded so the feed doesn't reshuffle on every redraw.
//  5. A diversity pass (MMR) stops one creator or one topic from flooding the top of the feed.
import { Corpus, vectorize, cosine, dot, prune, lexicon, trimLexicon, videoLanguage, tokens } from './text.js';
import { EVERGREEN, creatorKey } from '../core/models.js';

const DAY = 86400000, HOUR = 3600000;
const HALF_LIFE = { cluster: 45 * DAY, session: 2 * HOUR, neg: 30 * DAY, creator: 90 * DAY };
const MAX_CLUSTERS = 8, CLUSTER_JOIN = 0.2;
const sat = (m, k = 3) => m / (m + k);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const decay = (dt, half) => Math.pow(0.5, Math.max(0, dt) / half);
const sigmoid = x => 1 / (1 + Math.exp(-x));

export const FEATURES = ['interest', 'session', 'creator', 'follow', 'quality', 'velocity', 'fresh', 'novelty', 'durFit', 'srcPref', 'small', 'lang', 'seen', 'neg'];
/** Priors. The learner pulls away from these only as far as your behaviour justifies. */
export const PRIOR = { interest: 2.4, session: 1.2, creator: 1.0, follow: 1.6, quality: 0.9, velocity: 0.4, fresh: 0.9, novelty: 0.5, durFit: 0.4, srcPref: 0.3, small: 0, lang: 2.0, seen: -2.4, neg: -2.0 };
const SIGN = { interest: 1, session: 1, creator: 1, follow: 1, lang: 1, seen: -1, neg: -1 };   // constrain directions that must never flip

export const MODES = {
  foryou: { label: 'For you', mul: {} },
  discover: { label: 'Discover', mul: { interest: 0.45, creator: 0.3, novelty: 3.5, srcPref: 0, follow: 0.5 }, explore: 1.6 },
  fresh: { label: 'Fresh', mul: { fresh: 4, velocity: 0.3, interest: 0.8 } },
  small: { label: 'Small creators', mul: { small: 1, velocity: 0, quality: 0.5, novelty: 1.5 }, base: { small: 1.7 } },
  following: { label: 'Following', filter: 'followed' },
};

export function newProfile() {
  return { v: 1, clusters: [], session: { vec: [], mass: 0, t: 0 }, neg: { vec: [], t: 0 }, creators: {}, sources: {}, topics: {}, impressions: {}, watched: {},
    dur: { mu: Math.log(600), var: 1.2, n: 0 }, weights: { ...PRIOR }, events: 0, corpus: { n: 0, df: [] } };
}

const toMap = a => new Map(a);
const toArr = m => [...m];

export class Ranker {
  constructor(profile = newProfile(), settings = {}) {
    this.p = { ...newProfile(), ...profile };
    this.p.weights = { ...PRIOR, ...this.p.weights };
    this.corpus = new Corpus(this.p.corpus);
    this.settings = settings;
    this.shown = new Map();                  // id -> feature snapshot, so impressions can teach the model later
    this.dirty = false;
  }
  toJSON() { this.p.corpus = this.corpus.toJSON(); return this.p; }
  setSettings(s) { this.settings = s; }
  observe(videos) { for (const v of videos) this.corpus.add(v); }

  /* -------------------------------- learning -------------------------------- */
  _clusterVecs(now) { return this.p.clusters.map(c => ({ c, vec: toMap(c.vec), mass: c.mass * decay(now - c.t, HALF_LIFE.cluster) })); }

  /** Apply one graded signal (s>0 attract, s<0 repel) from a video. */
  _taste(v, s, now) {
    const vec = vectorize(v, this.corpus);
    if (s > 0) {
      const cs = this._clusterVecs(now);
      let best = null, bestCos = 0;
      for (const x of cs) { const c = cosine(vec, x.vec); if (c > bestCos) { bestCos = c; best = x; } }
      if (best && bestCos >= CLUSTER_JOIN) {
        const k = decay(now - best.c.t, HALF_LIFE.cluster), m = toMap(best.c.vec);
        for (const [h, w] of m) m.set(h, w * k);
        for (const [h, w] of vec) m.set(h, (m.get(h) || 0) + w * s);
        best.c.vec = toArr(prune(m)); best.c.mass = best.mass + s; best.c.t = now;
      } else {
        this.p.clusters.push({ vec: toArr(prune(new Map([...vec].map(([h, w]) => [h, w * s])))), mass: s, t: now, born: now });
        if (this.p.clusters.length > MAX_CLUSTERS) {
          const live = this._clusterVecs(now).sort((a, b) => a.mass - b.mass)[0];
          this.p.clusters = this.p.clusters.filter(c => c !== live.c);
        }
      }
      const ss = this.p.session, k = decay(now - ss.t, HALF_LIFE.session), m = toMap(ss.vec);
      for (const [h, w] of m) m.set(h, w * k);
      for (const [h, w] of vec) m.set(h, (m.get(h) || 0) + w * s);
      ss.vec = toArr(prune(m, 100)); ss.mass = ss.mass * k + s; ss.t = now;
    } else if (s < 0) {
      const n = this.p.neg, k = decay(now - n.t, HALF_LIFE.neg), m = toMap(n.vec);
      for (const [h, w] of m) m.set(h, w * k);
      for (const [h, w] of vec) m.set(h, (m.get(h) || 0) + w * -s);
      n.vec = toArr(prune(m, 120)); n.t = now;
      // also gently weaken the interest this video leaned on
      for (const x of this._clusterVecs(now)) if (cosine(vec, x.vec) > 0.3) { x.c.mass = Math.max(0.2, x.c.mass + s * 0.3); }
    }
    trimLexicon();
  }

  _bump(map, key, pos, neg, now) {
    const e = map[key] || (map[key] = { pos: 0, neg: 0, t: now }), k = decay(now - e.t, HALF_LIFE.creator);
    e.pos = e.pos * k + pos; e.neg = e.neg * k + neg; e.t = now;
  }

  /** Teach the model: label 1 = wanted, 0 = didn't. Weighted logistic SGD with a pull back toward the priors. */
  _fit(f, y, weight) {
    if (!f) return;
    const w = this.p.weights, lr = 0.06 * weight, lam = 0.004;
    let z = 0; for (const k of FEATURES) z += (w[k] || 0) * (f[k] || 0);
    const err = y - sigmoid(z - 1.0);
    for (const k of FEATURES) {
      let nw = w[k] + lr * err * (f[k] || 0) - lam * (w[k] - PRIOR[k]);
      const lim = Math.abs(PRIOR[k]) + 1.6;
      nw = clamp(nw, PRIOR[k] - lim, PRIOR[k] + lim);
      if (SIGN[k] === 1) nw = Math.max(0, nw); else if (SIGN[k] === -1) nw = Math.min(0, nw);
      w[k] = nw;
    }
  }

  /**
   * kind: 'watch' {completion 0..1, seconds} | 'like' | 'unlike' | 'save' | 'later' | 'follow' | 'unfollow' | 'hide' | 'hideCreator'
   */
  record(v, kind, info = {}, now = Date.now()) {
    const ck = creatorKey(v), p = this.p; p.events++; this.dirty = true;
    const f = this.shown.get(v.id);
    let s = 0, label = null, lw = 1;
    if (kind === 'watch') {
      const c = clamp(info.completion ?? (v.dur ? (info.seconds || 0) / v.dur : Math.min(1, (info.seconds || 0) / 300)), 0, 1);
      const secs = info.seconds || 0;
      if (secs < 5) { this._fit(f, 1, 0.3); return; }                 // clicked and bounced instantly: weak positive for the click itself
      s = c < 0.08 && secs < 25 ? -0.6 : Math.min(1.3, 0.3 + 1.2 * c);
      label = s > 0 ? 1 : 0; lw = Math.abs(s);
      p.watched[v.id] = Math.max(p.watched[v.id] || 0, c);
      if (c >= 0.6 && v.dur > 0) { const x = Math.log(v.dur + 30), d = p.dur; d.n++; const a = Math.max(0.08, 1 / d.n); d.mu += a * (x - d.mu); d.var = Math.max(0.25, d.var + a * ((x - d.mu) ** 2 - d.var)); }
    } else if (kind === 'like') { s = 1.0; label = 1; lw = 1; }
    else if (kind === 'unlike') { s = -0.6; }
    else if (kind === 'save') { s = 1.2; label = 1; lw = 1.2; }
    else if (kind === 'later') { s = 0.5; label = 1; lw = 0.5; }
    else if (kind === 'follow') { s = 0.8; this._bump(p.creators, ck, 2, 0, now); }
    else if (kind === 'unfollow') { this._bump(p.creators, ck, 0, 1, now); }
    else if (kind === 'hide') { s = -2.5; label = 0; lw = 2; this._bump(p.creators, ck, 0, 1.5, now); }
    else if (kind === 'hideCreator') { this._bump(p.creators, ck, 0, 5, now); this._bump(p.sources, v.source, 0, 0.3, now); return; }
    if (s !== 0) this._taste(v, s, now);
    if (s > 0) { this._bump(p.creators, ck, s, 0, now); this._bump(p.sources, v.source, s * 0.5, 0, now); }
    if (s < 0) this._bump(p.creators, ck, 0, -s, now);
    for (const t of tokens((v.tags || []).join(' ')).slice(0, 6)) this._bump(p.topics, t, Math.max(s, 0), Math.max(-s, 0), now);
    if (label !== null) this._fit(f, label, lw);
  }

  /** Cold start: turn a chosen interest word into a starting cluster. Real behaviour will quickly outweigh it. */
  seed(term, now = Date.now()) {
    this._taste({ id: 'seed:' + term, title: term, tags: [term], cats: [], desc: '' }, 0.9, now); this.dirty = true;
  }

  /** Called with the videos that were visible on screen. Unclicked impressions are a weak but constant "not now". */
  impressions(vids, now = Date.now()) {
    for (const v of vids) {
      this.p.impressions[v.id] = (this.p.impressions[v.id] || 0) + 1;
      if (this.p.impressions[v.id] >= 2 && !this.p.watched[v.id]) this._fit(this.shown.get(v.id), 0, 0.12);
    }
    const keys = Object.keys(this.p.impressions);
    if (keys.length > 6000) for (const k of keys.slice(0, 2000)) delete this.p.impressions[k];
    this.dirty = true;
  }

  /* -------------------------------- scoring -------------------------------- */
  _context(pool, follows, now) {
    const bySrc = {};
    for (const v of pool) (bySrc[v.source] ||= []).push(v);
    const pct = {}, vel = {};
    for (const [src, list] of Object.entries(bySrc)) {
      const known = list.filter(v => v.views != null);
      if (known.length < 6) continue;
      const rank = arr => { const idx = arr.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Map(); idx.forEach(([, i], n) => r.set(known[i], n / (idx.length - 1))); return r; };
      const pr = rank(known.map(v => Math.log10(v.views + 1)));
      const vr = rank(known.map(v => Math.log10((v.views + 1) / Math.max(1, (now - v.date) / DAY))));
      for (const v of known) { pct[v.id] = pr.get(v); vel[v.id] = v.date ? vr.get(v) : 0.5; }
    }
    return { pct, vel, clusters: this._clusterVecs(now), follows, sess: toMap(this.p.session.vec), negv: toMap(this.p.neg.vec) };
  }

  features(v, ctx, now, pre) {
    const p = this.p, st = this.settings, vec = pre || vectorize(v, this.corpus);
    let interest = 0, bestCluster = null;
    for (const x of ctx.clusters) { const c = cosine(vec, x.vec) * (0.45 + 0.55 * sat(x.mass)); if (c > interest) { interest = c; bestCluster = x; } }
    const ss = p.session, sessMass = ss.mass * decay(now - ss.t, HALF_LIFE.session);
    const session = sessMass > 0.2 ? cosine(vec, ctx.sess) * sat(sessMass, 1.5) : 0;
    const ck = creatorKey(v), ce = p.creators[ck], se = p.sources[v.source];
    const aff = (e, prior) => e ? (e.pos + prior) / (e.pos + e.neg + 2) : prior / 2;
    const creator = ce ? clamp((aff(ce, 0.5) - 0.25) / 0.75, -0.6, 1) : 0;
    const age = v.date ? Math.max(0, now - v.date) / DAY : null;
    const fresh = age === null ? 0.3 : EVERGREEN.has(v.source) ? Math.max(0.35, Math.pow(0.5, age / 30)) : Math.pow(0.5, age / 14);
    const quality = 0.6 * (ctx.pct[v.id] ?? 0.5) + 0.25 * titleQuality(v.title) + 0.15 * (v.thumb ? 1 : 0.2);
    const novelty = (ce ? 0 : 0.6) + 0.4 * (1 - Math.min(1, interest * 1.6));
    const durFit = v.dur ? Math.exp(-((Math.log(v.dur + 30) - p.dur.mu) ** 2) / (2 * p.dur.var)) : 0.5;
    const watched = p.watched[v.id] || 0, impr = p.impressions[v.id] || 0;
    const prefs = st.languages || [];
    let lang = 0;
    if (prefs.length) { const l = videoLanguage(v); lang = l ? (prefs.includes(l) ? 0 : -1) : -0.1; }
    const f = {
      interest, session, creator, follow: ctx.follows.has(ck) ? 1 : 0, quality, velocity: ctx.vel[v.id] ?? 0.5, fresh, novelty, durFit,
      srcPref: se ? clamp((aff(se, 0.5) - 0.25) / 0.75, -0.5, 1) : 0,
      small: ctx.pct[v.id] != null ? 1 - ctx.pct[v.id] : 0.5,
      lang, seen: watched >= 0.8 ? 1 : Math.max(watched * 0.8, Math.min(0.5, impr * 0.12)),
      neg: p.neg.vec.length ? cosine(vec, ctx.negv) * decay(now - p.neg.t, HALF_LIFE.neg) : 0,
    };
    return { f, vec, bestCluster };
  }

  rank(pool, { mode = 'foryou', follows = new Set(), hidden = {}, now = Date.now(), seed = 1, limit = 120 } = {}) {
    const M = MODES[mode] || MODES.foryou, st = this.settings;
    const ok = v => v.title && !hidden.creators?.has(creatorKey(v)) && !hidden.videos?.has(v.id);
    let cands = dedupe(pool.filter(ok));
    if (M.filter === 'followed') {
      return cands.filter(v => follows.has(creatorKey(v))).sort((a, b) => b.date - a.date).map(v => ({ v, score: 0, reasons: ['From a channel you follow'] }));
    }
    const ctx = this._context(cands, follows, now), rng = mulberry32(seed);
    const W = { ...this.p.weights, ...(M.base || {}) };
    for (const [k, m] of Object.entries(M.mul || {})) W[k] = (W[k] ?? 0) * m;
    W.fresh *= 0.4 + 1.2 * (st.freshness ?? 0.5);
    const explore = (st.explore ?? 0.35) * (M.explore || 1);

    const scored = cands.map(v => {
      const { f, vec, bestCluster } = this.features(v, ctx, now);
      let z = 0; for (const k of FEATURES) z += (W[k] || 0) * f[k];
      const ce = this.p.creators[creatorKey(v)], n = (ce ? ce.pos + ce.neg : 0) + 0.5 * (this.p.sources[v.source]?.pos || 0);
      const mean = clamp(0.25 + (ce ? (ce.pos - ce.neg) / (ce.pos + ce.neg + 4) * 0.5 : 0), 0.05, 0.95);
      const sd = Math.sqrt(mean * (1 - mean) / (n + 3));
      z += explore * 2.2 * sd * gauss(rng) + 0.04 * gauss(rng);       // Thompson-style sampling: unknown creators vary more
      this.shown.set(v.id, f);
      return { v, f, vec, score: z, reasons: explain(f, W, bestCluster, v, this.p, mode) };
    });
    if (this.shown.size > 1500) for (const k of [...this.shown.keys()].slice(0, 700)) this.shown.delete(k);
    return diversify(scored.sort((a, b) => b.score - a.score), limit, st.diversity ?? 0.6);
  }

  /** "Up next": semantically close to the current video, lightly personalised. */
  related(video, pool, { follows = new Set(), limit = 18, now = Date.now() } = {}) {
    const ctx = this._context(pool, follows, now), base = vectorize(video, this.corpus), ck = creatorKey(video);
    const out = [];
    for (const v of dedupe(pool.filter(x => x.id !== video.id && x.title))) {
      const vec = vectorize(v, this.corpus), sim = cosine(base, vec);
      const { f } = this.features(v, ctx, now, vec);
      const z = sim * 3.2 + (creatorKey(v) === ck ? 0.9 : 0) + f.interest * 0.8 + f.quality * 0.3 + f.fresh * 0.2 + f.creator * 0.3 + f.seen * -1.5 + f.neg * -1.5 + f.lang * 2;
      out.push({ v, score: z, vec, reasons: sim > 0.12 ? ['Similar to this video'] : creatorKey(v) === ck ? ['Same creator'] : [] });
    }
    return diversify(out.sort((a, b) => b.score - a.score), limit, 0.35);
  }

  /** One shelf per strong interest: "Because you like kernel · rust". Capped per creator so a shelf is never one channel. */
  byInterest(pool, { hidden = {}, now = Date.now(), n = 3, per = 12 } = {}) {
    const clusters = this._clusterVecs(now).filter(x => x.mass > 0.6).sort((a, b) => b.mass - a.mass).slice(0, n);
    if (!clusters.length) return [];
    const label = m => [...m].sort((a, b) => b[1] - a[1]).map(([h]) => lexicon.get(h)).filter(t => t && !t.includes(' ') && t.length > 2).slice(0, 3);
    const cands = dedupe(pool.filter(v => v.title && !hidden.creators?.has(creatorKey(v)) && !hidden.videos?.has(v.id) && (this.p.watched[v.id] || 0) < 0.8));
    const vecs = cands.map(v => vectorize(v, this.corpus));
    return clusters.map(x => {
      const scored = cands.map((v, i) => ({ v, s: cosine(vecs[i], x.vec) })).filter(o => o.s > 0.18).sort((a, b) => b.s - a.s);
      const out = [], by = {};
      for (const o of scored) { const k = creatorKey(o.v); if ((by[k] = (by[k] || 0) + 1) > 2) continue; out.push(o.v); if (out.length >= per) break; }
      return { terms: label(x.vec), items: out };
    }).filter(sh => sh.items.length >= 4 && sh.terms.length);
  }

  /** For the "Your taste" panel: what the model believes, in plain words. */
  describe(now = Date.now()) {
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([h]) => lexicon.get(h)).filter(Boolean);
    return {
      interests: this._clusterVecs(now).sort((a, b) => b.mass - a.mass).filter(x => x.mass > 0.3).map(x => ({ terms: top(x.vec, 5), strength: sat(x.mass) })),
      weights: { ...this.p.weights }, events: this.p.events,
      creators: Object.entries(this.p.creators).map(([k, e]) => [k, e.pos - e.neg]).sort((a, b) => b[1] - a[1]).slice(0, 6),
    };
  }
  reset() { this.p = newProfile(); this.corpus = new Corpus(); this.shown.clear(); this.dirty = true; }
}

/* ---------------------------------- helpers ---------------------------------- */
export function titleQuality(t = '') {
  let q = 1;
  const letters = t.replace(/[^\p{L}]/gu, '');
  if (letters.length > 12 && letters.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.6) q -= 0.4;
  if (/[!?]{2,}/.test(t)) q -= 0.3;
  if (t.length < 6) q -= 0.4;
  if ((t.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length > 3) q -= 0.2;
  return clamp(q, 0, 1);
}

/** Same talk uploaded to two sources, or re-uploaded twice: keep the best copy. */
export function dedupe(list) {
  const key = v => new Set(tokens(v.title));
  const kept = [], sets = [];
  for (const v of list) {
    const s = key(v); let dup = -1;
    if (s.size >= 2) for (let i = 0; i < kept.length; i++) {
      const o = kept[i];
      if (o.id === v.id) { dup = i; break; }
      if (o.source === v.source && o.creatorId !== v.creatorId) continue;
      const t = sets[i]; if (!t || Math.abs(s.size - t.size) > 3) continue;
      let inter = 0; for (const x of s) if (t.has(x)) inter++;
      const jac = inter / (s.size + t.size - inter);
      const durOk = !o.dur || !v.dur || Math.abs(o.dur - v.dur) / Math.max(o.dur, v.dur) < 0.08;
      if (jac >= 0.85 && durOk) { dup = i; break; }
    } else for (let i = 0; i < kept.length; i++) if (kept[i].id === v.id) { dup = i; break; }
    if (dup < 0) { kept.push(v); sets.push(s); }
    else if ((v.views ?? 0) > (kept[dup].views ?? 0) || (!kept[dup].dur && v.dur)) { kept[dup] = v; sets[dup] = s; }
  }
  return kept;
}

/** Maximal Marginal Relevance: pick high scores, but penalise being similar to what is already picked. */
export function diversify(sorted, limit, lambda = 0.6) {
  const n = Math.min(sorted.length, Math.max(limit * 3, 60)), pool = sorted.slice(0, n), picked = [];
  const maxSim = new Float32Array(n), used = new Uint8Array(n);
  const srcRun = [];
  while (picked.length < limit && picked.length < n) {
    let bi = -1, bv = -Infinity;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const run = srcRun.length >= 2 && srcRun.at(-1) === pool[i].v.source && srcRun.at(-2) === pool[i].v.source ? 0.35 : 0;
      const val = pool[i].score - lambda * 2.4 * maxSim[i] - run;
      if (val > bv) { bv = val; bi = i; }
    }
    const p = pool[bi]; used[bi] = 1; picked.push(p); srcRun.push(p.v.source);
    const ck = creatorKey(p.v);
    for (let i = 0; i < n; i++) if (!used[i]) {
      const s = creatorKey(pool[i].v) === ck ? 0.9 : p.vec && pool[i].vec ? cosine(p.vec, pool[i].vec) : 0;
      if (s > maxSim[i]) maxSim[i] = s;
    }
  }
  return picked.map(({ v, score, reasons }) => ({ v, score, reasons }));
}

const LABEL = {
  follow: () => 'From a channel you follow', session: () => 'Related to what you just watched', fresh: () => 'Just published',
  velocity: () => 'Trending right now', novelty: () => 'Something new for you', small: () => 'Smaller creator', quality: () => 'Well received',
};
function explain(f, W, cluster, v, p, mode) {
  const parts = FEATURES.filter(k => W[k] > 0 && f[k] > 0).map(k => [k, W[k] * f[k]]).sort((a, b) => b[1] - a[1]);
  const out = [];
  for (const [k, c] of parts) {
    if (out.length >= 2) break;
    if (k === 'interest' && c > 0.25 && cluster) {
      const vec = vectorize(v, { idf: () => 1 }), shared = [...new Map(cluster.vec)].filter(([h]) => vec.has(h)).sort((a, b) => b[1] - a[1]).map(([h]) => lexicon.get(h)).filter(Boolean)[0];
      out.push(shared ? `Matches your interest in “${shared}”` : 'Matches your interests');
    } else if (k === 'creator' && c > 0.3) out.push(`You enjoy ${v.creator}`);
    else if (k === 'quality' && c < 0.7) continue;
    else if (LABEL[k] && c > (k === 'follow' ? 0.5 : 0.35)) out.push(LABEL[k]());
  }
  if (!out.length) out.push(mode === 'discover' ? 'Something different' : 'Popular on your sources');
  return out;
}

/** Deterministic RNG so a given feed refresh is stable while you scroll and navigate. */
export function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
