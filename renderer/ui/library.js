import { h, clear, toast, fmtAgo, fmtDur } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { sources } from '../sources/manager.js';
import { SOURCES, creatorKey } from '../core/models.js';
import { playlistsTab } from './playlists.js';
import { card, avatar, thumb, watchPath, creatorPath, go, skeletons } from './components.js';

const TABS = [['history', 'History', 'clock'], ['later', 'Watch later', 'clock'], ['liked', 'Liked', 'heart'], ['saved', 'Saved', 'bookmark'], ['playlists', 'Playlists', 'queue']];

export function library(root, { tab = 'history' }) {
  const body = h('div'), tabs = h('div.chips');
  const items = t => t === 'playlists' ? Object.values(state.lib.playlists) : t === 'history' ? state.lib.history.map(x => x.video) : Object.values(state.lib[t]).reverse();
  function draw() {
    clear(tabs).append(...TABS.map(([k, l]) => h('button.chip', { class: k === tab ? 'on' : '', onclick: () => go('/library/' + k) }, l, h('span', { style: { opacity: .6 } }, items(k).length || ''))));
    clear(body); const list = items(tab);
    if (tab === 'playlists') return playlistsTab(body, draw);
    if (!list.length) return body.append(h('div.empty', h('h2', 'Nothing here yet'), h('p', tab === 'history' ? 'Videos you watch show up here.' : 'Use the buttons on any video to fill this up.')));
    if (tab === 'history') {
      body.append(h('div.row', { style: { marginBottom: '12px' } }, h('div.grow'), h('button.btn.sm.danger', { onclick: () => { if (confirm('Clear your watch history? Your recommendations keep what they learned.')) { state.lib.history = []; state.saveLib(); draw(); } } }, icon('trash', 15), 'Clear history')));
      body.append(h('div.list', ...state.lib.history.map((e, i) => h('a.item', { href: '#' + watchPath(e.video), style: { animationDelay: Math.min(i, 12) * 25 + 'ms' } }, h('div', { style: { width: '160px', flex: 'none' } }, thumb(e.video)),
        h('div.grow', h('div.title', e.video.title), h('div.sub', `${e.video.creator} · ${SOURCES[e.video.source].label}`), h('div.sub', `Watched ${fmtAgo(e.t)}${e.dur ? ` · ${Math.round(Math.min(1, e.progress / e.dur) * 100)}%` : ''}`)),
        h('button.iconbtn', { title: 'Remove', onclick: ev => { ev.preventDefault(); state.lib.history.splice(i, 1); state.saveLib(); draw(); } }, icon('x', 16))))));
    } else {
      const grid = h('div.grid'), find = h('input.input', { placeholder: 'Filter this list…', 'aria-label': 'Filter this list', style: { maxWidth: '320px', marginBottom: '14px' } });
      const paint = () => { const q = find.value.trim().toLowerCase(), f = q ? list.filter(v => (v.title + ' ' + v.creator).toLowerCase().includes(q)) : list; clear(grid).append(...(f.length ? f.map((v, i) => card(v, Math.min(i, 14), { onHide: draw })) : [h('div.empty', h('p', 'No matches'))])); };
      find.addEventListener('input', paint); paint(); body.append(find, grid);
    }
  }
  root.append(h('div.page', h('div.sticky', tabs), body)); draw();
  return state.bus.on('library', draw);
}

export function following(root) {
  const fl = Object.entries(state.lib.follows), feed = h('div'); let alive = true;
  root.append(h('div.page', h('h1', { style: { marginBottom: '16px' } }, 'Following'),
    fl.length ? h('div.row.wrap', { style: { marginBottom: '26px', gap: '18px' } }, ...fl.map(([k, f]) => h('a', { href: `#/creator/${f.source}/${encodeURIComponent(f.creatorId)}`, style: { textAlign: 'center', width: '84px' } }, avatar(f.name, f.avatar, 56), h('div.sub', { style: { marginTop: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.name)))) : null, feed));
  if (!fl.length) { feed.append(h('div.empty', h('h2', 'You’re not following anyone yet'), h('p', 'Hit Follow on any video. Their new uploads will appear here.'))); return () => {}; }
  feed.append(skeletons(6));
  Promise.all(fl.map(([k, f]) => sources.creatorVideos(f.source, f.creatorId, 0).catch(() => []))).then(r => {
    if (!alive) return;
    const vids = r.flat().filter(v => !state.hidden().videos.has(v.id)).sort((a, b) => b.date - a.date);
    clear(feed).append(vids.length ? h('div.grid', ...vids.map((v, i) => card(v, Math.min(i, 14)))) : h('div.empty', h('h2', 'No uploads found'), h('p', 'Those channels have nothing new, or their sources are unreachable.')));
  });
  return () => { alive = false; };
}

export async function creator(root, { src, cid }) {
  let alive = true, page = 0; const vids = [], grid = h('div.grid'), head = h('div'), more = h('div', { style: { textAlign: 'center', margin: '30px 0' } });
  root.append(h('div.page', head, grid, more));
  grid.append(...skeletons(8).children);
  const info = (await sources.creatorInfo(src, cid)) || { name: decodeURIComponent(cid).replace(/@.*/, ''), desc: '' };
  const probe = { source: src, creatorId: cid, creator: info.name };
  const folB = h('button.btn', { onclick: () => { const on = state.toggleFollow(probe, info); folB.className = 'btn' + (on ? ' on' : ' pri'); folB.lastChild.textContent = on ? 'Following' : 'Follow'; } }, icon('plus', 16), 'Follow');
  const upd = () => { const on = state.isFollowing(probe); folB.className = 'btn' + (on ? ' on' : ' pri'); folB.lastChild.textContent = on ? 'Following' : 'Follow'; }; upd();
  head.append(h('div.row', { style: { gap: '20px', marginBottom: '26px' } }, avatar(info.name, info.avatar, 80), h('div.grow', h('h1', info.name), h('div.sub', [SOURCES[src].label, info.followers != null ? `${info.followers.toLocaleString()} followers` : null].filter(Boolean).join(' · ')), info.desc ? h('p.sub', { style: { marginTop: '6px', maxWidth: '640px' } }, info.desc.slice(0, 280)) : null), folB, info.url ? h('button.iconbtn', { title: 'Open page', onclick: () => window.wt.openExternal(info.url) }, icon('ext', 18)) : null));
  async function load() {
    try { const l = await sources.creatorVideos(src, cid, page); if (!alive) return; if (!page) clear(grid); l.forEach((v, i) => grid.append(card(v, i))); clear(more); if (l.length >= 15) more.append(h('button.btn', { onclick: () => { page++; load(); } }, 'Load more')); if (!page && !l.length) clear(grid).append(h('div.empty', 'No videos found.')); }
    catch (e) { clear(grid).append(h('div.empty', h('h2', 'Couldn’t load videos'), h('p', e.message))); }
  }
  load();
  return () => { alive = false; };
}
