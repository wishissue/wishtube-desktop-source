import { h, fmtDur, fmtViews, fmtAgo, toast, clear } from './dom.js';
import { icon } from './icons.js';
import { SOURCES, creatorKey } from '../core/models.js';
import { state } from '../core/state.js';

export const go = path => { location.hash = '#' + path; };
export const watchPath = v => `/watch/${encodeURIComponent(v.id)}`;
export const creatorPath = v => `/creator/${v.source}/${encodeURIComponent(v.creatorId)}`;

export function avatar(name, url, size = 34) {
  const el = h('div.avatar', { style: { width: size + 'px', height: size + 'px', fontSize: size * .4 + 'px' } }, (name || '?').trim()[0]?.toUpperCase());
  if (url) { const i = h('img', { src: url, loading: 'lazy', onerror: () => i.remove() }); el.textContent = ''; el.append(i); }
  return el;
}

export function thumb(v, extra) {
  const ph = h('div.ph', icon('play', 28));
  const img = h('img', { src: v.thumb || '', loading: 'lazy', alt: '', onload: e => e.target.classList.add('ld'), onerror: e => e.target.remove() });
  const prog = state.lib.history.find(x => x.id === v.id);
  const pct = prog?.dur ? Math.min(100, (prog.progress / prog.dur) * 100) : 0;
  return h('div.thumb', v.thumb ? [ph, img] : ph,
    h('div.play', h('i', icon('play', 20))),
    v.dur ? h('span.tag.dur', fmtDur(v.dur)) : null,
    h('span.tag.src', h('i.dot', { style: { background: SOURCES[v.source].color } }), SOURCES[v.source].label),
    pct > 2 ? h('div.prog', h('i', { style: { width: pct + '%' } })) : null, extra);
}

const sub = v => [fmtViews(v.views), fmtAgo(v.date)].filter(Boolean).join(' · ');

/** Right-click / ⋯ menu. */
export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx').forEach(e => e.remove());
  const m = h('div.ctx', items.filter(Boolean).map(it => h('button', { onclick: () => { m.remove(); it.run(); } }, icon(it.icon, 17), it.label)));
  document.body.append(m);
  const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 10) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 10) + 'px';
  const off = e => { if (!m.contains(e.target)) { m.remove(); removeEventListener('mousedown', off, true); } };
  setTimeout(() => addEventListener('mousedown', off, true), 0);
}
const withAudio = f => import('../core/audio.js').then(m => f(m.audio));
export const videoMenu = (v, refresh) => [
  { icon: 'play', label: 'Play next', run: () => withAudio(a => { a.add(v, { next: true }); toast('Playing next'); }) },
  { icon: 'queue', label: 'Add to queue', run: () => withAudio(a => { a.add(v); toast('Added to queue'); }) },
  { icon: 'listplus', label: 'Add to playlist…', run: () => import('./playlists.js').then(m => m.addToPlaylistDialog(v)) },
  { icon: 'clock', label: state.lib.later[v.id] ? 'Remove from Watch later' : 'Watch later', run: () => { toast(state.toggleList('later', v) ? 'Added to Watch later' : 'Removed'); refresh?.(); } },
  { icon: 'bookmark', label: state.lib.saved[v.id] ? 'Unsave' : 'Save', run: () => toast(state.toggleList('saved', v) ? 'Saved' : 'Removed') },
  { icon: 'ext', label: 'Open original page', run: () => window.wt.openExternal(v.url) },
  { icon: 'eyeoff', label: 'Not interested', run: () => { state.notInterested(v); toast('Got it. Fewer videos like this.'); refresh?.(); } },
  { icon: 'users', label: `Don't recommend ${v.creator.slice(0, 22)}`, run: () => { state.hideCreator(v); toast('Channel hidden from your feed'); refresh?.(); } },
];

export function card(v, i = 0, { why, onHide, observe } = {}) {
  const ago = fmtAgo(v.date), go2 = e => e.stopPropagation();
  const el = h('a.card', { href: '#' + watchPath(v), style: { '--i': i }, dataset: { id: v.id },
    oncontextmenu: e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, videoMenu(v, onHide)); } },
    thumb(v),
    h('div.meta', h('div.grow', h('div.title', { title: v.title }, v.title),
      h('div.sub', { title: why?.[0] ? 'Shown because: ' + why[0] : '' }, h('a', { href: '#' + creatorPath(v), onclick: go2 }, v.creator), ago ? ' · ' + ago : null))),
    h('button.iconbtn.cardmenu', { title: 'More', onclick: e => { e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left - 170, r.bottom, videoMenu(v, onHide)); } }, icon('more', 18)));
  observe?.(el, v);
  return el;
}

export const mini = (v, i = 0, why) => h('a.mini', { href: '#' + watchPath(v), style: { '--i': i }, title: why ? 'Shown because: ' + why : '' }, thumb(v),
  h('div', h('div.title', v.title), h('div.sub', v.creator), h('div.sub', sub(v))));

export function skeletons(n = 12) { return h('div.grid', Array.from({ length: n }, () => h('div', h('div.skel', { style: { aspectRatio: '16/9' } }), h('div.skel', { style: { height: '14px', margin: '12px 0 6px', width: '85%' } }), h('div.skel', { style: { height: '12px', width: '55%' } })))); }

/** Renders a long list in chunks as you scroll, so 600 results cost 24 DOM cards at first. */
export function infinite(container, items, make, chunk = 24) {
  let n = 0; const sentinel = h('div.sentinel');
  const more = () => { const end = Math.min(items.length, n + chunk); for (; n < end; n++) container.insertBefore(make(items[n], n), sentinel); if (n >= items.length) io.disconnect(); };
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { root: document.getElementById('view'), rootMargin: '900px' });
  container.append(sentinel); io.observe(sentinel); more();
  return () => io.disconnect();
}
export { clear };

/** Horizontal shelf with prev/next. Cards inside keep a fixed width and snap. */
export function shelf(title, sub, cards) {
  const sc = h('div.scroller', cards);
  const step = d => sc.scrollBy({ left: d * sc.clientWidth * 0.85 });
  return h('section.shelf', h('div.shelfhead', h('h2', title, sub ? h('small', sub) : null), h('button.iconbtn', { title: 'Previous', onclick: () => step(-1) }, icon('back', 18)), h('button.iconbtn', { title: 'Next', onclick: () => step(1) }, icon('fwd', 18))), sc);
}
