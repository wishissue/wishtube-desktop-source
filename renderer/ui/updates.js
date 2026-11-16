import { h, clear, toast, fmtBytes, fmtAgo } from './dom.js';
import { icon } from './icons.js';

/** Update checker UI. The main process checks GitHub once a day; this shows a small card when a new version exists
 *  and a simple "Updates" panel in Settings. */
const api = () => window.wt?.update;
let card = null;

function closeCard() { card?.remove(); card = null; }

/** Download + install with a progress bar inside the card. */
async function install(u, box) {
  const bar = h('i'), label = h('span', 'Starting download'), prog = h('div.upprog', h('div.upbar', bar), label);
  clear(box).append(h('b', `Updating to ${u.version}`), prog);
  const off = window.wt.on('update:progress', p => {
    const pct = p.total ? Math.min(100, p.got / p.total * 100) : 0; bar.style.width = pct + '%';
    label.textContent = p.done ? 'Installing' : p.total ? `${Math.round(pct)}% · ${fmtBytes(p.got)} of ${fmtBytes(p.total)}` : fmtBytes(p.got);
  });
  const r = await api().install(); off();
  if (r?.error) { clear(box).append(h('b', 'Update didn’t work'), h('span.sub', r.error), h('div.row', h('button.btn.sm', { onclick: () => api().page() }, 'Open release page'), h('button.btn.sm', { onclick: closeCard }, 'Close'))); return; }
  if (r?.revealed) { clear(box).append(h('b', 'Update downloaded'), h('span.sub', 'Open the new file to finish.'), h('button.btn.sm', { onclick: closeCard }, 'Done')); return; }
  clear(box).append(h('b', 'Restarting'), h('span.sub', 'WishTube will reopen in a moment.'));
}

function showCard(u) {
  closeCard();
  const box = h('div.upbox');
  const draw = () => clear(box).append(
    h('div.uphead', icon('download', 18), h('b', `WishTube ${u.version} is available`)),
    u.notes ? h('p.sub.upnotes', u.notes.replace(/[#*`>_-]+/g, '').split('\n').filter(l => l.trim()).slice(0, 3).join(' · ').slice(0, 180)) : null,
    h('div.row.upbtns',
      u.asset ? h('button.btn.pri.sm', { onclick: () => install(u, box) }, 'Update now') : h('button.btn.pri.sm', { onclick: () => api().page() }, 'Get it'),
      h('button.btn.sm', { onclick: closeCard }, 'Later'),
      h('button.btn.sm.link', { onclick: () => { api().skip(u.version); closeCard(); } }, 'Skip this version')));
  draw(); card = h('div.upcard', { role: 'dialog', 'aria-label': 'Update available' }, box); document.body.append(card);
}

/** Call once at start-up. */
export function initUpdates() {
  if (!api()) return;
  window.wt.on('update:available', showCard);
}

/** Settings > Updates */
export function updatesPanel() {
  const host = h('div.panel');
  if (!api()) return host;
  let st = null, busy = false, msg = '';
  const draw = () => {
    const u = st?.update;
    clear(host).append(h('h2', 'Updates'),
      h('div.field', h('div.grow', h('b', `WishTube ${st?.current || ''}`),
        h('span', msg || (u ? `Version ${u.version} is available.` : st?.lastCheck ? `You’re up to date. Last checked ${fmtAgo(st.lastCheck)}.` : 'Checks for new versions once a day.'))),
        u ? h('button.btn.pri', { onclick: () => showCard(u) }, 'Update') : h('button.btn', { disabled: busy, onclick: check }, busy ? 'Checking' : 'Check now')),
      h('div.field', h('div.grow', h('b', 'Check every day'), h('span', 'Looks for new versions automatically.')),
        (() => { const el = h('button.switch', { type: 'button', role: 'switch', 'aria-label': 'Check every day', 'aria-checked': String(!!st?.auto), class: st?.auto ? 'on' : '', onclick: async () => { st.auto = !st.auto; await api().auto(st.auto); draw(); } }); return el; })()));
  };
  const check = async () => { busy = true; msg = ''; draw(); const r = await api().check().catch(() => null); busy = false; if (r) { st = r; msg = r.error || ''; if (r.update && !r.error) showCard(r.update); } draw(); };
  api().state().then(s => { st = s; draw(); }).catch(() => {});
  draw(); return host;
}
