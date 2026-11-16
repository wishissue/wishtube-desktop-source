import { trace } from './trace.js';

/** Renderer-side network layer on top of window.wt.json:
 *   - every request is logged to the live trace (host, time, retries), so the UI can show what is happening
 *   - identical GETs in flight are shared, finished GETs are cached briefly
 *   - `scope` says which screen the request belongs to (set with net.withScope for the synchronous start of an adapter call)
 *   - race() asks the main process which of several mirrors answers first */
const cache = new Map(), flying = new Map();
const TTL = 45000, MAX_CACHE = 300;
const host = u => { try { return new URL(u).host; } catch { return String(u).slice(0, 40); } };
const short = u => { try { const x = new URL(u); const p = x.pathname.replace(/^\/api\/v\d\//, '/'); return p.length > 34 ? p.slice(0, 33) + '…' : p; } catch { return ''; } };
const key = (u, o) => (o?.body ? 'P ' + u + o.body : 'G ' + u);

export const net = {
  scope: 'net',
  /** Run fn (an adapter call) with a scope; requests it starts synchronously are attributed to that scope. */
  withScope(scope, fn) { const prev = this.scope; this.scope = scope; try { return fn(); } finally { this.scope = prev; } },

  async json(url, opts = {}) {
    const scope = opts.scope || this.scope, k = key(url, opts), post = !!opts.body, now = Date.now();
    if (!post && !opts.fresh) {
      const c = cache.get(k); if (c && now - c.t < TTL) { trace.info(scope, `${host(url)}${short(url)} · from cache`); return structuredClone(c.v); }
      const f = flying.get(k); if (f) { trace.info(scope, `${host(url)}${short(url)} · already requested, waiting for it`); return structuredClone(await f); }
    }
    const span = trace.span(scope, `${host(url)}${short(url)}`);
    trace.info(scope, `→ ${post ? 'POST' : 'GET'} ${host(url)}${short(url)}`);
    const p = window.wt.json(url, opts);
    if (!post) flying.set(k, p);
    try {
      const v = await p; span.ok();
      if (!post) { cache.set(k, { t: Date.now(), v }); if (cache.size > MAX_CACHE) for (const x of [...cache.keys()].slice(0, 80)) cache.delete(x); }
      return post ? v : structuredClone(v);
    } catch (e) { span.fail(friendly(e)); throw e; }
    finally { flying.delete(k); }
  },

  /** Pick the mirror that answers first (main process probes in parallel). Returns the winning URL, or urls[0] if every probe failed. */
  async race(urls, { scope = this.scope, timeout = 4500, label = 'mirrors' } = {}) {
    urls = [...new Set(urls.filter(Boolean))];
    if (urls.length < 2 || !window.wt.race) return urls[0] || null;
    trace.info(scope, `Testing ${urls.length} ${label}: ${urls.map(host).join(', ')}`);
    try {
      const r = await window.wt.race(urls, { timeout });
      for (const f of r.failed || []) trace.warn(scope, `${host(f.url)} didn't answer (${f.error})`);
      if (r.url) { trace.ok(scope, `${host(r.url)} answered first (${r.ms} ms)`); return r.url; }
      trace.warn(scope, 'No mirror answered the quick test — trying them in order');
    } catch (e) { trace.warn(scope, 'Mirror test unavailable: ' + friendly(e)); }
    return urls[0];
  },
  clearCache() { cache.clear(); },
  host,
};

/** Error text a person can read. */
export function friendly(e) {
  const m = String(e?.message || e || 'unknown error').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (/timeout|aborted|timed out/i.test(m)) return 'timed out';
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return 'host not found (DNS)';
  if (/ECONNREFUSED/.test(m)) return 'connection refused';
  if (/ECONNRESET|socket hang up|fetch failed/i.test(m)) return 'connection dropped';
  return m.length > 90 ? m.slice(0, 89) + '…' : m;
}
