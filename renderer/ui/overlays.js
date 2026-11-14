import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { tokens } from '../rec/text.js';
import { go, watchPath } from './components.js';
import { THEMES } from '../core/themes.js';

const overlay = () => document.getElementById('overlay');
export const closeOverlay = () => { clear(overlay()); };

/** Ctrl+K: jump anywhere, search everything, or find something you've already seen, all locally. */
export function palette() {
  const input = h('input', { placeholder: 'Search, paste a link, or jump to…', autofocus: true }), res = h('div.res'); let sel = 0, rows = [];
  const cmds = [
    { t: 'Home', ic: 'home', run: () => go('/') }, { t: 'Following', ic: 'users', run: () => go('/following') }, { t: 'Library', ic: 'library', run: () => go('/library/history') },
    { t: 'Downloads', ic: 'download', run: () => go('/downloads') }, { t: 'Settings', ic: 'settings', run: () => go('/settings') },
    ...THEMES.map(t => ({ t: 'Theme: ' + t.name, ic: 'palette', run: () => { state.settings.theme = t.id; state.saveSettings(); } })),
    { t: 'Refresh feed', ic: 'refresh', run: () => { pool.t = 0; go('/'); location.reload(); } },
  ];
  const draw = () => {
    const q = input.value.trim(), ql = q.toLowerCase(); rows = [];
    if (q) rows.push({ t: /^https?:\/\//.test(q) ? `Open ${q}` : `Search for “${q}”`, ic: /^https?:/.test(q) ? 'ext' : 'search', run: () => go('/search/' + encodeURIComponent(q)) });
    rows.push(...cmds.filter(c => !q || c.t.toLowerCase().includes(ql)));
    if (q.length > 1) {
      const qt = tokens(q), seen = new Map();
      for (const v of [...state.lib.history.map(x => x.video), ...Object.values(state.lib.liked), ...Object.values(state.lib.saved), ...pool.videos]) if (!seen.has(v.id)) seen.set(v.id, v);
      const hits = [...seen.values()].map(v => { const t = (v.title + ' ' + v.creator).toLowerCase(); return [v, qt.length ? qt.filter(x => t.includes(x)).length / qt.length : 0, t.includes(ql) ? 1 : 0]; }).filter(x => x[1] > 0.99 || x[2]).slice(0, 7);
      rows.push(...hits.map(([v]) => ({ t: v.title, ic: 'play', small: v.creator, run: () => go(watchPath(v)) })));
    }
    sel = Math.min(sel, rows.length - 1);
    clear(res).append(...rows.map((r, i) => h('button', { class: i === sel ? 'on' : '', onmouseenter: () => { sel = i; paint(); }, onclick: () => { closeOverlay(); r.run(); } }, icon(r.ic, 17), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.t), r.small ? h('small', r.small) : null)));
  };
  const paint = () => [...res.children].forEach((b, i) => b.classList.toggle('on', i === sel));
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(rows.length - 1, sel + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { const r = rows[sel]; closeOverlay(); r?.run(); }
    else if (e.key === 'Escape') closeOverlay();
  });
  const o = overlay(); clear(o).append(h('div.palette', input, res)); o.onmousedown = e => { if (e.target === o) closeOverlay(); };
  draw(); input.focus();
}

const INTERESTS = ['Science', 'Space', 'Programming', 'Linux', 'Music', 'History', 'Art & design', 'Film', 'Nature', 'Cooking', 'DIY & making', 'Travel', 'Philosophy', 'Gaming', 'Math', 'Languages', 'Security', 'Documentaries'];
export function onboarding(done) {
  const pick = new Set(); const btns = INTERESTS.map(t => h('button.chip', { onclick: e => { pick.has(t) ? pick.delete(t) : pick.add(t); e.currentTarget.classList.toggle('on'); go2.disabled = false; } }, t));
  const go2 = h('button.btn.pri', { onclick: () => {
    state.settings.interests = [...pick].map(x => x.toLowerCase().replace(' & ', ' ')); state.settings.onboarded = true;
    for (const t of state.settings.interests) for (const w of t.split(' ')) state.ranker.seed(w);
    state.saveSettings(); state.flushProfile(); closeOverlay(); done();
  } }, 'Start watching');
  const skip = h('button.btn', { onclick: () => { state.settings.onboarded = true; state.saveSettings(); closeOverlay(); done(); } }, 'Skip');
  const o = overlay(); clear(o).append(h('div.palette', { style: { padding: '36px', maxHeight: '80vh', overflow: 'auto', textAlign: 'center' } },
    h('h1', { style: { fontSize: '28px' } }, 'Welcome to WishTube'), h('p.sub', { style: { margin: '8px 0 0' } }, 'Open video from PeerTube, Odysee, the Internet Archive and more. No account, no tracking. Pick a few interests to start. Your feed learns from what you actually watch.'),
    h('div.chips', { style: { flexWrap: 'wrap', justifyContent: 'center', margin: '26px 0' } }, ...btns), h('div.row', { style: { justifyContent: 'center' } }, skip, go2)));
  o.onmousedown = null;
}
