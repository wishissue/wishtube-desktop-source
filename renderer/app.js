import { h, clear, $ } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { state } from './core/state.js';
import { pool } from './rec/pool.js';
import { sources } from './sources/manager.js';
import { go, contextMenu } from './ui/components.js';
import { THEMES } from './core/themes.js';
import { home } from './ui/home.js';
import { search } from './ui/search.js';
import { watch } from './ui/watch.js';
import { library, following, creator } from './ui/library.js';
import { settings } from './ui/settings.js';
import { downloads } from './ui/downloads.js';
import { palette, onboarding, closeOverlay } from './ui/overlays.js';

const ROUTES = [
  [/^\/$/, () => home, 'home'], [/^\/search\/(.*)$/, m => (r) => search(r, { q: decodeURIComponent(m[1]) }), null],
  [/^\/watch\/(.*)$/, m => (r) => watch(r, { id: decodeURIComponent(m[1]) }), null],
  [/^\/library(?:\/(\w+))?$/, m => (r) => library(r, { tab: m[1] }), null], [/^\/following$/, () => following, 'following'],
  [/^\/creator\/(\w+)\/(.*)$/, m => (r) => creator(r, { src: m[1], cid: decodeURIComponent(m[2]) }), null],
  [/^\/settings$/, () => settings, 'settings'], [/^\/downloads$/, () => downloads, 'downloads'],
];
let cleanup = null, token = 0, currentNav = null;

async function route() {
  const path = decodeURIComponent(location.hash.slice(1)) === '' ? '/' : location.hash.slice(1);
  const view = $('#view'), my = ++token;
  try { await cleanup?.(); } catch (e) { console.error(e); } cleanup = null;
  clear(view);
  for (const [re, mk, nav] of ROUTES) {
    const m = path.match(re); if (!m) continue;
    currentNav = nav ?? (path.startsWith('/library') ? 'library' : null); setNav(currentNav);
    const r = await mk(m)(view);
    if (my === token) cleanup = r; else await r?.();
    if (!/^\/(watch|search)/.test(path) || true) view.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  go('/');
}

function setNav(id) { document.querySelectorAll('#rail .nav').forEach(n => n.classList.toggle('on', n.dataset.id === id)); }

function rail() {
  const nav = (id, ic, label, path, cls = '') => h('a.nav' + cls, { href: '#' + path, dataset: { id }, title: label }, icon(ic, 22), h('span', label));
  clear($('#rail')).append(nav('home', 'home', 'Home', '/'), nav('following', 'users', 'Following', '/following'), nav('library', 'library', 'Library', '/library/history'),
    nav('downloads', 'download', 'Downloads', '/downloads'), nav('settings', 'settings', 'Settings', '/settings', '.end'));
}

function shell() {
  const sugg = h('div.sugg', { hidden: true, role: 'listbox' }); let items = [], sel = -1;
  const closeSugg = () => { sugg.hidden = true; sel = -1; };
  const drawSugg = () => {                                           // recent searches, filtered by what is typed; all stored locally
    const q = input.value.trim().toLowerCase();
    items = (state.lib.searches || []).filter(s => !q || (s.toLowerCase().includes(q) && s.toLowerCase() !== q)).slice(0, 8); sel = -1; clear(sugg);
    if (!items.length) { sugg.hidden = true; return; }
    sugg.hidden = false;
    sugg.append(h('div.sh', h('span', 'Recent searches'), h('button.link', { type: 'button', onmousedown: e => e.preventDefault(), onclick: () => { state.clearSearches(); drawSugg(); } }, 'Clear all')),
      ...items.map(s => h('div.sitem', { role: 'option', onmousedown: e => e.preventDefault(), onclick: () => { input.value = s; submit(); } }, icon('clock', 15), h('span.grow', s),
        h('button.iconbtn', { type: 'button', title: 'Remove from history', 'aria-label': 'Remove ' + s, onmousedown: e => e.preventDefault(), onclick: e => { e.stopPropagation(); state.removeSearch(s); drawSugg(); } }, icon('x', 14)))));
  };
  const mark = () => [...sugg.querySelectorAll('.sitem')].forEach((el, i) => el.classList.toggle('on', i === sel));
  const submit = () => { const v = input.value.trim(); closeSugg(); if (v) { state.addSearch(v); go('/search/' + encodeURIComponent(v)); input.blur(); } else input.focus(); };
  const input = h('input', { id: 'q', placeholder: 'Search or paste a link', autocomplete: 'off', 'aria-label': 'Search', onfocus: drawSugg, oninput: drawSugg, onblur: closeSugg, onclick: () => { if (sugg.hidden) drawSugg(); },
    onkeydown: e => {
      if (e.key === 'Enter') { if (sel >= 0 && items[sel]) input.value = items[sel]; submit(); }
      else if (e.key === 'Escape') { if (!sugg.hidden) { closeSugg(); e.stopPropagation(); } else input.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (sugg.hidden) drawSugg();
        if (items.length) { e.preventDefault(); sel = e.key === 'ArrowDown' ? (sel + 1 >= items.length ? -1 : sel + 1) : (sel - 1 < -1 ? items.length - 1 : sel - 1); mark(); }
      }
    } });
  const themeMenu = e => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.right - 190, r.bottom + 6, THEMES.map(t => ({ icon: state.settings.theme === t.id ? 'check' : 'palette', label: t.name, run: () => { state.settings.theme = t.id; state.saveSettings(); } }))); };
  clear($('#top')).append(
    h('a.brand', { href: '#/' }, h('div.logo'), h('span', 'WishTube')),
    h('div.search', h('button.sgo', { type: 'button', title: 'Search', 'aria-label': 'Search', onclick: submit }, icon('search', 17)), input, h('kbd', 'Ctrl K'), sugg),
    h('button.iconbtn', { title: 'Theme', onclick: themeMenu }, icon('palette', 20)));
  rail();
}

addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); go('/settings'); }
  else if (e.key === '/' && !typing) { e.preventDefault(); $('#q').focus(); }
  else if (e.key === 'Escape') closeOverlay();
  else if (e.altKey && e.key === 'ArrowLeft') history.back(); else if (e.altKey && e.key === 'ArrowRight') history.forward();
});
addEventListener('hashchange', route);
addEventListener('beforeunload', () => { state.flushProfile(); });
window.addEventListener('unhandledrejection', e => console.warn('unhandled', e.reason));

(async function init() {
  await state.load(); await pool.load();
  window.wt.on('open-url', async url => { const v = await sources.resolveUrl(url); if (v) go(`/watch/${encodeURIComponent(v.id)}`); });
  window.wt.on('fullscreen', () => {});
  const dlBadge = window.wt.on('dl:update', d => { if (d.state === 'done') import('./ui/dom.js').then(m => m.toast('Download finished: ' + d.title.slice(0, 40))); });
  shell(); await route();
  if (!state.settings.onboarded) onboarding(() => route());
  setInterval(() => state.ranker.dirty && (state.ranker.dirty = false, state.flushProfile()), 30000);
})();
