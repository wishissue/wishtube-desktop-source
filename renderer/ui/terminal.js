import { h } from './dom.js';

/** The loading animation used everywhere (feed, search, music, Shorts, video start-up).
 *  A glowing logo ring, one plain sentence and a shimmering bar. No logs, no timers, no jargon.
 *  Same shape as before so every screen can keep calling it: returns { el, status, reset, stop }. */
export function terminal({ headline, className = '' } = {}) {
  const text = h('span.ltext', headline?.() || 'Loading'), t0 = { v: Date.now() };
  const el = h('div.loader' + (className ? '.' + className.split(/\s+/).filter(Boolean).join('.') : ''), { role: 'status', 'aria-live': 'polite' },
    h('div.lmark', h('i.lring'), h('i.lring.two'), h('img', { src: 'assets/logo-128.png', alt: '', draggable: 'false' })),
    text, h('div.lbar', h('i')));
  const status = () => { const s = Date.now() - t0.v; text.textContent = (headline?.() || 'Loading') + (s > 12000 ? ' · taking a little longer than usual' : ''); };
  const tick = setInterval(status, 1000);
  return { el, status, reset(t = Date.now()) { t0.v = t; }, stop() { clearInterval(tick); } };
}

/** Failure screens now use plain words only (the screen itself explains what went wrong), so there is nothing extra to show. */
export function staticLog() { return h('span'); }

/** The little live status pill was removed. Kept as a harmless no-op so nothing that still calls it breaks. */
export function activityBar() { return { el: h('span'), set() {}, stop() {} }; }
