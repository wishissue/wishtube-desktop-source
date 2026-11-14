import { h, clear, toast, linkify, fmtDur, fmtViews, fmtAgo } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { sources } from '../sources/manager.js';
import { parseChapters, SOURCES } from '../core/models.js';
import { Player } from './player.js';
import { avatar, mini, go, watchPath, creatorPath, contextMenu, videoMenu } from './components.js';

const prefs = { volume: 1 };

export async function watch(root, { id }) {
  let alive = true, player = null, related = [], v = state.known.get(id);
  if (!v) { root.append(h('div.page', h('div.empty', h('h2', 'Video not found'), h('p', 'It may have expired from the cache. Search for it again.'), h('button.btn.pri', { onclick: () => go('/') }, 'Back home')))); return () => {}; }

  const side = h('div.side'), player$ = h('div'), info = h('div'), page = h('div.watch', h('div', player$, info), side);
  root.append(page);
  const refreshRelated = () => {
    const base = [...pool.videos, ...state.lib.history.slice(0, 80).map(x => x.video)].filter(x => state.settings.sources[x.source]);
    related = state.ranker.related(v, base, { follows: state.follows(), limit: 18 });
    clear(side).append(h('h2', 'Up next'), ...related.map((r, i) => mini(r.v, i, r.reasons[0])));
  };
  refreshRelated();

  const spinner = h('div.player', h('div.buffering', h('div.spin')));
  player$.append(spinner);

  // stream resolution
  let stream, desc = v.desc || '', chapters = [];
  try { stream = await sources.stream(v); } catch (e) {
    if (!alive) return () => {};
    clear(player$).append(h('div.player', h('div.perr', h('div', h('h2', 'Couldn’t load this video'), h('p.sub', e.message)), h('div.row', { style: { justifyContent: 'center' } }, h('button.btn.pri', { onclick: () => { location.reload(); } }, 'Retry'), h('button.btn', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 16), 'Open original')))));
    renderInfo(null); return () => { alive = false; };
  }
  if (!alive) return () => {};
  if (stream.dur && !v.dur) v.dur = stream.dur;
  desc = stream.desc || v.desc || '';
  chapters = stream.chapters?.length ? stream.chapters : parseChapters(desc);
  const resume = state.lib.resume[v.id], startAt = resume && v.dur && resume < v.dur * 0.95 ? resume : 0;

  player = new Player({ video: v, stream, chapters, startAt, prefs, onTheater: () => { page.classList.toggle('theater'); },
    onEnded: () => { if (state.settings.autoplay && related[0]) { toast(`Up next: ${related[0].v.title.slice(0, 50)}`); setTimeout(() => alive && go(watchPath(related[0].v)), 900); } } });
  player.addMediaSession(v, () => history.back(), () => related[0] && go(watchPath(related[0].v)));
  player.media.addEventListener('loadedmetadata', () => { if (!v.dur && isFinite(player.media.duration)) v.dur = player.media.duration; });
  clear(player$).append(player.el);
  player.el.focus({ preventScroll: true });
  const unmedia = window.wt.on('media', c => { if (c === 'toggle') player.toggle(); else if (c === 'next' && related[0]) go(watchPath(related[0].v)); else if (c === 'prev') history.back(); });
  const chapEls = [];
  player.onTick = t => { const i = chapters.findLastIndex(c => c.t <= t); chapEls.forEach((e, j) => e.classList.toggle('on', j === i)); };
  let lastSave = 0; const saver = setInterval(() => { const r = player.report(); if (r.seconds > 3 && Date.now() - lastSave > 4000) { lastSave = Date.now(); state.setResume(v.id, r.position); } }, 5000);
  renderInfo(stream);

  function renderInfo(st) {
    const liked = () => !!state.lib.liked[v.id], following = () => state.isFollowing(v);
    const likeB = h('button.btn', { class: liked() ? 'on' : '', onclick: () => { const on = state.toggleList('liked', v); likeB.classList.toggle('on', on); toast(on ? 'Liked. Your feed will lean this way.' : 'Like removed'); } }, icon('heart', 17), 'Like');
    const saveB = h('button.btn', { class: state.lib.saved[v.id] ? 'on' : '', onclick: () => { const on = state.toggleList('saved', v); saveB.classList.toggle('on', on); toast(on ? 'Saved' : 'Removed'); } }, icon('bookmark', 17), 'Save');
    const laterB = h('button.btn', { class: state.lib.later[v.id] ? 'on' : '', onclick: () => { const on = state.toggleList('later', v); laterB.classList.toggle('on', on); toast(on ? 'Added to Watch later' : 'Removed'); } }, icon('clock', 17), 'Later');
    const folB = h('button.btn', { class: following() ? 'on' : 'pri', onclick: async () => { const on = state.toggleFollow(v, creatorInfo); folB.className = 'btn' + (on ? ' on' : ' pri'); folB.lastChild.textContent = on ? 'Following' : 'Follow'; toast(on ? `Following ${v.creator}` : 'Unfollowed'); } }, icon(following() ? 'check' : 'plus', 16), following() ? 'Following' : 'Follow');
    let creatorInfo = {}; sources.creatorInfo(v.source, v.creatorId).then(i => { if (!alive || !i) return; creatorInfo = i; avatarHost.replaceChildren(avatar(v.creator, i.avatar, 42)); if (i.followers != null) subs.textContent = `${i.followers.toLocaleString()} followers`; });
    const avatarHost = h('div', avatar(v.creator, null, 42)), subs = h('div.sub', SOURCES[v.source].label);
    const dl = st?.download ? h('button.btn', { onclick: async () => { await window.wt.download({ url: st.download, title: v.title, videoId: v.id }); toast('Download started. See Downloads.'); } }, icon('download', 17), 'Download') : null;
    const lic = v.license?.name && v.license.name !== 'Check rights' ? h('span.pill' + (v.license.reuse === 'remix' ? '.ok' : ''), v.license.name) : null;
    const descEl = h('div.desc', { onclick: e => { if (e.target.tagName !== 'A') descEl.classList.add('open'); } }, `${[fmtViews(v.views), fmtAgo(v.date)].filter(Boolean).join(' · ')}\n\n`, ...linkify(desc || 'No description.', t => player?.seekTo(t)));
    clear(info).append(
      h('div.vtitle', v.title),
      h('div.row.wrap', h('a', { href: '#' + creatorPath(v), class: 'row' }, avatarHost, h('div', h('b', v.creator), subs)), folB, h('div.grow'), lic),
      h('div.actions', likeB, saveB, laterB, dl, h('button.btn', { onclick: () => window.wt.openExternal(v.url) }, icon('ext', 17), 'Original'),
        h('button.btn', { title: 'More', onclick: e => { const r = e.currentTarget.getBoundingClientRect(); contextMenu(r.left, r.bottom + 4, videoMenu(v, () => { refreshRelated(); })); } }, icon('more', 17))),
      descEl,
      chapters.length ? h('div.chapters', h('h2', { style: { margin: '14px 0 4px' } }, 'Chapters'), ...chapters.map(c => { const b = h('button.chapter', { onclick: () => player?.seekTo(c.t) }, h('span.t', fmtDur(c.t)), c.title); chapEls.push(b); return b; })) : null);
  }

  return () => {
    alive = false; clearInterval(saver); unmedia?.();
    if (!player) return;
    const r = player.report(); player.destroy();
    if (r.seconds >= 1) {
      state.ranker.record(v, 'watch', { completion: r.completion, seconds: r.seconds });
      state.addHistory(v, r.position, r.duration || v.dur);
      if (r.completion > 0.95) delete state.lib.resume[v.id];
      state.saveProfile();
    }
  };
}
