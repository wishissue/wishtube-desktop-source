'use strict';
// Pure URL / bounds validation for the embedded browser. No Electron imports, so it can be unit-tested.
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);   // co.uk, com.au ...
const MAX_URL = 2048;

/** example.co.uk, www.example.co.uk -> example.co.uk */
function site(host) {
  const p = host.toLowerCase().split('.');
  if (p.length <= 2) return p.join('.');
  return (SECOND_LEVEL.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3) : p.slice(-2)).join('.');
}
function parseHttp(u) {
  if (typeof u !== 'string' || u.length > MAX_URL) return null;
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x : null; } catch { return null; }
}
const num = n => Number.isFinite(n) ? Math.max(0, Math.min(20000, Math.round(n))) : 0;
function cleanBounds(b) { return b && typeof b === 'object' ? { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) } : null; }

module.exports = { site, parseHttp, cleanBounds };
