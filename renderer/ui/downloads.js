import { h, clear, fmtBytes, fmtDur, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';

const BUSY = ['active', 'merging', 'verifying'];
const STATE = { queued: 'Waiting…', active: 'Downloading', merging: 'Merging audio + video…', verifying: 'Checking the file…', paused: 'Paused', done: 'Finished', error: 'Failed', cancelled: 'Cancelled' };
const FORMAT = { best: '', mp4: 'MP4', webm: 'WebM', mkv: 'MKV', mp3: 'MP3', m4a: 'M4A', opus: 'Opus' };

/** The row for one download: progress, speed, ETA, quality, destination and every control that makes sense for its state. */
function row(d, caps) {
  const pct = d.state === 'done' ? 100 : Math.round((d.progress || 0) * 100), busy = BUSY.includes(d.state) || d.state === 'queued';
  const stats = d.state === 'active' ? [d.total ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : fmtBytes(d.received || 0), d.speed > 0 ? fmtBytes(d.speed) + '/s' : null, d.eta ? fmtDur(d.eta) + ' left' : null]
    : d.state === 'done' ? [fmtBytes(d.received), d.streams && [d.streams.video, d.streams.audio].filter(Boolean).join(' + ')] : d.state === 'paused' ? [fmtBytes(d.received || 0) + ' saved'] : [];
  const btn = (ic, label, fn, cls = '') => h('button.btn.sm' + cls, { title: label, onclick: async e => { e.preventDefault(); await fn(); } }, icon(ic, 15), label);
  const ib = (ic, label, fn) => h('button.iconbtn', { title: label, 'aria-label': label, onclick: fn }, icon(ic, 17));
  return h('div.item.dl' + (' s-' + d.state), { dataset: { id: d.id } },
    h('div.dlthumb', d.thumb ? h('img', { src: d.thumb, alt: '', onerror: e => e.target.remove() }) : icon('download', 22)),
    h('div.grow',
      h('div.title', d.title),
      h('div.row.wrap.dlmeta', d.creator ? h('span.sub', d.creator) : null, h('span.pill', [d.quality, FORMAT[d.format]].filter(Boolean).join(' · ') || 'Original'),
        d.verified ? h('span.pill.ok', { title: 'Checked with ffprobe: the file has the streams it should' }, 'Verified') : null, h('span.sub.st', STATE[d.state] || d.state)),
      busy || d.state === 'paused' ? h('div.row', { style: { marginTop: '8px' } }, h('div.bar2' + (d.state === 'merging' || d.state === 'verifying' || (d.state === 'active' && !d.progress) ? '.indet' : ''), h('i', { style: { width: pct + '%' } })), h('span.sub.pct', pct + '%')) : null,
      stats.filter(Boolean).length ? h('div.sub.dlstats', stats.filter(Boolean).join(' · ')) : null,
      d.error ? h('div.sub.dlerr', d.error) : null,
      d.file ? h('div.sub.dldest', { title: d.file }, d.file) : null),
    h('div.row.dlbtns',
      d.state === 'active' && d.canPause ? btn('pause', 'Pause', () => window.wt.dl.pause(d.id)) : null,
      d.state === 'paused' ? btn('play', 'Resume', () => window.wt.dl.resume(d.id)) : null,
      busy || d.state === 'paused' ? btn('x', 'Cancel', () => window.wt.dl.cancel(d.id), '.danger') : null,
      d.state === 'error' || d.state === 'cancelled' ? btn('refresh', 'Retry', () => window.wt.dl.retry(d.id)) : null,
      d.state === 'done' ? btn('play', 'Open', () => window.wt.dl.open(d.file)) : null,
      d.state === 'done' ? btn('folder', 'Show', () => window.wt.dl.reveal(d.file)) : null,
      !busy ? ib('trash', 'Remove from list', () => window.wt.dl.remove(d.id)) : null));
}

export function downloads(root) {
  const list = h('div.list'), items = new Map(), banner = h('div'); let caps = null, off = null;
  const draw = () => {
    clear(list); const all = [...items.values()].sort((a, b) => b.created - a.created);
    if (!all.length) return list.append(h('div.empty', h('h2', 'No downloads yet'), h('p', 'Open a video and press the download button. Pick the quality and format you want.')));
    const act = all.filter(d => !['done', 'error', 'cancelled'].includes(d.state)), past = all.filter(d => ['done', 'error', 'cancelled'].includes(d.state));
    if (act.length) list.append(h('h2.dlh', `In progress (${act.length})`), ...act.map(d => row(d, caps)));
    if (past.length) list.append(h('h2.dlh', 'History'), ...past.map(d => row(d, caps)));
  };
  const patch = d => {                          // update one row in place so buttons never flicker under the cursor
    const had = items.get(d.id), old = list.querySelector(`.item[data-id="${d.id}"]`); items.set(d.id, d);
    if (!had || !old || had.state !== d.state || had.error !== d.error || had.canPause !== d.canPause) return draw();
    old.querySelector('.bar2 i')?.style.setProperty('width', Math.round(d.state === 'done' ? 100 : (d.progress || 0) * 100) + '%');
    const pc = old.querySelector('.pct'); if (pc) pc.textContent = Math.round((d.progress || 0) * 100) + '%';
    const st = old.querySelector('.dlstats'); if (st) st.textContent = [d.total ? `${fmtBytes(d.received)} of ${fmtBytes(d.total)}` : fmtBytes(d.received || 0), d.speed > 0 ? fmtBytes(d.speed) + '/s' : null, d.eta ? fmtDur(d.eta) + ' left' : null].filter(Boolean).join(' · ');
  };
  (async () => {
    caps = await window.wt.dl.caps(); (await window.wt.dl.list()).forEach(d => items.set(d.id, d)); draw();
    if (!caps.ffmpeg) banner.append(h('div.banner', { style: { borderRadius: 'var(--r)', marginBottom: '14px' } }, icon('download', 16), 'FFmpeg wasn’t found, so separate audio/video streams can’t be merged and MP3/M4A/Opus extraction is unavailable. Direct video downloads still work.'));
  })();
  off = window.wt.on('dl:update', patch);
  const dir = state.settings.downloadDir;
  root.append(h('div.page', { style: { maxWidth: '920px' } },
    h('div.row.wrap', { style: { marginBottom: '16px' } }, h('h1', 'Downloads'), h('div.grow'),
      h('span.sub', { title: dir || '' }, 'Saving to ' + (dir || 'Videos/WishTube')),
      h('button.btn.sm', { onclick: async () => { const d = await window.wt.pickDir(); if (d) { state.settings.downloadDir = d; state.saveSettings(); toast('Download folder changed'); location.reload(); } } }, icon('folder', 15), 'Change'),
      h('button.btn.sm', { onclick: () => { window.wt.dl.clear(); [...items].forEach(([k, v]) => ['done', 'error', 'cancelled'].includes(v.state) && items.delete(k)); draw(); } }, icon('trash', 15), 'Clear finished')),
    banner, list));
  return () => off?.();
}

/** Quality + format picker. Only offers what the provider's streams really contain. */
export async function downloadDialog(v, stream) {
  const overlay = document.getElementById('overlay'), caps = await window.wt.dl.caps();
  let opts = (stream.options || []).filter(o => o.url);
  const needs = o => o.kind !== 'muxed' && !caps.ffmpeg;
  opts = [...opts].sort((a, b) => (b.height || 0) - (a.height || 0));
  const close = () => clear(overlay);
  const go = async (option, format) => {
    const r = await window.wt.dl.start({ videoId: v.id, title: v.title, creator: v.creator, thumb: v.thumb, dur: v.dur || stream.dur || 0, option, format });
    if (r?.error) return toast('Couldn’t start: ' + r.error, 4000);
    close(); toast('Download started. Open Downloads to follow it.');
  };
  const vid = opts.map(o => {
    const label = o.height ? o.height + 'p' : 'Original quality', ext = (o.ext || 'mp4').toUpperCase(), size = o.size ? fmtBytes(o.size) : null;
    return h('button.dlopt', { disabled: needs(o), title: needs(o) ? 'Needs FFmpeg' : '', onclick: () => go(o, 'best') }, h('b', label), h('span.sub', [o.kind === 'hls' ? 'MP4 (from stream)' : ext, size].filter(Boolean).join(' · ')), icon('download', 16));
  });
  // Audio is extracted from the smallest source that has sound.
  const src = [...opts].filter(o => !needs(o)).sort((a, b) => (a.height || 9e9) - (b.height || 9e9))[0];
  const aud = [['mp3', 'MP3', 'Plays everywhere'], ['m4a', 'M4A (AAC)', 'Best quality per size'], ['opus', 'Opus', 'Smallest files']].map(([f, n, d]) =>
    h('button.dlopt', { disabled: !src || !caps.ffmpeg, title: !caps.ffmpeg ? 'Needs FFmpeg' : '', onclick: () => go(src, f) }, h('b', n), h('span.sub', d), icon('music', 16)));
  clear(overlay).append(h('div.dlg', { role: 'dialog', 'aria-label': 'Download', onclick: e => e.stopPropagation() },
    h('div.row', h('h2.grow', 'Download'), h('button.iconbtn', { title: 'Close', onclick: close }, icon('x', 18))),
    h('p.sub.clip', v.title),
    opts.length ? h('div', h('h3', 'Video'), h('div.dlopts', vid), h('h3', 'Audio only'), h('div.dlopts', aud)) : h('div.empty', { style: { padding: '30px 0' } }, h('p', 'This provider doesn’t offer a download for this video.')),
    h('p.sub', { style: { marginTop: '12px' } }, 'Only download what you have the right to keep. Check the licence shown on the video page.')));
  overlay.onclick = close; overlay.querySelector('.dlopt:not([disabled])')?.focus();
}
