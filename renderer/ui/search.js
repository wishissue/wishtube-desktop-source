import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { sources } from '../sources/manager.js';
import { SOURCES } from '../core/models.js';
import { dedupe } from '../rec/engine.js';
import { card, skeletons, go, watchPath } from './components.js';

export async function search(root, { q }) {
  let alive = true, sort = 'relevance', page = 0, results = [], filter = null, loading = false;
  const bySrc = {}, grid = h('div.grid'), chips = h('div.chips'), status = h('div.sub'), more = h('div', { style: { textAlign: 'center', margin: '30px 0' } });

  if (/^https?:\/\//i.test(q)) {                                          // a pasted link opens directly
    root.append(h('div.page', h('div.empty', h('h2', 'Opening link…'))));
    const v = await sources.resolveUrl(q);
    if (v && alive) { location.replace('#' + watchPath(v)); return () => { alive = false; }; }
    clear(root).append(h('div.page', h('div.empty', h('h2', 'Couldn’t open that link'), h('p', 'None of your enabled sources recognise it.'))));
    return () => { alive = false; };
  }

  function view() {
    const lists = Object.entries(bySrc).filter(([id]) => !filter || id === filter).map(([, l]) => l);
    const merged = []; for (let i = 0; lists.some(l => i < l.length); i++) for (const l of lists) if (i < l.length) merged.push(l[i]);
    results = dedupe(merged);
    if (sort === 'relevance' && state.ranker.p.events > 5) {                // gentle personalisation: keep source order, nudge by taste
      const pos = new Map(results.map((v, i) => [v.id, i]));
      const rk = new Map(state.ranker.rank(results, { seed: 1, limit: results.length, hidden: state.hidden(), follows: state.follows() }).map((r, i) => [r.v.id, i]));
      results = [...results].sort((a, b) => (pos.get(a.id) * 0.7 + (rk.get(a.id) ?? 99) * 0.3) - (pos.get(b.id) * 0.7 + (rk.get(b.id) ?? 99) * 0.3));
    }
    clear(grid); results.filter(v => !state.hidden().videos.has(v.id)).forEach((v, i) => grid.append(card(v, Math.min(i, 14), { onHide: view })));
    drawChips();
    status.textContent = loading ? 'Searching…' : results.length ? `${results.length} results` : '';
    clear(more); if (!loading && results.length) more.append(h('button.btn', { onclick: () => run(page + 1) }, 'Load more'));
  }
  function drawChips() {
    clear(chips).append(...sources.active().map(id => h('button.chip.src', { class: filter === id ? 'on' : filter ? 'off' : '', onclick: () => { filter = filter === id ? null : id; view(); } },
      h('i.dot', { style: { background: SOURCES[id].color } }), SOURCES[id].label, bySrc[id] ? h('span.sub', { style: { marginLeft: '2px' } }, bySrc[id].length) : null)));
  }
  async function run(p) {
    page = p; loading = true; if (!p) { Object.keys(bySrc).forEach(k => delete bySrc[k]); clear(grid).append(skeletons(8)); }
    const errs = []; const off = state.bus.on('source-error', e => errs.push(e));
    await sources.search(q, p, sort, (id, l) => { if (!alive) return; bySrc[id] = [...(bySrc[id] || []), ...l]; if (p === 0 && grid.querySelector('.skel')) clear(grid); view(); });
    off(); loading = false; if (!alive) return; view();
    if (!results.length) clear(grid).append(h('div.empty', { style: { gridColumn: '1/-1' } }, h('h2', `No results for “${q}”`), h('p', errs.length ? `${errs.length} source(s) didn’t respond. Check your connection.` : 'Try different words or enable more sources.')));
  }
  root.append(h('div.page',
    h('div.row.wrap', { style: { marginBottom: '16px' } }, h('h1', `Results for “${q}”`), status, h('div.grow'),
      h('select.input', { style: { minWidth: '140px' }, onchange: e => { sort = e.target.value; run(0); } }, ...[['relevance', 'Relevance'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['popular', 'Most popular']].map(([v, l]) => h('option', { value: v }, l)))),
    h('div', { style: { marginBottom: '20px' } }, chips), grid, more));
  drawChips(); run(0);
  return () => { alive = false; };
}
