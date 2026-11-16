import { h, clear, toast, fmtDur } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { audio } from '../core/audio.js';
import { sources } from '../sources/manager.js';
import { SOURCES, isMusic } from '../core/models.js';
import { avatar, watchPath, creatorPath, contextMenu, videoMenu, skeletons } from './components.js';
import { rankMusic } from '../rec/musicrank.js';
import { terminal } from './terminal.js';
import { friendly } from '../core/net.js';
import { addToPlaylistDialog } from './playlists.js';

/** An Internet Archive audio item is a release: it has a real tracklist, so it opens as an album. Nothing else is called an album. */
const isAlbum = v => !!v.audio && v.source === 'archive';
const albumPath = v => '/album/' + encodeURIComponent(v.id);
const dedupe = l => { const seen = new Set(); return l.filter(v => { const k = v.id; if (seen.has(k)) return false; seen.add(k); return !state.hidden().videos.has(v.id) && !state.hidden().creators.has(`${v.source}:${v.creatorId}`); }); };

function trackRow(v, list, i) {
  const now = audio.current?.id === v.id;
  return h('div.trow' + (now ? '.now' : ''), { dataset: { id: v.id }, oncontextmenu: e => { e.preventDefault(); contextMenu(e.clientX, e.clientY, videoMenu(v)); }, ondblclick: () => isAlbum(v) ? (location.hash = '#' + albumPath(v)) : audio.playList(list, i) },
    h('button.tplay', { title: isAlbum(v) ? 'Play album' : 'Play', 'aria-label': 'Play ' + v.title, onclick: () => isAlbum(v) ? audio.playNow(v) : audio.playList(list, i) }, v.thumb ? h('img.ld', { src: v.thumb, alt: '', loading: 'lazy', onload: e => e.target.classList.add('ld') }) : icon('music', 20), h('span.po', icon('play', 18))),
    h('div.grow.tmeta', h('a.title', { href: '#' + (isAlbum(v) ? albumPath(v) : watchPath(v)), title: v.title }, v.title), h('div.sub', h('a', { href: '#' + creatorPath(v) }, v.creator || 'Unknown'), ' · ', SOURCES[v.source]?.label, isAlbum(v) ? ' · Release' : '')),
    v.dur ? h('span.sub.mono', fmtDur(v.dur)) : null,
    h('button.iconbtn', { title: 'Add to queue', 'aria-label': 'Add to queue', onclick: () => { audio.add(v); toast('Added to queue'); } }, icon('queue', 17)),
    h('button.iconbtn', { title: 'Add to playlist', 'aria-label': 'Add to playlist', onclick: () => addToPlaylistDialog(v) }, icon('listplus', 17)));
}

