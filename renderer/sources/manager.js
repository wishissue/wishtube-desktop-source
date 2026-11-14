import { ADAPTERS } from './adapters.js';
import { state } from '../core/state.js';
import { creatorKey } from '../core/models.js';

const by = Object.fromEntries(ADAPTERS.map(a => [a.id, a]));
export const adapter = id => by[id];
const S = () => state.settings;
const active = () => state.settings.order.filter(id => state.settings.sources[id] && by[id]);
const conf = () => ({ mature: state.settings.mature, ptInstance: state.settings.ptInstance });

/** Small concurrency gate so a big refresh doesn't open 60 sockets at once. */
const gate = (() => { let run = 0; const q = []; const next = () => { while (run < 10 && q.length) { run++; const { f, res, rej } = q.shift(); f().then(res, rej).finally(() => { run--; next(); }); } }; return f => new Promise((res, rej) => { q.push({ f, res, rej }); next(); }); })();
const safe = (id, f) => gate(f).then(l => l.map(v => ({ ...v })), e => { state.bus.emit('source-error', { id, message: e.message }); return []; });
const remember = list => { list.forEach(v => state.remember(v)); return list; };

export const sources = {
  active,
  /** Streams results as each source answers, so the first results show up in a fraction of a second. */
  search(q, page, sort, onPart) {
    const jobs = active().map(id => safe(id, () => by[id].search(q, page, sort, conf())).then(l => { remember(l); onPart?.(id, l); return l; }));
    return Promise.all(jobs).then(r => r.flat());
  },
  async resolveUrl(url) {
    for (const a of ADAPTERS) { try { const v = await a.resolveUrl(url, conf()); if (v) { state.remember(v); return v; } } catch { /* try the next source */ } }
    return null;
  },
  stream: v => by[v.source].resolveStream(v),
  creatorVideos: (src, cid, page = 0) => by[src].creatorVideos(cid, page, conf()).then(remember),
  creatorInfo: (src, cid) => by[src].creatorInfo(cid).catch(() => null),
  caps: id => by[id].caps,

  /** The candidate pool. Desktop-sized: several pages from every source, topic-targeted searches, and your follows. */
  async buildPool({ ranker, pages = 2, onPart } = {}) {
    const jobs = [], c = conf(), ids = active();
    for (const id of ids) for (let p = 0; p < pages; p++) {
      jobs.push(safe(id, () => by[id].feed(p, 'trending', c)));
      jobs.push(safe(id, () => by[id].feed(p, 'new', c)));
    }
    // Interest-driven retrieval: search every source for the terms your strongest interests are made of.
    const desc = ranker.describe(), queries = [];
    for (const i of desc.interests.slice(0, 3)) { const t = i.terms.filter(x => x.length > 3 && !x.includes(' ')); if (t.length >= 2) queries.push(`${t[0]} ${t[1]}`); else if (t[0]) queries.push(t[0]); }
    if (!queries.length) for (const t of state.settings.interests.slice(0, 4)) queries.push(t);
    for (const q of queries) for (const id of ids) jobs.push(safe(id, () => by[id].search(q, 0, 'relevance', c)));
    for (const f of Object.values(state.lib.follows).slice(0, 14)) if (state.settings.sources[f.source]) jobs.push(safe(f.source, () => by[f.source].creatorVideos(f.creatorId, 0, c)));
    const all = [];
    await Promise.all(jobs.map(j => j.then(l => { all.push(...l); onPart?.(all); })));
    return remember(all);
  },
};
export { creatorKey };
