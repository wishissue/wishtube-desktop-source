import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { MODES } from '../rec/engine.js';
import { creatorKey, isShort, isMusic } from '../core/models.js';
import { feedFilter, feedSettings, capPerCreator, freshen } from '../rec/filters.js';
import { card, infinite, shelf } from './components.js';
import { terminal } from './terminal.js';
import { friendly } from '../core/net.js';

let mode = 'foryou', seed = Date.now() % 100000, seedAt = Date.now();
const reseed = () => { seed = Math.floor(Math.random() * 1e6); seedAt = Date.now(); };

export function home(root) {
  const body = h('div'), chips = h('div.chips'), bannerHost = h('div');
  let stop = null, alive = true, term = null;
  const visible = new Map(), shown = new Set(); let clicked = null;
  const io = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target._v; if (!v) return;
    if (e.isIntersecting) visible.set(v.id, setTimeout(() => shown.add(v), 1000)); else { clearTimeout(visible.get(v.id)); visible.delete(v.id); }
  }), { root: document.getElementById('view'), threshold: 0.6 });
  const observe = (el, v) => { el._v = v; io.observe(el); el.addEventListener('click', () => { clicked = v.id; }); };
  const watched = () => state.ranker.p.watched;
  /** Home is long-form; Shorts and Music have their own pages. Your Feed settings (length, age, muted words…) are applied here. */
  const enabled = () => feedFilter(pool.videos.filter(v => state.settings.sources[v.source] && !isShort(v) && !isMusic(v)), state.settings, { watched: watched() });
  const stopTerm = () => { term?.stop(); term = null; };

  /** While the first load is running, show what is happening (every request, retry and slow server) instead of a spinner. */
  function drawLoading() {
    stopTerm(); clear(body);
    term = terminal({ headline: () => 'Finding videos for you', className: 'big' });
    body.append(h('div.loadbox', term.el));
  }

  function draw() {
    if (!alive) return; stop?.(); stopTerm(); clear(body);
    const F = feedSettings(state.settings), all = enabled(), used = new Set();
    const rankedAll = state.ranker.rank(all, { mode, follows: state.follows(), hidden: state.hidden(), seed, limit: 160 });
    if (!rankedAll.length) {
      if (pool.refreshing || !pool.t) return drawLoading();
      body.append(h('div.empty', h('h2', mode === 'following' ? 'Nothing from your follows yet' : 'Nothing to show'), h('p', mode === 'following' ? 'Follow a creator and their videos land here.' : 'Check your connection, or loosen the filters in Settings > Feed.'), h('div.row', { style: { justifyContent: 'center', gap: '8px', marginTop: '16px' } }, h('button.btn.pri', { onclick: refresh }, 'Retry'), h('a.btn', { href: '#/settings' }, 'Feed settings')), h('div.loadbox', staticLog({ scopes: ['feed', 'net'], title: 'What happened on the last refresh' }))));
      return;
    }
    const why = new Map(rankedAll.map(r => [r.v.id, r.reasons]));
    const mk = (v, i) => card(v, i, { onHide: draw, observe, why: why.get(v.id) });
    if (mode === 'foryou') {
      if (F.shelves.continue) {
        const cont = state.lib.history.filter(e => e.dur && !isShort(e.video) && !isMusic(e.video) && e.progress / e.dur > 0.03 && e.progress / e.dur < 0.93).slice(0, 12).map(e => e.video).filter(v => !state.hidden().videos.has(v.id));
        if (cont.length) { cont.forEach(v => used.add(v.id)); body.append(shelf('Continue', null, cont.map((v, i) => mk(v, i)))); }
      }
      const fol = state.follows();
      if (F.shelves.follows && fol.size) {
        const fv = all.filter(v => fol.has(creatorKey(v)) && !used.has(v.id)).sort((a, b) => b.date - a.date).slice(0, 12);
        if (fv.length >= 3) { fv.forEach(v => used.add(v.id)); body.append(shelf('From people you follow', null, fv.map((v, i) => mk(v, i)))); }
      }
      if (F.shelves.interests) for (const sh of state.ranker.byInterest(all.filter(v => !used.has(v.id)), { hidden: state.hidden() }).slice(0, 2)) {
        sh.items.forEach(v => used.add(v.id));
        body.append(shelf('Because you like ' + sh.terms.slice(0, 2).join(' & '), null, sh.items.map((v, i) => mk(v, i))));
      }
      if (F.shelves.trending) {
        const tr = state.ranker.rank(all.filter(v => !used.has(v.id)), { mode: 'fresh', follows: fol, hidden: state.hidden(), seed: seed + 7, limit: 12 }).map(r => r.v);
        if (tr.length >= 6) { tr.forEach(v => used.add(v.id)); body.append(shelf('New and rising', null, tr.map((v, i) => mk(v, i)))); }
      }
    }
    const rest = freshen(capPerCreator(rankedAll.filter(r => !used.has(r.v.id)), F.perCreator), pool.newIds(), { share: F.newShare });
    if (used.size) body.append(h('div.bighead', h('h2', mode === 'foryou' ? 'More for you' : MODES[mode].label)));
    const g = h('div.grid'); body.append(g);
    stop = infinite(g, rest, (r, i) => mk(r.v, i));
  }
  function drawChips() {
    clear(chips).append(...Object.entries(MODES).map(([k, m]) => h('button.chip', { class: k === mode ? 'on' : '', onclick: () => { mode = k; reseed(); drawChips(); draw(); document.getElementById('view').scrollTo({ top: 0, behavior: 'instant' }); } }, m.label)));
  }
  async function refresh() { reseed(); clear(bannerHost); if (!pool.videos.length) drawLoading(); await doRefresh(true, true); }
  async function doRefresh(forceDraw, manual) {
    let r = null, first = !pool.videos.length;
    try { r = await pool.refresh(all => { if (alive && first && all.length > 20) { first = false; pool.videos = all.slice(); draw(); } }); }
    catch (e) { toast('Refresh failed: ' + friendly(e)); }
    if (!alive) return;
    if (manual && r) toast(r.added ? `${r.added} new videos added to your feed` : 'Nothing new right now. Try again in a bit.');
    if (forceDraw || document.getElementById('view').scrollTop < 80) draw();
    else clear(bannerHost).append(h('div.banner.pillfloat', icon('sparkle', 16), 'New videos', h('button.btn.sm', { onclick: () => { clear(bannerHost); draw(); document.getElementById('view').scrollTo({ top: 0 }); } }, 'Show')));
  }

  root.append(h('div.page', h('div.sticky', h('div.row', chips, h('div.grow'), h('button.iconbtn', { title: 'Find new videos', 'aria-label': 'Find new videos', onclick: refresh }, icon('refresh', 18)))), bannerHost, body));
  if (Date.now() - seedAt > 5 * 60000) reseed();                    // coming back after a while: a different shuffle, like reloading the site
  drawChips(); draw();
  if (pool.stale() || !pool.videos.length) doRefresh(false, false);

  return () => {
    alive = false; stop?.(); stopTerm(); io.disconnect(); visible.forEach(clearTimeout);
    const seen = [...shown].filter(v => v.id !== clicked);
    if (seen.length) { state.ranker.impressions(seen); state.saveProfile(); }
  };
}
