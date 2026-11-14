import { h, clear, $ } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { state } from './core/state.js';
import { pool } from './rec/pool.js';
import { sources } from './sources/manager.js';
import { go, avatar } from './ui/components.js';
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
    currentNav = nav ?? (path.startsWith('/library') ? ({ later: 'later', liked: 'liked', saved: 'saved' })[path.split('/')[2]] || 'library' : null); setNav(currentNav);
    const r = await mk(m)(view);
    if (my === token) cleanup = r; else await r?.();
    if (!/^\/(watch|search)/.test(path) || true) view.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  go('/');
}

function setNav(id) { document.querySelectorAll('#rail .nav').forEach(n => n.classList.toggle('on', n.dataset.id === id)); }
const THEMES = ['terminal', 'glass', 'bit', 'classic'];

function rail() {
  const nav = (id, ic, label, path) => h('a.nav', { href: '#' + path, dataset: { id }, title: label }, icon(ic, 21), h('span', label));
  const follows = Object.values(state.lib.follows);
  clear($('#rail')).append(
    nav('home', 'home', 'Home', '/'), nav('following', 'users', 'Following', '/following'),
    h('div.rline'), h('div.rhead', 'You'),
    nav('library', 'clock', 'History', '/library/history'), nav('later', 'clock', 'Watch later', '/library/later'), nav('liked', 'heart', 'Liked', '/library/liked'), nav('saved', 'bookmark', 'Saved', '/library/saved'), nav('downloads', 'download', 'Downloads', '/downloads'),
    ...(follows.length ? [h('div.rline'), h('div.rhead', 'Following'), ...follows.slice(0, 14).map(f => h('a.nav', { href: `#/creator/${f.source}/${encodeURIComponent(f.creatorId)}`, title: f.name }, avatar(f.name, f.avatar, 26), h('span', f.name)))] : []),
    h('div.rline'), nav('settings', 'settings', 'Settings', '/settings'));
}

function shell() {
  const input = h('input', { id: 'q', placeholder: 'Search or paste a video link', autocomplete: 'off', onkeydown: e => { if (e.key === 'Enter' && input.value.trim()) { go('/search/' + encodeURIComponent(input.value.trim())); input.blur(); } else if (e.key === 'Escape') input.blur(); } });
  clear($('#top')).append(
    h('button.iconbtn', { title: 'Toggle sidebar', onclick: () => { state.settings.sidebar = !state.settings.sidebar; state.saveSettings(); } }, icon('menu', 22)),
    h('a.brand', { href: '#/' }, h('div.logo'), h('span', 'WishTube')),
    h('button.iconbtn', { title: 'Back (Alt+←)', onclick: () => history.back() }, icon('back', 20)), h('button.iconbtn', { title: 'Forward (Alt+→)', onclick: () => history.forward() }, icon('fwd', 20)),
    h('div.search', icon('search', 18), input, h('kbd', 'Ctrl K')),
    h('button.iconbtn', { title: 'Density', onclick: () => { state.settings.density = state.settings.density === 'compact' ? 'comfortable' : 'compact'; state.saveSettings(); } }, icon('sliders', 19)),
    h('button.iconbtn', { title: 'Switch theme', onclick: () => { const i = THEMES.indexOf(document.documentElement.dataset.theme); state.settings.theme = THEMES[(i + 1) % THEMES.length]; state.saveSettings(); } }, icon('sparkle', 19)));
  rail();
}
state.bus.on('library', () => { if (state.ready) { rail(); setNav(currentNav); } });

addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); palette(); }
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
