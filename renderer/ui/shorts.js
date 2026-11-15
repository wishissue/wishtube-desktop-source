import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { sources } from '../sources/manager.js';
import { isShort, SOURCES } from '../core/models.js';
import { audio } from '../core/audio.js';
import { avatar, creatorPath, watchPath } from './components.js';
import { addToPlaylistDialog } from './playlists.js';

/** Shorts: vertical player, one at a time. Only videos a provider marks as Shorts (tag, or reported portrait + short) are shown. */
export function shorts(root) {
  let list = [], i = 0, alive = true, busy = false, page = 0, hls = null, token = 0, started = 0, wheelAt = 0;
  const vid = h('video', { playsinline: true, preload: 'auto', loop: false }), muted = { v: state.settings.shortsMuted ?? false };
  const stage = h('div.sstage'), info = h('div.sinfo'), acts = h('div.sacts'), prog = h('div.sprog', h('i')), spin = h('i.spin', { hidden: true }), hint = h('div.shint');
  const counter = h('div.scount');
  const key = v => (v ? v.id : '');

  async function fetchMore() {
    if (busy) return; busy = true;
    try {
      const fromPool = pool.videos.filter(v => state.settings.sources[v.source] && isShort(v));
      const fresh = await sources.shorts(page++).catch(() => []);
      const have = new Set(list.map(key)), all = [...fresh, ...fromPool].filter(v => isShort(v) && !have.has(v.id) && !state.hidden().videos.has(v.id));
      const ranked = state.ranker.rank(all, { mode: 'foryou', follows: state.follows(), hidden: state.hidden(), seed: Date.now() % 100000, limit: 60 }).map(r => r.v);
      const seen = new Set(); list.push(...ranked.filter(v => !seen.has(v.id) && seen.add(v.id)));
    } finally { busy = false; }
  }

  function destroyHls() { hls?.destroy(); hls = null; }
  async function show(n, dir = 0) {
    if (n < 0) return; if (n >= list.length) { await fetchMore(); if (n >= list.length) { toast('That’s all the Shorts for now'); return; } }
    leave(); i = n; const v = list[i], my = ++token; started = Date.now(); audio.pause();
    stage.classList.remove('up', 'down'); void stage.offsetWidth; if (dir) stage.classList.add(dir > 0 ? 'down' : 'up');
    spin.hidden = false; vid.removeAttribute('src'); destroyHls(); drawInfo(v);
    try {
      const st = await sources.stream(v); if (my !== token || !alive) return;
      const url = st.urls[0]; vid.muted = muted.v;
      if (/\.m3u8(\?|$)/.test(url) && window.Hls?.isSupported()) { hls = new window.Hls({ maxBufferLength: 20, enableWorker: true }); hls.loadSource(url); hls.attachMedia(vid); hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal && my === token) failed(); }); }
      else { vid.src = url; vid.onerror = () => my === token && (st.urls[1] ? (vid.src = st.urls[1], st.urls.shift()) : failed()); }
      await vid.play().catch(() => {});
    } catch { if (my === token) failed(); }
    prefetch(i + 1);
  }
  const failed = () => { spin.hidden = true; toast('This Short couldn’t be played. Skipping.'); setTimeout(() => alive && show(i + 1, 1), 600); };
  const prefetch = n => { const v = list[n]; if (v) sources.stream(v).catch(() => {}); };           // resolve the next stream early so swiping feels instant
  function leave() {                                           // record what was watched
    const v = list[i]; if (!v || !started) return; const secs = (Date.now() - started) / 1000;
    if (secs > 3) { const dur = vid.duration || v.dur || 0; state.ranker.record(v, 'watch', { completion: dur ? Math.min(1, vid.currentTime / dur) : 0, seconds: secs }); state.addHistory(v, vid.currentTime, dur); }
    started = 0;
  }

  function drawInfo(v) {
    clear(info).append(h('a.screator', { href: '#' + creatorPath(v) }, avatar(v.creator, null, 36), h('b', v.creator)),
      h('button.btn.sm' + (state.isFollowing(v) ? '' : '.pri'), { onclick: e => { const on = state.toggleFollow(v); e.currentTarget.textContent = on ? 'Following' : 'Follow'; e.currentTarget.classList.toggle('pri', !on); } }, state.isFollowing(v) ? 'Following' : 'Follow'),
      h('div.stitle', v.title), h('div.sub', SOURCES[v.source]?.label + (v.views != null ? ` · ${new Intl.NumberFormat(undefined, { notation: 'compact' }).format(v.views)} views` : '')));
    const act = (ic, label, fn, on) => h('button.sact' + (on ? '.on' : ''), { title: label, 'aria-label': label, onclick: fn }, icon(ic, 22), h('span', label));
    clear(acts).append(
      act('heart', state.lib.liked[v.id] ? 'Liked' : 'Like', e => { const on = state.toggleList('liked', v); e.currentTarget.classList.toggle('on', on); }, !!state.lib.liked[v.id]),
      act('bookmark', 'Save', e => { const on = state.toggleList('saved', v); e.currentTarget.classList.toggle('on', on); toast(on ? 'Saved' : 'Removed'); }, !!state.lib.saved[v.id]),
      act('listplus', 'Playlist', () => addToPlaylistDialog(v)),
      act('msg', 'Comments', () => { location.hash = '#' + watchPath(v); }),
      act('ext', 'Original', () => window.wt.openExternal(v.url)),
      h('div.snav', h('button.iconbtn', { title: 'Previous (↑ / P)', 'aria-label': 'Previous Short', disabled: i === 0, onclick: () => show(i - 1, -1) }, icon('up', 22)), h('button.iconbtn', { title: 'Next (↓ / N)', 'aria-label': 'Next Short', onclick: () => show(i + 1, 1) }, icon('down', 22))));
    counter.textContent = `${i + 1} / ${list.length}${busy ? '+' : ''}`;
  }

  vid.addEventListener('playing', () => { spin.hidden = true; });
  vid.addEventListener('waiting', () => { spin.hidden = false; });
  vid.addEventListener('timeupdate', () => { if (vid.duration) prog.firstChild.style.width = (vid.currentTime / vid.duration * 100) + '%'; });
  vid.addEventListener('ended', () => { if (state.settings.autoplay !== false) show(i + 1, 1); else { vid.currentTime = 0; vid.play(); } });
  const toggle = () => { vid.paused ? vid.play() : vid.pause(); hint.textContent = vid.paused ? '❚❚' : '▶'; hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash'); };
  stage.addEventListener('click', e => { if (!e.target.closest('button, a')) toggle(); });
  const mute = h('button.iconbtn.smute', { title: 'Mute (M)', 'aria-label': 'Mute', onclick: () => setMute(!vid.muted) });
  const setMute = m => { vid.muted = m; muted.v = m; state.settings.shortsMuted = m; state.saveSettings(); clear(mute).append(icon(m ? 'mute' : 'vol', 20)); }; setMute(muted.v);
  const fs = h('button.iconbtn.sfs', { title: 'Fullscreen (F)', 'aria-label': 'Fullscreen', onclick: () => document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen() }, icon('full', 20));

  const onKey = e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key;
    if (k === 'ArrowDown' || k === 'n' || k === 'N' || k === 'PageDown') { e.preventDefault(); show(i + 1, 1); }
    else if (k === 'ArrowUp' || k === 'p' || k === 'P' || k === 'PageUp') { e.preventDefault(); show(i - 1, -1); }
    else if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowLeft' || k === 'j') { vid.currentTime = Math.max(0, vid.currentTime - 5); } else if (k === 'ArrowRight' || k === 'l') { vid.currentTime += 5; }
    else if (k === 'm' || k === 'M') setMute(!vid.muted); else if (k === 'f' || k === 'F') fs.click();
  };
  addEventListener('keydown', onKey);
  const onWheel = e => { if (Date.now() - wheelAt < 650 || Math.abs(e.deltaY) < 20) return; wheelAt = Date.now(); show(i + (e.deltaY > 0 ? 1 : -1), e.deltaY > 0 ? 1 : -1); };
  stage.addEventListener('wheel', onWheel, { passive: true });

  stage.append(vid, spin, hint, h('div.sshade'), info, prog, h('div.stop', mute, fs));
  root.append(h('div.shorts', h('div.sframe', stage, acts), counter));
  (async () => {
    stage.append(h('div.sload', h('i.spin'), h('p.sub', 'Finding Shorts…'))); await fetchMore(); stage.querySelector('.sload')?.remove();
    if (!list.length) return root.firstChild.replaceChildren(h('div.empty', h('h2', 'No Shorts found'), h('p', 'WishTube only calls something a Short when the provider says so (a “shorts” tag, or portrait video the provider reports). Nothing qualified in your enabled sources right now.'), h('div.row', { style: { justifyContent: 'center', gap: '8px' } }, h('button.btn.pri', { onclick: () => { clear(root); shorts(root); } }, 'Try again'), h('a.btn', { href: '#/settings' }, 'Sources'))));
    show(0);
  })();
  return () => { alive = false; token++; leave(); destroyHls(); vid.pause(); vid.removeAttribute('src'); removeEventListener('keydown', onKey); };
}
