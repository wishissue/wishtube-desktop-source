import { h, clear, toast, fmtDur } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { audio } from '../core/audio.js';
import { isMusic } from '../core/models.js';
import { thumb, watchPath, creatorPath, go } from './components.js';

/** Play a list: music/audio goes to the audio queue (keeps playing while you browse); videos go to the video queue and open the player. */
export function playItems(items, { shuffle = false, start = 0 } = {}) {
  if (!items.length) return;
  if (items.every(v => isMusic(v) || v.audio)) { audio.q.setShuffle(shuffle); audio.playList(items, shuffle ? Math.floor(Math.random() * items.length) : start); return; }
  state.vq.load(items, shuffle ? Math.floor(Math.random() * items.length) : start); state.vq.setShuffle(shuffle); go(watchPath(state.vq.current));
}

export function addToPlaylistDialog(v) {
  const overlay = document.getElementById('overlay'), close = () => clear(overlay), list = h('div.dlopts'), input = h('input.input', { placeholder: 'New playlist name', maxlength: 80, style: { flex: 1 } });
  const draw = () => {
    clear(list); const pls = Object.values(state.lib.playlists).sort((a, b) => b.created - a.created);
    if (!pls.length) list.append(h('p.sub', 'No playlists yet. Create your first one below.'));
    list.append(...pls.map(p => { const has = p.items.some(x => x.id === v.id);
      return h('button.dlopt', { onclick: () => { if (has) state.removeFromPlaylist(p.id, v.id); else state.addToPlaylist(p.id, v); toast(has ? 'Removed from ' + p.name : 'Added to ' + p.name); draw(); } }, h('b', p.name), h('span.sub', p.items.length + ' item' + (p.items.length === 1 ? '' : 's')), icon(has ? 'check' : 'plus', 16)); }));
  };
  const create = () => { const n = input.value.trim(); if (!n) return input.focus(); const id = state.createPlaylist(n); state.addToPlaylist(id, v); toast('Added to ' + n); input.value = ''; draw(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  clear(overlay).append(h('div.dlg', { role: 'dialog', 'aria-label': 'Add to playlist', onclick: e => e.stopPropagation() },
    h('div.row', h('h2.grow', 'Add to playlist'), h('button.iconbtn', { title: 'Close', onclick: close }, icon('x', 18))), h('p.sub.clip', v.title), list,
    h('div.row', { style: { marginTop: '14px' } }, input, h('button.btn.pri', { onclick: create }, icon('plus', 15), 'Create'))));
  overlay.onclick = close; draw(); input.focus();
}

export function playlistsTab(body, redraw) {
  const pls = Object.values(state.lib.playlists).sort((a, b) => b.created - a.created);
  const nameIn = h('input.input', { placeholder: 'New playlist name', maxlength: 80 });
  const make = () => { if (nameIn.value.trim()) { state.createPlaylist(nameIn.value); redraw(); } else nameIn.focus(); };
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') make(); });
  body.append(h('div.row.wrap', { style: { marginBottom: '16px' } }, nameIn, h('button.btn.pri', { onclick: make }, icon('plus', 15), 'New playlist')));
  if (!pls.length) return body.append(h('div.empty', h('h2', 'No playlists yet'), h('p', 'Create one here, or use “Add to playlist” on any video or track.')));
  body.append(h('div.grid.plgrid', ...pls.map(p => h('a.card.pl', { href: '#/playlist/' + p.id },
    h('div.thumb', p.items[0]?.thumb ? h('img.ld', { src: p.items[0].thumb, alt: '' }) : h('div.plempty', icon('queue', 34)), h('span.tag.dur', p.items.length + ' item' + (p.items.length === 1 ? '' : 's'))),
    h('div.meta', h('div.grow', h('div.title', p.name), h('div.sub', p.items.length ? p.items.slice(0, 2).map(x => x.title).join(' · ') : 'Empty')))))));
}

export function playlistPage(root, { id }) {
  const body = h('div'); let dragFrom = -1;
  const draw = () => {
    const p = state.lib.playlists[id]; clear(body);
    if (!p) return body.append(h('div.empty', h('h2', 'Playlist not found'), h('a.btn', { href: '#/library/playlists' }, 'Back to playlists')));
    const total = p.items.reduce((s, v) => s + (v.dur || 0), 0);
    body.append(h('div.row.wrap', { style: { marginBottom: '18px', gap: '12px' } },
      h('div.grow', h('h1', { contentEditable: 'plaintext-only', spellcheck: 'false', title: 'Click to rename', onblur: e => state.renamePlaylist(id, e.target.textContent), onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } } }, p.name),
        h('div.sub', `${p.items.length} item${p.items.length === 1 ? '' : 's'}${total ? ' · ' + fmtDur(total) : ''}`)),
      h('button.btn.pri', { disabled: !p.items.length, onclick: () => playItems(p.items) }, icon('play', 15), 'Play all'),
      h('button.btn', { disabled: !p.items.length, onclick: () => playItems(p.items, { shuffle: true }) }, icon('shuffle', 15), 'Shuffle'),
      h('button.btn', { disabled: !p.items.length, onclick: () => { audio.addMany(p.items); toast('Added to queue'); } }, icon('queue', 15), 'Queue'),
      h('button.btn.danger', { onclick: () => { if (confirm(`Delete “${p.name}”? The videos themselves are not affected.`)) { state.deletePlaylist(id); go('/library/playlists'); } } }, icon('trash', 15), 'Delete')));
    if (!p.items.length) return body.append(h('div.empty', h('h2', 'This playlist is empty'), h('p', 'Open the ⋯ menu on any video and choose “Add to playlist”.')));
    body.append(h('div.list', ...p.items.map((v, i) => h('div.item.plrow', { draggable: 'true', style: { animationDelay: Math.min(i, 12) * 25 + 'ms' },
      ondragstart: e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; }, ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: e => e.currentTarget.classList.remove('over'),
      ondrop: e => { e.preventDefault(); if (dragFrom >= 0) { state.movePlaylistItem(id, dragFrom, i); dragFrom = -1; } } },
      h('span.grip', { title: 'Drag to reorder' }, icon('grip', 16)), h('span.sub.mono', { style: { width: '24px', textAlign: 'right' } }, i + 1),
      h('a', { href: '#' + watchPath(v), style: { width: '150px', flex: 'none' } }, thumb(v)),
      h('div.grow', h('a.title', { href: '#' + watchPath(v) }, v.title), h('div.sub', h('a', { href: '#' + creatorPath(v) }, v.creator))),
      h('button.iconbtn', { title: 'Play from here', 'aria-label': 'Play from here', onclick: () => playItems(p.items, { start: i }) }, icon('play', 17)),
      h('button.iconbtn', { title: 'Add to queue', 'aria-label': 'Add to queue', onclick: () => { audio.add(v); toast('Added to queue'); } }, icon('queue', 17)),
      h('button.iconbtn', { title: 'Remove from playlist', 'aria-label': 'Remove from playlist', onclick: () => state.removeFromPlaylist(id, v.id) }, icon('x', 17))))));
  };
  root.append(h('div.page', { style: { maxWidth: '980px' } }, h('a.sub', { href: '#/library/playlists', style: { display: 'inline-flex', gap: '4px', alignItems: 'center', marginBottom: '8px' } }, icon('back', 14), 'Playlists'), body)); draw();
  return state.bus.on('library', draw);
}
