import { h } from './dom.js';
import { wavy } from './wavy.js';
import { pickCat, catSrc } from '../core/cats.js';

/** The loading animation used everywhere (feed, search, music, Shorts, video start-up).
 *  A Material wavy circular indicator and one plain sentence. No app icon, no logs, no timers, no jargon.
 *  After a long wait a grumpy cat apologises for the slow connection.
 *  Same shape as before so every screen can keep calling it: returns { el, status, reset, stop }. */
export function terminal({ headline, className = '' } = {}) {
  const text = h('span.ltext', headline?.() || 'Loading'), t0 = { v: Date.now() }; let cat = null;
  const el = h('div.loader' + (className ? '.' + className.split(/\s+/).filter(Boolean).join('.') : ''), { role: 'status', 'aria-live': 'polite' }, wavy(72), text);
  const status = () => {
    const s = Date.now() - t0.v; text.textContent = (headline?.() || 'Loading') + (s > 12000 ? ' · taking a little longer than usual' : '');
    if (s > 12000 && !cat) { const p = pickCat('slow'); cat = h('div.lslow', h('img', { src: catSrc(p.cat), alt: '', draggable: false }), h('span', h('b', p.head), ' ', p.joke)); el.append(cat); }
    else if (s <= 12000 && cat) { cat.remove(); cat = null; }
  };
  const tick = setInterval(status, 1000);
  return { el, status, reset(t = Date.now()) { t0.v = t; }, stop() { clearInterval(tick); } };
}

/** Failure screens use plain words only (the screen itself explains what went wrong), so there is nothing extra to show. */
export function staticLog() { return h('span'); }

/** The little live status pill was removed. Kept as a harmless no-op so nothing that still calls it breaks. */
export function activityBar() { return { el: h('span'), set() {}, stop() {} }; }
