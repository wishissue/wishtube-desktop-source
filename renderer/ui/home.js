import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { MODES } from '../rec/engine.js';
import { creatorKey } from '../core/models.js';
import { card, skeletons, infinite, shelf } from './components.js';

let mode = 'foryou', seed = Date.now() % 100000;

export function home(root) {
  const body = h('div'), chips = h('div.chips'), bannerHost = h('div'); let stop = null, alive = true;
  const visible = new Map(), shown = new Set(); let clicked = null;
  const io = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target._v; if (!v) return;
    if (e.isIntersecting) visible.set(v.id, setTimeout(() => shown.add(v), 1000)); else { clearTimeout(visible.get(v.id)); visible.delete(v.id); }
  }), { root: document.getElementById('view'), threshold: 0.6 });
  const observe = (el, v) => { el._v = v; io.observe(el); el.addEventListener('click', () => { clicked = v.id; }); };
  const enabled = () => pool.videos.filter(v => state.settings.sources[v.source]);

  function draw() {
    if (!alive) return; stop?.(); clear(body);
    const all = enabled(), used = new Set();
    const ranked = state.ranker.rank(all, { mode, follows: state.follows(), hidden: state.hidden(), seed, limit: 160 });
    if (!ranked.length) {
      if (pool.refreshing || !pool.t) { body.append(skeletons(12)); return; }
      body.append(h('div.empty', h('h2', mode === 'following' ? 'Nothing from your follows yet' : 'Nothing to show'), h('p', mode === 'following' ? 'Follow a creator and their videos land here.' : 'Check your connection.'), h('button.btn.pri', { style: { marginTop: '16px' }, onclick: refresh }, 'Retry')));
      return;
    }
    const mk = (v, i) => card(v, i, { onHide: draw, observe, why: ranked.find(r => r.v.id === v.id)?.reasons });
    if (mode === 'foryou') {
      // Continue watching
      const cont = state.lib.history.filter(e => e.dur && e.progress / e.dur > 0.03 && e.progress / e.dur < 0.93).slice(0, 12).map(e => e.video).filter(v => !state.hidden().videos.has(v.id));
      if (cont.length) { cont.forEach(v => used.add(v.id)); body.append(shelf('Continue', null, cont.map((v, i) => mk(v, i)))); }
      // New from follows
      const fol = state.follows();
      if (fol.size) {
        const fv = all.filter(v => fol.has(creatorKey(v)) && !used.has(v.id)).sort((a, b) => b.date - a.date).slice(0, 12);
        if (fv.length >= 3) { fv.forEach(v => used.add(v.id)); body.append(shelf('From people you follow', null, fv.map((v, i) => mk(v, i)))); }
      }
      // One shelf per interest
      for (const sh of state.ranker.byInterest(all.filter(v => !used.has(v.id)), { hidden: state.hidden() }).slice(0, 2)) {
        sh.items.forEach(v => used.add(v.id));
        body.append(shelf('Because you like ' + sh.terms.slice(0, 2).join(' & '), null, sh.items.map((v, i) => mk(v, i))));
      }
    }
    const rest = ranked.filter(r => !used.has(r.v.id));
    if (used.size) body.append(h('div.bighead', h('h2', mode === 'foryou' ? 'More for you' : MODES[mode].label)));
    const g = h('div.grid'); body.append(g);
    stop = infinite(g, rest, (r, i) => mk(r.v, i));
  }
  function drawChips() {
    clear(chips).append(...Object.entries(MODES).map(([k, m]) => h('button.chip', { class: k === mode ? 'on' : '', onclick: () => { mode = k; seed = Date.now() % 100000; drawChips(); draw(); document.getElementById('view').scrollTo({ top: 0, behavior: 'instant' }); } }, m.label)));
  }
  async function refresh() { seed = Date.now() % 100000; clear(body).append(skeletons(12)); clear(bannerHost); await doRefresh(true); }
  async function doRefresh(forceDraw) {
    try { await pool.refresh(all => { if (alive && !pool.videos.length && all.length > 20) { pool.videos = all.slice(); draw(); } }); }
    catch (e) { toast('Refresh failed: ' + e.message); }
    if (!alive) return;
    if (forceDraw || document.getElementById('view').scrollTop < 80) draw();
    else clear(bannerHost).append(h('div.banner.pillfloat', icon('sparkle', 16), 'New videos', h('button.btn.sm', { onclick: () => { clear(bannerHost); draw(); document.getElementById('view').scrollTo({ top: 0 }); } }, 'Show')));
  }

  root.append(h('div.page', h('div.sticky', h('div.row', chips, h('div.grow'), h('button.iconbtn', { title: 'Refresh feed', onclick: refresh }, icon('refresh', 18)))), bannerHost, body));
  drawChips(); draw();
  if (pool.stale() || !pool.videos.length) doRefresh(false);

  return () => {
    alive = false; stop?.(); io.disconnect(); visible.forEach(clearTimeout);
    const seen = [...shown].filter(v => v.id !== clicked);
    if (seen.length) { state.ranker.impressions(seen); state.saveProfile(); }
  };
}
