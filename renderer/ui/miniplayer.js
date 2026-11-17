import { h, clear, fmtDur } from './dom.js';
import { wavy } from './wavy.js';
import { catPanel } from './cats.js';
import { icon } from './icons.js';
import { audio } from '../core/audio.js';
import { watchPath, creatorPath, go } from './components.js';

/** The persistent bar at the bottom: shows whenever something is queued, on every page. */
export function mountMiniPlayer() {
  const art = h('div.mart'), title = h('a.mtitle'), sub = h('div.msub'), cur = h('span.mono', '0:00'), dur = h('span.mono', '0:00');
  const seek = h('input.mseek', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek', oninput: e => audio.seek((e.target.value / 1000) * (audio.el.duration || 0)) });
  const vol = h('input.mvol', { type: 'range', min: 0, max: 100, value: audio.el.volume * 100, 'aria-label': 'Volume', oninput: e => audio.setVolume(e.target.value / 100) });
  const mk = (ic, label, fn, cls = '') => h('button.iconbtn' + cls, { title: label, 'aria-label': label, onclick: fn }, icon(ic, 19));
  const bShuffle = mk('shuffle', 'Shuffle', () => audio.toggleShuffle()), bRepeat = mk('repeat', 'Repeat', () => audio.cycleRepeat());
  const bPlay = h('button.iconbtn.mplay', { title: 'Play / Pause', 'aria-label': 'Play or pause', onclick: () => audio.toggle() });
  const bar = h('footer', { id: 'mini', hidden: true, role: 'region', 'aria-label': 'Now playing' },
    h('div.minfo', art, h('div.mtxt', title, sub)),
    h('div.mctl', mk('prev', 'Previous', () => audio.prev()), bPlay, mk('skip', 'Next', () => audio.next())),
    h('div.mseekrow', cur, seek, dur),
    h('div.mextra', bShuffle, bRepeat, h('div.mvolbox', icon('vol', 17), vol), mk('queue', 'Queue', () => toggleQueue()), mk('x', 'Close player', () => audio.stop())));
  document.body.append(bar);
  const drawState = () => {
    const c = audio.current; bar.hidden = !c; document.documentElement.classList.toggle('mini-on', !!c);
    if (c) {
      const same = title.dataset.id === c.id; title.dataset.id = c.id;
      if (!same) { clear(art); if (c.thumb) art.append(h('img', { src: c.thumb, alt: '', onerror: e => e.target.remove() })); title.textContent = c.title; title.title = c.title; title.href = '#' + watchPath(c.albumId ? { id: c.albumId } : c); clear(sub).append(h('a', { href: '#' + creatorPath(c) }, c.creator || ''), c.album ? ' · ' + c.album : ''); }
    }
    clear(bPlay).append(audio.loading && audio.playing === false && !audio.failed ? wavy(20) : icon(audio.playing ? 'pause' : 'play', 20));
    bShuffle.classList.toggle('on', audio.q.shuffle); bRepeat.classList.toggle('on', audio.q.repeat !== 'off');
    clear(bRepeat).append(icon(audio.q.repeat === 'one' ? 'repeat1' : 'repeat', 19)); bRepeat.title = 'Repeat: ' + audio.q.repeat;
    bar.classList.toggle('loading', !!audio.loading); document.body.classList.toggle('audio-playing', audio.playing);
  };
  const tick = () => { const d = audio.el.duration, t = audio.el.currentTime; if (Number.isFinite(d) && d > 0) { seek.value = (t / d) * 1000; dur.textContent = fmtDur(d); seek.style.setProperty('--p', (t / d * 100) + '%'); } cur.textContent = fmtDur(t || 0); };
  audio.on('state', drawState); audio.on('change', () => { drawState(); drawQueue?.(); }); audio.on('tick', tick); drawState();
  window.wt.on('media', cmd => { if (!audio.active || document.querySelector('.player video')) return; ({ toggle: () => audio.toggle(), next: () => audio.next(), prev: () => audio.prev() })[cmd]?.(); });

  /* ---- queue drawer: reorder by dragging, click to jump, remove, clear ---- */
  let drawer = null, drawQueue = null;
  function toggleQueue() {
    if (drawer) { drawer.remove(); drawer = null; drawQueue = null; return; }
    const list = h('div.qlist', { role: 'list' });
    drawer = h('aside', { id: 'qdrawer', role: 'dialog', 'aria-label': 'Queue' },
      h('div.row', h('h2.grow', 'Queue'), h('span.sub', { id: 'qcount' }), h('button.btn.sm', { onclick: () => audio.clear() }, 'Clear'), h('button.iconbtn', { title: 'Close', onclick: toggleQueue }, icon('x', 18))), list);
    document.body.append(drawer); let dragFrom = -1;
    drawQueue = () => {
      clear(list); const q = audio.q; drawer.querySelector('#qcount').textContent = q.length + (q.length === 1 ? ' track' : ' tracks');
      if (!q.length) return list.append(catPanel('emptylist', { size: 'sm', title: 'The queue is empty', text: 'Use “Add to queue” on any video or track.' }));
      q.items.forEach((it, i) => list.append(h('div.qitem' + (i === q.index ? '.now' : ''), { draggable: 'true', role: 'listitem',
        ondragstart: e => { dragFrom = i; e.dataTransfer.effectAllowed = 'move'; }, ondragover: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, ondragleave: e => e.currentTarget.classList.remove('over'),
        ondrop: e => { e.preventDefault(); if (dragFrom >= 0) audio.move(dragFrom, i); dragFrom = -1; }, ondblclick: () => audio.jump(i) },
        h('span.grip', icon('grip', 16)), h('button.qplay', { title: 'Play', onclick: () => audio.jump(i) }, it.thumb ? h('img', { src: it.thumb, alt: '' }) : icon('music', 18), i === q.index ? h('i.eq', audio.playing ? { class: 'on' } : {}) : null),
        h('div.grow.qmeta', h('div.title', { title: it.title }, it.title), h('div.sub', it.creator || '')), it.dur ? h('span.sub.mono', fmtDur(it.dur)) : null,
        h('button.iconbtn', { title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => audio.move(i, i - 1) }, icon('up', 16)), h('button.iconbtn', { title: 'Move down', 'aria-label': 'Move down', disabled: i === q.length - 1, onclick: () => audio.move(i, i + 1) }, icon('down', 16)),
        h('button.iconbtn', { title: 'Remove', 'aria-label': 'Remove from queue', onclick: () => audio.remove(i) }, icon('x', 16)))));
    };
    drawQueue();
  }
  return { toggleQueue };
}
