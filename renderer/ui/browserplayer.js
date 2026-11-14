import { h, clear, toast, $ } from './dom.js';
import { icon } from './icons.js';

/**
 * "Pretend as Browser": the page itself is drawn by the main process (a sandboxed Chromium view with its own session);
 * this file is the toolbar around it and keeps the view lined up with the stage rectangle.
 */
export function browserPlayer(host, video, { onBack }) {
  let st = { loading: true, url: video.url, title: '', error: null, fs: false, canGoBack: false }, dead = false, last = '';
  const btn = (ic, title, fn) => h('button.iconbtn', { title, 'aria-label': title, onclick: fn }, icon(ic, 18));
  const back = btn('back', 'Back', () => window.wt.browser.nav('back'));
  const reload = btn('refresh', 'Reload', () => window.wt.browser.nav(st.loading ? 'stop' : 'reload'));
  const full = btn('full', 'Fullscreen', () => window.wt.browser.fullscreen(!st.fs));
  const clearB = btn('trash', 'Clear browsing data', async () => { if (confirm('Clear cookies, site data and cache used by the embedded browser?')) { await window.wt.browser.clear(); toast('Browsing data cleared'); } });
  const urlEl = h('span.burl', video.url), bar = h('i'), msg = h('div.bmsg', { hidden: true });
  const stage = h('div.bstage', msg);
  const root = h('div.bplayer',
    h('div.btool', back, reload, urlEl, h('div.grow'), full, clearB, h('button.btn.sm', { onclick: () => destroy(true) }, 'Back to WishTube player')),
    h('div.bload', bar), stage);
  host.append(root);

  function draw() {
    back.disabled = !st.canGoBack; urlEl.textContent = st.url || video.url; bar.style.opacity = st.loading ? 1 : 0;
    reload.replaceChildren(icon(st.loading ? 'x' : 'refresh', 18)); reload.title = st.loading ? 'Stop' : 'Reload';
    full.replaceChildren(icon(st.fs ? 'exitfull' : 'full', 18));
    msg.hidden = !st.error && !st.loading; clear(msg);
    if (st.error) msg.append(h('p', st.error), h('div.row', { style: { justifyContent: 'center' } }, h('button.btn.sm.pri', { onclick: () => window.wt.browser.nav('reload') }, 'Reload'), h('button.btn.sm', { onclick: () => window.wt.openExternal(video.url) }, icon('ext', 15), 'Open original')));
    else if (st.loading) msg.append(h('div.spin'));
  }
  const off = window.wt.on('browser:state', s => { st = s; draw(); });

  // keep the native view exactly over the stage; hide it while an overlay (Ctrl+K, dialogs) is open
  const rect = () => {
    if (dead) return; const o = document.getElementById('overlay');
    const r = stage.getBoundingClientRect(), hide = o && o.childElementCount > 0;
    const b = hide || r.width < 2 ? { x: 0, y: 0, width: 0, height: 0 } : { x: r.left, y: r.top, width: r.width, height: r.height };
    const key = [b.x, b.y, b.width, b.height].map(Math.round).join(',');
    if (key !== last) { last = key; window.wt.browser.bounds(b); }
  };
  const tick = setInterval(rect, 200); addEventListener('resize', rect);

  window.wt.browser.open(video.url, (() => { const r = stage.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })())
    .catch(e => { st = { ...st, loading: false, error: 'Couldn’t open this page: ' + e.message }; draw(); });
  draw();

  function destroy(notify) {
    if (dead) return; dead = true; clearInterval(tick); removeEventListener('resize', rect); off();
    window.wt.browser.close().catch(() => {}); root.remove(); if (notify) onBack?.();
  }
  return { destroy: () => destroy(false) };
}
