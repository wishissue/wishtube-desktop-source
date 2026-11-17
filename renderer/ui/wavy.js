/** Material-style wavy circular progress indicator: a wavy ring that turns while a bright arc grows and shrinks.
 *  Used for every wait in the app (and baked into index.html for the splash). It never shows the app icon. */
const NS = 'http://www.w3.org/2000/svg';
let D = '';

export function wavyPath(waves = 9, R = 17, A = 1.7, steps = 240) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps * Math.PI * 2 - Math.PI / 2, r = R + A * Math.sin(waves * (t + Math.PI / 2));
    d += (i ? 'L' : 'M') + (24 + r * Math.cos(t)).toFixed(2) + ' ' + (24 + r * Math.sin(t)).toFixed(2);
  }
  return d + 'Z';
}

/** @param {number} size pixel size  @param {string} cls extra class, e.g. 'on-dark' for dark backgrounds */
export function wavy(size = 48, cls = '') {
  D ||= wavyPath();
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', 'wv' + (cls ? ' ' + cls : '')); s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true');
  for (const c of ['tr', 'arc']) { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', c); p.setAttribute('d', D); if (c === 'arc') p.setAttribute('pathLength', '1'); s.append(p); }
  return s;
}
