import { h, clear, fmtBytes } from './dom.js';
import { icon } from './icons.js';

export function downloads(root) {
  const list = h('div.list'), items = new Map();
  const row = d => { const pct = d.total ? d.received / d.total * 100 : 0;
    return h('div.item', h('div.grow', h('div.title', d.title), h('div.row', { style: { marginTop: '6px' } }, h('div.bar2', h('i', { style: { width: (d.state === 'done' ? 100 : pct) + '%' } })), h('span.sub', d.state === 'done' ? 'Done · ' + fmtBytes(d.received) : d.state === 'active' ? `${fmtBytes(d.received)}${d.total ? ' / ' + fmtBytes(d.total) : ''}` : d.state === 'error' ? 'Failed: ' + d.error : 'Cancelled'))),
      d.state === 'done' ? h('button.btn.sm', { onclick: () => window.wt.reveal(d.file) }, icon('folder', 15), 'Show') : d.state === 'active' ? h('button.btn.sm', { onclick: () => window.wt.cancelDownload(d.id) }, 'Cancel') : null); };
  const draw = () => { clear(list); const all = [...items.values()].reverse(); if (!all.length) list.append(h('div.empty', h('h2', 'No downloads'), h('p', 'Use the Download button on a video. Files go to your Videos/WishTube folder.'))); else list.append(...all.map(row)); };
  window.wt.downloads().then(l => { l.forEach(d => items.set(d.id, d)); draw(); });
  const off = window.wt.on('dl:update', d => { items.set(d.id, d); draw(); });
  root.append(h('div.page', { style: { maxWidth: '860px' } }, h('h1', { style: { marginBottom: '16px' } }, 'Downloads'), list));
  return off;
}
