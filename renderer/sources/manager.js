import { ADAPTERS, TOPICS } from './adapters.js';
import { state } from '../core/state.js';
import { creatorKey, SOURCES } from '../core/models.js';
import { trace } from '../core/trace.js';
import { net, friendly } from '../core/net.js';
import { scorePopularity } from '../rec/musicrank.js';
import { feedSettings, pickQueries } from '../rec/filters.js';

const by = Object.fromEntries(ADAPTERS.map(a => [a.id, a]));
export const adapter = id => by[id];
const active = () => state.settings.order.filter(id => state.settings.sources[id] && by[id]);
const conf = extra => ({ mature: state.settings.mature, ptInstance: state.settings.ptInstance, ...extra });
const label = id => SOURCES[id]?.label || id;
const rnd = n => Math.floor(Math.random() * n), pick = a => a[rnd(a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Concurrency gate so a big refresh doesn't open 60 sockets at once. */
const gate = (() => { let run = 0; const q = []; const next = () => { while (run < 16 && q.length) { run++; const { f, res, rej } = q.shift(); f().then(res, rej).finally(() => { run--; next(); }); } }; return f => new Promise((res, rej) => { q.push({ f, res, rej }); next(); }); })();

/** Run one adapter call: attributed to `scope`, timed, logged, and never allowed to throw into Promise.all. */
const safe = (id, scope, name, f) => {
  const span = trace.span(scope, `${label(id)} · ${name}`);
  return gate(() => net.withScope(scope, f)).then(
    l => { span.ok(`${l.length} ${l.length === 1 ? 'item' : 'items'}`); return l.map(v => ({ ...v })); },
    e => { span.fail(friendly(e)); state.bus.emit('source-error', { id, message: e.message }); return []; });
};
const remember = list => { list.forEach(v => state.remember(v)); return list; };

const streams = new Map();                                          // video id -> { t, p }   resolved streams are reused for 10 minutes
const STREAM_TTL = 600000;

export const sources = {
  active,
  /** Streams results as each source answers, so the first results show up in a fraction of a second. */
  search(q, page, sort, onPart, scope = 'search') {
    const jobs = active().map(id => safe(id, scope, `search “${q.slice(0, 30)}”`, () => by[id].search(q, page, sort, conf())).then(l => { remember(l); onPart?.(id, l); return l; }));
    return Promise.all(jobs).then(r => r.flat());
  },
  async resolveUrl(url) {
    for (const a of ADAPTERS) { try { const v = await a.resolveUrl(url, conf()); if (v) { state.remember(v); return v; } } catch { /* try the next source */ } }
    return null;
  },
  /** Resolve playable URLs. Cached, and the same in-flight request is shared, so Shorts can warm the next ones while you watch. */
  stream(v, { scope = 'play:' + v.id, fresh = false } = {}) {
    const hit = streams.get(v.id);
    if (hit && !fresh && Date.now() - hit.t < STREAM_TTL) { trace.info(scope, `Stream for “${v.title.slice(0, 40)}” is already resolved (cached)`); return hit.p; }
    const span = trace.span(scope, `${label(v.source)} · looking up streams`);
    const p = Promise.resolve().then(() => net.withScope(scope, () => by[v.source].resolveStream(v))).then(st => {
      span.ok(`${st.urls.length} ${st.urls.length === 1 ? 'stream' : 'streams'}${st.hls ? ', HLS adaptive' : ''}`); return st;
    }, e => { streams.delete(v.id); span.fail(friendly(e)); throw e; });
    streams.set(v.id, { t: Date.now(), p });
    if (streams.size > 120) for (const k of [...streams.keys()].slice(0, 40)) streams.delete(k);
    return p;
  },
  /** Music across every source that has a music method; `q` empty = discovery. `sort`: popular | trending | new. Streams in per source like search(). */
  music(q, page, onPart, { sort = 'popular', scope = 'music' } = {}) {
    const ids = active().filter(id => by[id].music);
    return Promise.all(ids.map(id => safe(id, scope, `${q ? 'music search' : 'music · ' + sort}, page ${page + 1}`, () => by[id].music(q, page, conf({ musicSort: sort }))).then(l => { scorePopularity(l); remember(l); onPart?.(id, l); return l; }))).then(r => r.flat());
  },
  /** Shorts: only what providers tag as shorts (or report as portrait). */
  shorts(page, onPart, scope = 'shorts') {
    const ids = active().filter(id => by[id].shorts);
    return Promise.all(ids.map(id => safe(id, scope, `shorts page ${page + 1}`, () => by[id].shorts(page, conf())).then(l => { remember(l); onPart?.(id, l); return l; }))).then(r => r.flat());
  },
  hasComments: v => !!by[v.source]?.comments,
  comments: (v, o) => by[v.source].comments(v, o),
  replies: (v, c) => by[v.source].replies ? by[v.source].replies(v, c) : Promise.resolve([]),
  creatorVideos: (src, cid, page = 0) => by[src].creatorVideos(cid, page, conf()).then(remember),
  creatorInfo: (src, cid) => by[src].creatorInfo(cid).catch(() => null),
  caps: id => by[id].caps,

  /**
   * The candidate pool. Every call asks for something DIFFERENT than the last one: random pages and rankings, a fresh mix of topics,
   * and a rotating slice of your follows, so the feed brings in new videos each time instead of the same top 40 again and again.
   * It never waits longer than `deadline` for slow servers; late answers go to `onLate`.
   */
  async buildPool({ ranker, onPart, onLate, deadline = 12000, followCursor = 0 } = {}) {
    const S = 'feed', c = conf(), ids = active(), jobs = [], F = feedSettings(state.settings);
    trace.info(S, `Refreshing from ${ids.length} source${ids.length === 1 ? '' : 's'}: ${ids.map(label).join(', ')}`);
    const job = (id, name, f) => jobs.push(safe(id, S, name, f));
    for (const id of ids) {
      const tp = rnd(6);
      job(id, 'newest', () => by[id].feed(0, 'new', c));
      job(id, `trending, page ${tp + 1}`, () => by[id].feed(tp, 'trending', c));
      for (let i = 0; i < 2; i++) { const p = rnd(7); job(id, `surprise mix, page ${p + 1}`, () => by[id].feed(p, 'random', c)); }
    }
    // Topic probes: your own topics and learned interests, plus a few random ones nobody asked for.
    const desc = ranker.describe(), learned = [];
    for (const i of desc.interests.slice(0, 4)) { const t = i.terms.filter(x => x.length > 3 && !x.includes(' ')); if (t.length >= 2) learned.push(`${t[0]} ${t[1]}`); else if (t[0]) learned.push(t[0]); }
    const queries = pickQueries({ topics: [...F.topics, ...(state.settings.interests || [])], learned, pool: TOPICS, nOwn: 2, nRandom: 2 });
    for (const q of queries) for (const id of ids) { const p = rnd(3), sort = pick(['relevance', 'newest', 'popular']); job(id, `“${q}” (${sort}, page ${p + 1})`, () => by[id].search(q, p, sort, c)); }
    const fol = Object.values(state.lib.follows).filter(f => state.settings.sources[f.source]);
    if (fol.length) { const n = Math.min(14, fol.length); for (let i = 0; i < n; i++) { const f = fol[(followCursor + i) % fol.length]; job(f.source, `latest from ${f.name || f.creatorId}`, () => by[f.source].creatorVideos(f.creatorId, 0, c)); } }

    const all = []; let closed = false, left = jobs.length;
    const run = jobs.map(j => j.then(l => { left--; if (closed) onLate?.(remember(l)); else { all.push(...l); onPart?.(all); } }));
    await Promise.race([Promise.all(run), sleep(deadline)]);
    if (!closed) { closed = true; if (left) trace.warn(S, `Stopped waiting after ${deadline / 1000} s — ${left} slow request${left === 1 ? ' is' : 's are'} still running; what they find will be added when it arrives`); }
    if (!all.length && !left) trace.err(S, 'Every source failed. You may be offline, or a firewall/VPN is blocking these servers.');
    else trace.ok(S, `Collected ${all.length} videos`);
    return remember(all);
  },
};
export { creatorKey };
