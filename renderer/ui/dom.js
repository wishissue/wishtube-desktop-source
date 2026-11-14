/** Tiny hyperscript helper. Text is always inserted as text nodes, never as HTML. */
export function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.'), el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = k => { if (k == null || k === false) return; if (Array.isArray(k)) k.forEach(add); else el.append(k instanceof Node ? k : document.createTextNode(String(k))); };
  kids.forEach(add);
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const clear = el => { while (el.firstChild) el.firstChild.remove(); return el; };

export const fmtDur = s => { if (!s) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
export const fmtViews = n => n == null ? '' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M views' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K views' : n + ' views';
export function fmtAgo(t) {
  if (!t) return ''; const d = (Date.now() - t) / 1000;
  const u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [s, n] of u) if (d >= s) { const k = Math.floor(d / s); return `${k} ${n}${k > 1 ? 's' : ''} ago`; }
  return 'just now';
}
export const fmtBytes = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';

export function toast(msg, ms = 2600) {
  const t = h('div.toast', msg); document.getElementById('toasts').append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, ms);
}

/** Turn plain text into nodes: links open externally, timestamps seek the player. No innerHTML anywhere. */
export function linkify(text, onSeek) {
  const out = [], re = /(https?:\/\/[^\s<>)"']+)|\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(h('a.link', { href: '#', onclick: e => { e.preventDefault(); window.wt.openExternal(m[1]); } }, m[1].length > 60 ? m[1].slice(0, 57) + '…' : m[1]));
    else if (onSeek) { const s = m[2].split(':').map(Number).reduce((a, b) => a * 60 + b, 0); out.push(h('a.link.ts', { href: '#', onclick: e => { e.preventDefault(); onSeek(s); } }, m[2])); }
    else out.push(m[0]);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
