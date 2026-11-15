import { h, clear, fmtAgo } from './dom.js';
import { icon } from './icons.js';
import { sources } from '../sources/manager.js';
import { avatar } from './components.js';
import { SORTS, sortComments, filterComments, topMeaningful } from '../core/comments.js';

/** Read-only comments from the provider's public API. Loaded when asked, never fabricated, and the original discussion is one click away. */
export function commentsPanel(v) {
  if (!sources.hasComments(v)) return h('div.cpanel', h('div.row', h('h3.grow', 'Comments'), h('button.btn.sm', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 15), 'Open discussion')), h('p.sub', 'This provider doesn’t publish comments through a public interface, so there is nothing to show here.'));
  let all = [], page = 0, sort = 'new', q = '', total = null, more = false, loaded = false, busy = false, collapsed = false, err = null;
  const list = h('div.clist'), head = h('div.row.wrap.chead'), box = h('div.cpanel', head, list);
  const expanded = new Map();                                       // thread id -> replies

  async function load(reset) {
    if (busy) return; busy = true; draw();
    try {
      if (reset) { all = []; page = 0; }
      const r = await sources.comments(v, { page, sort: sort === 'top' ? 'top' : 'new' });
      all = [...all, ...r.items.filter(x => !all.some(y => y.id === x.id))]; total = r.total; more = r.hasMore; page++; loaded = true; err = null;
    } catch (e) { err = e.message; }
    busy = false; draw();
  }
  function draw() {
    const shown = filterComments(sortComments(all, sort), q);
    clear(head).append(h('h3', { style: { marginRight: 'auto', whiteSpace: 'nowrap' } }, 'Comments', total != null ? h('span.sub', ' ' + new Intl.NumberFormat().format(total)) : null));
    if (!loaded && !err) { clear(list); return head.append(h('button.btn', { class: busy ? 'loading' : '', disabled: busy, onclick: () => load(true) }, icon('msg', 15), busy ? 'Loading' : 'Show comments'), h('button.btn.sm', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 15), 'Original')); }
    head.append(
      h('input.input.csearch', { placeholder: 'Search comments…', 'aria-label': 'Search in comments', value: q, oninput: e => { q = e.target.value; const p = e.target.selectionStart; draw(); const n = head.querySelector('.csearch'); n.focus(); n.setSelectionRange(p, p); } }),
      h('select.input', { 'aria-label': 'Sort comments', onchange: e => { sort = e.target.value; if (sort === 'top' && !topMeaningful(all)) { /* provider order */ } draw(); } }, ...Object.entries(SORTS).map(([k, l]) => h('option', { value: k, selected: k === sort }, l))),
      h('button.btn.sm', { title: collapsed ? 'Expand all' : 'Collapse all', onclick: () => { collapsed = !collapsed; if (collapsed) expanded.clear(); draw(); } }, icon(collapsed ? 'down' : 'up', 15), collapsed ? 'Expand' : 'Collapse'),
      h('button.btn.sm', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 15), 'Open discussion'));
    clear(list);
    if (err) return list.append(h('div.sub.cerr', err, ' ', h('button.link', { onclick: () => load(true) }, 'Retry')));
    if (!all.length) return list.append(h('p.sub', 'No comments yet.'));
    if (collapsed) return list.append(h('p.sub', `${all.length} comments hidden.`));
    if (sort === 'top' && !topMeaningful(all)) list.append(h('p.sub', 'This provider doesn’t report likes, so “Top” keeps the newest first.'));
    if (q && !shown.length) list.append(h('p.sub', 'No loaded comments match. ' + (more ? 'Load more to search further.' : '')));
    shown.forEach(c => list.append(row(c)));
    if (more) list.append(h('button.btn', { class: busy ? 'loading' : '', disabled: busy, style: { margin: '12px 0' }, onclick: () => load(false) }, busy ? 'Loading' : 'Load more comments'));
  }
  function row(c, depth = 0) {
    const long = c.text.length > 320, open = { v: false };
    const body = h('div.ctext'), set = () => { body.textContent = !long || open.v ? c.text : c.text.slice(0, 300) + '…'; more.textContent = open.v ? 'Show less' : 'Read more'; };
    const more = h('button.link', { onclick: () => { open.v = !open.v; set(); } });
    const reps = h('div.creps'), rBtn = c.replies > 0 ? h('button.link', { onclick: async () => {
      if (expanded.has(c.id)) { expanded.delete(c.id); clear(reps); rBtn.textContent = `${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`; return; }
      rBtn.textContent = 'Loading…'; try { const r = await sources.replies(v, c); expanded.set(c.id, r); clear(reps).append(...r.map(x => row(x, 1))); rBtn.textContent = 'Hide replies'; } catch (e) { rBtn.textContent = 'Couldn’t load replies. Retry'; }
    } }, `${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`) : null;
    set();
    return h('div.comment' + (depth ? '.reply' : ''), avatar(c.user, c.avatar, depth ? 26 : 36), h('div.grow', h('div.chd', h('b', c.user), c.date ? h('span.sub', fmtAgo(c.date)) : null, c.stars ? h('span.sub', '★'.repeat(c.stars)) : null),
      body, long ? more : null, h('div.row', { style: { gap: '14px' } }, c.likes != null ? h('span.sub', h('span', '👍 '), new Intl.NumberFormat(undefined, { notation: 'compact' }).format(c.likes)) : null, rBtn), reps));
  }
  draw(); return box;
}
