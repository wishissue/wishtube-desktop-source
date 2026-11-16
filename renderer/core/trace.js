/** Live activity log: what the app is really doing, in plain words. Network calls, retries, mirror switches and player events
 *  all write here; the terminal panels (ui/terminal.js) show it to the viewer instead of a spinner. */
const MAX = 600;

class Trace {
  constructor() { this.entries = []; this.subs = new Set(); this.n = 0; }
  /** Record one line. An identical line from the same scope within 1.5 s is folded into a counter instead of repeating. */
  log(scope, msg, level = 'info', t = Date.now()) {
    const last = this.entries.at(-1);
    if (last && last.scope === scope && last.msg === msg && last.level === level && t - last.t < 1500) { last.count = (last.count || 1) + 1; last.t = t; this.emit(last, true); return last; }
    const e = { id: ++this.n, t, scope, msg, level, count: 1 };
    this.entries.push(e); if (this.entries.length > MAX) this.entries.splice(0, MAX / 4);
    this.emit(e, false); return e;
  }
  info(scope, msg) { return this.log(scope, msg, 'info'); }
  ok(scope, msg) { return this.log(scope, msg, 'ok'); }
  warn(scope, msg) { return this.log(scope, msg, 'warn'); }
  err(scope, msg) { return this.log(scope, msg, 'err'); }
  /** Bound logger for one scope. */
  scoped(scope) { return { info: m => this.info(scope, m), ok: m => this.ok(scope, m), warn: m => this.warn(scope, m), err: m => this.err(scope, m), scope }; }
  /** Time something; the returned object logs "✓ label (123 ms)" or "✗ label: reason". */
  span(scope, label) {
    const t0 = performance.now();
    return { ms: () => Math.round(performance.now() - t0), ok: (extra = '') => this.ok(scope, `${label}${extra ? ' · ' + extra : ''} (${Math.round(performance.now() - t0)} ms)`), fail: why => this.err(scope, `${label}: ${why}`) };
  }
  emit(e, updated) { for (const f of this.subs) try { f(e, updated); } catch { /* a broken view must not stop logging */ } }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  /** Entries of the given scopes since a timestamp. */
  query(scopes, since = 0) { const set = new Set([].concat(scopes)); return this.entries.filter(e => e.t >= since && set.has(e.scope)); }
}

export const trace = new Trace();
