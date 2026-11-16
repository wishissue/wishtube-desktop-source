import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { sources } from '../sources/manager.js';
import { isShort, SOURCES } from '../core/models.js';
import { mixedOrder, viewPercentiles, titleScore } from '../rec/pick.js';
import { audio } from '../core/audio.js';
import { trace } from '../core/trace.js';
import { net, friendly } from '../core/net.js';
import { terminal } from './terminal.js';
import { avatar, creatorPath, watchPath } from './components.js';
import { addToPlaylistDialog } from './playlists.js';

const isHls = u => /\.m3u8(\?|$)/.test(u);
const AHEAD = 3, BEHIND = 1;          // slots kept alive around the current Short
const STALL_CURRENT = 5000, STALL_BG = 9000;

/**
 * Shorts: vertical player, one at a time. Only videos a provider marks as Shorts (tag, or reported portrait + short) are shown.
 *
 * Speed: instead of resolving one video at a time, a small ring of "slots" is kept around the current Short. The next one is fully
 * buffering in a hidden <video> while you watch, the one after has its stream resolved, so swiping is instant. A mirror that
 * doesn't answer is raced against the others rather than waited for, and every step is written to the live log shown on the Short.
 */
export function shorts(root) {
  let list = [], i = -1, alive = true, busy = false, page = 0, token = 0, started = 0, wheelAt = 0, exhausted = false, empties = 0, fails = 0, starting = false;
  const slots = new Map(), have = new Set(), muted = { v: state.settings.shortsMuted ?? false }, T = trace.scoped('shorts');
  const stage = h('div.sstage'), info = h('div.sinfo'), acts = h('div.sacts'), prog = h('div.sprog', h('i')), hint = h('div.shint'), counter = h('div.scount');
  let liveTerm = null, termTimer = null, loadTerm = null;

  /* ---------------- the list ---------------- */
  const poolShorts = () => pool.videos.filter(v => state.settings.sources[v.source] && isShort(v));
  /** Your taste still matters, but popular, good-looking Shorts lead (about 70% of the time) and the rest add discovery. A new order every session. */
  const sessionSeed = Math.floor(Math.random() * 2 ** 31);
  function pickShorts(ranked) {
    const pct = viewPercentiles(ranked), n = ranked.length, at = new Map(ranked.map((v, i) => [v.id, 1 - i / Math.max(1, n)]));
    const score = v => { const p = pct.get(v.id); return 0.35 * at.get(v.id) + 0.4 * (p ?? 0.45) + 0.15 * titleScore(v.title) + 0.1 * (v.thumb ? 1 : 0.2); };
    return mixedOrder(ranked, score, sessionSeed + have.size);
  }
  function addToList(items) {
    const ok = items.filter(v => isShort(v) && !have.has(v.id) && !state.hidden().videos.has(v.id) && !state.hidden().creators.has(`${v.source}:${v.creatorId}`));
    if (!ok.length) return 0;
    const ranked = pickShorts(state.ranker.rank(ok, { mode: 'foryou', follows: state.follows(), hidden: state.hidden(), seed: Math.floor(Math.random() * 1e6), limit: 80 }).map(r => r.v));
    for (const v of ranked) { have.add(v.id); list.push(v); }
    if (i >= 0) counter.textContent = `${i + 1} / ${list.length}${busy ? '+' : ''}`;
    return ranked.length;
  }
  async function fetchMore() {
    if (busy || exhausted) return; busy = true; const p = page++;
    try {
      let got = addToList(poolShorts());                                // instant: shorts already in the local pool
      await sources.shorts(p, (_id, l) => { got += addToList(l); kick(); });
      if (!got) { if (++empties >= 2) { exhausted = true; T.info('No more Shorts from your sources right now'); } } else empties = 0;
    } finally { busy = false; kick(); }
  }
  const kick = () => { if (!alive) return; if (i < 0 && list.length && !starting) { starting = true; show(0); } else if (i >= 0 && !exhausted && list.length - i <= AHEAD + 2) fetchMore(); };

  /* ---------------- slots: one hidden <video> per Short around the current one ---------------- */
  function slotFor(n, full) {
    let s = slots.get(n);
    if (!s) {
      const v = list[n]; if (!v) return null;
      const vid = h('video', { playsinline: true, preload: full ? 'auto' : 'metadata', loop: false });
      s = { n, v, vid, hls: null, st: null, urls: [], idx: 0, state: 'resolving', full: !!full, attached: false, created: Date.now(), scope: 'short:' + v.id, lazy: false, wd: null };
      slots.set(n, s); bindVideo(s);
      sources.stream(v, { scope: s.scope }).then(st => { s.st = st; s.urls = [...st.urls]; if (s.full || s.n === i) attach(s, 0); else s.state = 'resolved'; }, e => die(s, friendly(e)));
    } else if (full && !s.full) { s.full = true; s.vid.preload = 'auto'; if (s.st && !s.attached) attach(s, 0); }
    return s;
  }
  const slog = s => trace.scoped(s.scope);
  function attach(s, i0) {
    const url = s.urls[i0]; if (!url) return exhaustUrls(s);
    s.idx = i0; s.attached = true; s.state = 'loading'; s.tTry = Date.now(); clearTimeout(s.wd); s.hls?.destroy(); s.hls = null;
    slog(s).info(`Trying stream ${i0 + 1} of ${s.urls.length}: ${net.host(url)}${isHls(url) ? ' (HLS)' : ''}`);
    if (isHls(url) && window.Hls?.isSupported()) {
      const hls = s.hls = new window.Hls({ maxBufferLength: s.n === i ? 20 : 6, maxMaxBufferLength: 30, capLevelToPlayerSize: true, startLevel: -1, enableWorker: true, backBufferLength: 5 });
      hls.loadSource(url); hls.attachMedia(s.vid);
      hls.on(window.Hls.Events.MANIFEST_PARSED, (_e, d) => slog(s).ok(`Playlist ready (${d.levels.length} quality levels), fetching the first segment`));
      hls.once(window.Hls.Events.FRAG_LOADED, (_e, d) => slog(s).ok(`First segment received (${Math.round((d.frag.stats.loaded || 0) / 1024)} KB in ${Math.round(d.frag.stats.loading.end - d.frag.stats.loading.start)} ms)`));
      hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) next(s, `HLS error: ${d.details}`); });
    } else { s.vid.src = url; s.vid.load(); }
    s.wd = setTimeout(() => stalled(s), s.n === i ? STALL_CURRENT : STALL_BG);
  }
  /** No data in time: don't keep waiting. Race the remaining mirrors and move to the fastest. */
  async function stalled(s) {
    if (!alive || s.state === 'ready' || s.state === 'dead' || !slots.has(s.n)) return;
    const waited = Math.round((Date.now() - s.tTry) / 1000), rest = s.urls.slice(s.idx + 1);
    slog(s).warn(`${net.host(s.urls[s.idx])} sent no data for ${waited} s`);
    if (rest.length > 1) { const best = await net.race(rest, { scope: s.scope, timeout: 4000 }); if (!alive || !slots.has(s.n) || s.state === 'ready') return; s.urls = [...s.urls.slice(0, s.idx + 1), best, ...rest.filter(u => u !== best)]; }
    next(s, 'switching mirror');
  }
  async function next(s, why) {
    if (!alive || s.state === 'dead') return; slog(s).warn(why);
    if (s.idx + 1 < s.urls.length) return attach(s, s.idx + 1);
    exhaustUrls(s);
  }
  async function exhaustUrls(s) {
    if (s.st?.lazy && !s.lazy) {                                       // slow last-resort route (e.g. LBRY "get"), asked for only now
      s.lazy = true; slog(s).info('All direct mirrors failed — asking the network for another route');
      try { const more = await s.st.lazy(); if (more.length && alive && slots.has(s.n)) { s.urls.push(...more); return attach(s, s.urls.length - more.length); } } catch { /* fall through */ }
    }
    die(s, 'every mirror failed');
  }
  function die(s, why) {
    if (s.state === 'dead') return; s.state = 'dead'; clearTimeout(s.wd); slog(s).err(`Can't play this Short: ${why}`);
    if (s.n === i && alive) failed(why);
  }
  function disposeSlot(s) { clearTimeout(s.wd); s.hls?.destroy(); s.hls = null; s.vid.pause(); s.vid.removeAttribute('src'); try { s.vid.load(); } catch { /* ignore */ } s.vid.remove(); slots.delete(s.n); }
  function maintain(n) {
    for (let k = n + 1; k <= n + AHEAD; k++) if (list[k]) slotFor(k, k === n + 1 || k === n + 2);
    for (const s of [...slots.values()]) if (s.n < n - BEHIND || s.n > n + AHEAD) disposeSlot(s);
  }

  function bindVideo(s) {
    const vid = s.vid, cur = () => s.n === i;
    vid.addEventListener('play', () => { if (!cur()) vid.pause(); });         // a background slot must never start by itself when its data arrives
    vid.addEventListener('loadeddata', () => { if (s.state !== 'dead') { s.state = 'ready'; clearTimeout(s.wd); slog(s).ok(`Ready — ${net.host(s.urls[s.idx] || '')} gave the first frame in ${((Date.now() - (s.tTry || s.created)) / 1000).toFixed(1)} s`); } });
    vid.addEventListener('playing', () => { if (!cur()) return; hideTerm(); fails = 0; if (started) slog(s).ok(`Playing (${((Date.now() - started) / 1000).toFixed(1)} s after you got here)`); });
    vid.addEventListener('waiting', () => { if (cur() && !vid.paused) watchLoading(s); });
    vid.addEventListener('timeupdate', () => { if (cur() && vid.duration) prog.firstChild.style.width = (vid.currentTime / vid.duration * 100) + '%'; });
    vid.addEventListener('ended', () => { if (!cur()) return; if (state.settings.autoplay !== false) show(i + 1, 1); else { vid.currentTime = 0; vid.play(); } });
    vid.addEventListener('error', () => { if (!s.attached || s.state === 'dead') return; const c = vid.error; next(s, `${net.host(s.urls[s.idx] || '')}: ${c ? ['', 'aborted', 'network error', 'decode error', 'format not supported'][c.code] || 'media error' : 'media error'}`); });
    vid.addEventListener('click', () => toggle());
  }

  /* ---------------- showing one ---------------- */
  function hideTerm() { clearTimeout(termTimer); liveTerm?.stop(); liveTerm = null; stage.querySelector('.sload.live')?.remove(); }
  /** After a short grace period, show exactly what is happening for this Short. */
  function watchLoading(s) {
    hideTerm(); const my = token;
    termTimer = setTimeout(() => {
      if (!alive || my !== token || (!s.vid.paused && s.vid.readyState >= 3)) return;
      liveTerm = terminal({ scopes: [s.scope, 'shorts'], since: Math.max(s.created, Date.now() - 20000), title: 'WishTube · loading this Short', max: 7, className: 'over', headline: () => `Short ${i + 1}` });
      stage.append(h('div.sload.live', liveTerm.el));
    }, 350);
  }
  async function show(n, dir = 0) {
    if (n < 0 || !alive) return;
    if (n >= list.length) { await fetchMore(); if (n >= list.length) { toast('That’s all the Shorts for now'); return; } }
    leave(); i = n; const v = list[i], my = ++token; started = Date.now(); audio.pause(); starting = true;
    stage.classList.remove('up', 'down'); void stage.offsetWidth; if (dir) stage.classList.add(dir > 0 ? 'down' : 'up');
    drawInfo(v); prog.firstChild.style.width = '0%';
    const s = slotFor(n, true);
    for (const x of slots.values()) if (x !== s) { x.vid.autoplay = false; x.vid.pause(); }
    s.vid.autoplay = true;                                              // if the stream isn't attached yet, it starts by itself the moment data arrives
    stage.querySelectorAll('video').forEach(x => x !== s.vid && x.remove());
    if (!s.vid.isConnected) stage.insertBefore(s.vid, stage.firstChild);
    s.vid.muted = muted.v; s.vid.currentTime = 0;
    if (s.state === 'dead') return failed('it failed to load');
    if (s.state === 'ready') slog(s).ok('Already buffered while you were watching the previous one');
    s.vid.play().catch(() => {});
    if (s.attached) { clearTimeout(s.wd); s.wd = setTimeout(() => stalled(s), STALL_CURRENT); }
    watchLoading(s); maintain(n); kick();
    if (my !== token) return;
  }
  const failed = why => {
    hideTerm(); fails++;
    if (fails >= 6) { toast('Several Shorts in a row failed. Check your connection or try again.'); return; }
    toast('Skipping this Short' + (why ? ' — ' + why : '') + '.'); const my = token; setTimeout(() => alive && my === token && show(i + 1, 1), 500);
  };
  function leave() {                                                   // record what was watched
    const v = list[i], s = slots.get(i); if (!v || !started || !s) return; const secs = (Date.now() - started) / 1000, vid = s.vid;
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

  const curVid = () => slots.get(i)?.vid;
  const toggle = () => { const vid = curVid(); if (!vid) return; vid.paused ? vid.play() : vid.pause(); hint.textContent = vid.paused ? '❚❚' : '▶'; hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash'); };
  stage.addEventListener('click', e => { if (e.target === stage || e.target.classList.contains('sshade')) toggle(); });
  const mute = h('button.iconbtn.smute', { title: 'Mute (M)', 'aria-label': 'Mute', onclick: () => setMute(!muted.v) });
  const setMute = m => { muted.v = m; for (const s of slots.values()) s.vid.muted = m; state.settings.shortsMuted = m; state.saveSettings(); clear(mute).append(icon(m ? 'mute' : 'vol', 20)); }; setMute(muted.v);
  const fs = h('button.iconbtn.sfs', { title: 'Fullscreen (F)', 'aria-label': 'Fullscreen', onclick: () => document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen() }, icon('full', 20));

  const onKey = e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return; const k = e.key, vid = curVid();
    if (k === 'ArrowDown' || k === 'n' || k === 'N' || k === 'PageDown') { e.preventDefault(); show(i + 1, 1); }
    else if (k === 'ArrowUp' || k === 'p' || k === 'P' || k === 'PageUp') { e.preventDefault(); show(i - 1, -1); }
    else if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); toggle(); }
    else if (vid && (k === 'ArrowLeft' || k === 'j')) vid.currentTime = Math.max(0, vid.currentTime - 5); else if (vid && (k === 'ArrowRight' || k === 'l')) vid.currentTime += 5;
    else if (k === 'm' || k === 'M') setMute(!muted.v); else if (k === 'f' || k === 'F') fs.click();
  };
  addEventListener('keydown', onKey);
  const onWheel = e => { if (Date.now() - wheelAt < 650 || Math.abs(e.deltaY) < 20) return; wheelAt = Date.now(); show(i + (e.deltaY > 0 ? 1 : -1), e.deltaY > 0 ? 1 : -1); };
  stage.addEventListener('wheel', onWheel, { passive: true });

  stage.append(hint, h('div.sshade'), info, prog, h('div.stop', mute, fs));
  root.append(h('div.shorts', h('div.sframe', stage, acts), counter));

  /* ---------------- start ---------------- */
  const t0 = Date.now();
  loadTerm = terminal({ scopes: ['shorts', 'net'], since: t0 - 500, title: 'WishTube · finding Shorts', max: 9, className: 'over', headline: () => 'Looking for Shorts' });
  stage.append(h('div.sload.first', loadTerm.el));
  fetchMore().then(() => {
    loadTerm?.stop(); loadTerm = null; stage.querySelector('.sload.first')?.remove();
    if (!alive || list.length) return;
    root.firstChild.replaceChildren(h('div.empty', h('h2', 'No Shorts found'), h('p', 'WishTube only calls something a Short when the provider says so (a “shorts” tag, or portrait video the provider reports). Nothing qualified in your enabled sources right now.'), h('div.row', { style: { justifyContent: 'center', gap: '8px' } }, h('button.btn.pri', { onclick: () => dispatchEvent(new HashChangeEvent('hashchange')) }, 'Try again'), h('a.btn', { href: '#/settings' }, 'Sources')), h('div.loadbox', staticLog({ scopes: ['shorts'], since: t0 - 500, title: 'What happened' }))));
  });
  // the first Short appears as soon as ANY source answers (see kick()); drop the finder log at that moment
  const offFirst = trace.on(() => { if (i >= 0 && loadTerm) { loadTerm.stop(); loadTerm = null; stage.querySelector('.sload.first')?.remove(); } });

  return () => { alive = false; token++; leave(); hideTerm(); loadTerm?.stop(); offFirst(); for (const s of [...slots.values()]) disposeSlot(s); removeEventListener('keydown', onKey); };
}