const newSeed = () => Math.floor(Math.random() * 2 ** 31);
export function music(root) {
  let tab = 'discover', q = '', page = 0, items = [], busy = false, alive = true, done = false, seq = 0, sort = state.settings.musicSort || 'popular', term = null, seed = newSeed(), base = Math.floor(Math.random() * 3);
  const body = h('div'), tabs = h('div.chips'), sorts = h('div.chips'), more = h('div', { style: { textAlign: 'center', margin: '18px' } });
  const input = h('input.input', { placeholder: 'Search music: artist, track, album…', 'aria-label': 'Search music', style: { flex: 1, maxWidth: '520px' }, onkeydown: e => { if (e.key === 'Enter') { q = input.value.trim(); load(true); } } });
  const TABS = [['discover', 'Tracks'], ['albums', 'Albums & releases'], ['artists', 'Artists']];
  const SORTS = [['popular', 'Most listened'], ['trending', 'Trending'], ['new', 'Newest']];
  const stopTerm = () => { term?.stop(); term = null; };

  /** Every provider is asked for its most-popular-first list; results are ranked by popularity within each provider, then interleaved. */
  async function load(reset) {
    if (busy && !reset) return; busy = true; const my = ++seq;
    if (reset) { page = 0; items = []; done = false; } else page++;
    if (reset) seed = newSeed(); if (reset && !q) base = Math.floor(Math.random() * 3);
    const start = reset ? 0 : items.length, t0 = Date.now();
    stopTerm(); term = terminal({ scopes: ['music'], since: t0 - 200, title: q ? `WishTube · searching music for “${q.slice(0, 30)}”` : 'WishTube · loading music', className: 'big', max: 12, headline: () => 'Loading' });
    draw();
    try {
      await sources.music(q, page + (q ? 0 : base), (_id, l) => {
        if (!alive || my !== seq) return;
        const had = new Set(items.map(x => x.id)), fresh = dedupe(l).filter(x => !had.has(x.id));
        items = [...items.slice(0, start), ...rankMusic([...items.slice(start), ...fresh], { sort, query: q, seed })]; draw();
      }, { sort });
      if (!alive || my !== seq) return;
      if (items.length === start) done = true;
    } catch (e) { toast('Music failed to load: ' + friendly(e)); }
    if (my !== seq) return;
    busy = false; stopTerm(); draw();
  }
  function draw() {
    clear(tabs).append(...TABS.map(([k, l]) => h('button.chip', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(); } }, l)));
    clear(sorts).append(...SORTS.map(([k, l]) => h('button.chip', { class: k === sort ? 'on' : '', title: k === 'popular' ? 'Most viewed / downloaded first' : k === 'trending' ? 'What people are playing right now' : 'Latest uploads', onclick: () => { if (sort === k) return; sort = k; state.settings.musicSort = k; state.saveSettings(); load(true); } }, l)),
      h('button.chip', { title: 'Pick a fresh mix', onclick: () => load(true) }, icon('refresh', 14), ' Shuffle'));
    clear(body); clear(more);
    const tracks = items.filter(v => !isAlbum(v)), albums = items.filter(isAlbum);
    if (busy && !items.length) return body.append(h('div.loadbox', term ? term.el : null));
    if (!items.length) return body.append(h('div.empty', h('h2', q ? 'No music found' : 'No music loaded'), h('p', q ? 'Try different words. Music comes from PeerTube’s Music category, Odysee music tags and Internet Archive audio, and only from sources you have switched on.' : 'Check your connection or the sources in Settings.'), h('button.btn.pri', { onclick: () => load(true) }, 'Retry')), h('div.loadbox', staticLog({ scopes: ['music'], title: 'What happened' })));
    if (tab === 'discover') {
      body.append(h('div.row', { style: { marginBottom: '10px', gap: '8px' } }, h('button.btn.pri', { onclick: () => audio.playList(tracks) , disabled: !tracks.length }, icon('play', 15), 'Play all'),
        h('button.btn', { disabled: !tracks.length, onclick: () => { audio.q.setShuffle(true); audio.playList(tracks, Math.floor(Math.random() * tracks.length)); } }, icon('shuffle', 15), 'Shuffle'), h('button.btn', { disabled: !tracks.length, onclick: () => { audio.addMany(tracks); toast('Added ' + tracks.length + ' to queue'); } }, icon('queue', 15), 'Queue all')));
      body.append(h('div.tlist', ...tracks.map((v, i) => trackRow(v, tracks, i))));
      if (!tracks.length) body.append(h('p.sub', 'Only releases were found. See “Albums & releases”.'));
    } else if (tab === 'albums') {
      body.append(albums.length ? h('div.grid.plgrid', ...albums.map((v, i) => h('a.card', { href: '#' + albumPath(v), style: { '--i': Math.min(i, 14) } },
        h('div.thumb', v.thumb ? h('img.ld', { src: v.thumb, alt: '', loading: 'lazy' }) : h('div.plempty', icon('disc', 40)), h('span.tag.dur', 'Release')), h('div.meta', h('div.grow', h('div.title', v.title), h('div.sub', v.creator)))))) : h('div.empty', h('p', 'No releases in these results. Releases come from Internet Archive audio, which is the one source here that exposes real tracklists.')));
    } else {
      const by = new Map(); for (const v of items) { const k = v.source + ':' + v.creatorId; (by.get(k) || by.set(k, { v, n: 0 }).get(k)).n++; }
      const arts = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 60);
      body.append(h('p.sub', { style: { marginBottom: '14px' } }, 'Uploaders and channels in these results. A provider doesn’t say whether a channel is the artist, so this is shown as uploaded, not guessed.'),
        h('div.row.wrap', { style: { gap: '22px' } }, ...arts.map(({ v, n }) => h('a', { href: '#' + creatorPath(v), style: { textAlign: 'center', width: '110px' } }, avatar(v.creator, null, 72), h('div.title', { style: { marginTop: '8px', fontSize: '.92em', WebkitLineClamp: 2 } }, v.creator), h('div.sub', n + ' in results')))));
    }
    if (!done) more.append(h('button.btn', { disabled: busy, onclick: () => load(false) }, busy ? 'Loading more…' : 'Load more'));
  }
  root.append(h('div.page', h('div.row.wrap', { style: { gap: '14px', marginBottom: '8px' } }, h('h1', icon('music', 26), ' Music'), h('div.grow'), input), h('div.sticky.flow', h('div.row', tabs, h('div.grow'), sorts)), body, more));
  load(true);
  const off = audio.on('change', () => { root.querySelectorAll('.trow').forEach(r => r.classList.toggle('now', r.dataset.id === audio.current?.id)); });
  return () => { alive = false; stopTerm(); off(); };
}

export function album(root, { id }) {
  const v = state.known.get(id), body = h('div'); let alive = true;
  root.append(h('div.page', { style: { maxWidth: '980px' } }, h('a.sub', { href: '#/music', style: { display: 'inline-flex', gap: '4px', alignItems: 'center', marginBottom: '10px' } }, icon('back', 14), 'Music'), body));
  if (!v) { body.append(h('div.empty', h('h2', 'Album not found'), h('p', 'Open it from Music again.'))); return; }
  body.append(skeletons(3));
  sources.stream(v).then(st => {
    if (!alive) return; const tracks = (st.tracks || []).map((t, i) => ({ id: `${v.id}#${i}`, source: v.source, sid: v.sid, title: t.title, creator: t.artist || v.creator, creatorId: v.creatorId, thumb: v.thumb, dur: t.dur, url: v.url, directUrl: t.url, album: v.title, albumId: v.id, audio: true, music: true }));
    const total = tracks.reduce((s, t) => s + (t.dur || 0), 0);
    clear(body).append(h('div.row.wrap', { style: { gap: '22px', alignItems: 'flex-end', marginBottom: '20px' } },
      h('div.albumart', v.thumb ? h('img', { src: v.thumb, alt: '' }) : icon('disc', 70)),
      h('div.grow', h('div.sub', 'Release · ' + SOURCES[v.source].label), h('h1', v.title), h('div', h('a', { href: '#' + creatorPath(v) }, v.creator), h('span.sub', ` · ${tracks.length} tracks${total ? ' · ' + fmtDur(total) : ''}${v.license ? ' · ' + v.license : ''}`)),
        h('div.row.wrap', { style: { marginTop: '14px', gap: '8px' } }, h('button.btn.pri', { onclick: () => audio.playList(tracks) }, icon('play', 15), 'Play'), h('button.btn', { onclick: () => { audio.q.setShuffle(true); audio.playList(tracks, Math.floor(Math.random() * tracks.length)); } }, icon('shuffle', 15), 'Shuffle'),
          h('button.btn', { onclick: () => { audio.addMany(tracks); toast('Album added to queue'); } }, icon('queue', 15), 'Add to queue'), h('button.btn', { onclick: () => addToPlaylistDialog(v) }, icon('listplus', 15), 'Playlist'), h('button.btn', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 15), 'Original')))),
      h('div.tlist', ...tracks.map((t, i) => h('div.trow', { ondblclick: () => audio.playList(tracks, i) }, h('span.sub.mono', { style: { width: '26px', textAlign: 'right' } }, i + 1), h('button.iconbtn', { title: 'Play', 'aria-label': 'Play ' + t.title, onclick: () => audio.playList(tracks, i) }, icon('play', 17)),
        h('div.grow.tmeta', h('div.title', t.title), t.creator !== v.creator ? h('div.sub', t.creator) : null), t.dur ? h('span.sub.mono', fmtDur(t.dur)) : null, h('button.iconbtn', { title: 'Add to queue', 'aria-label': 'Add to queue', onclick: () => { audio.add(t); toast('Added to queue'); } }, icon('queue', 17))))));
  }).catch(e => clear(body).append(h('div.empty', h('h2', 'Couldn’t load this release'), h('p', e.message))));
  return () => { alive = false; };
}
