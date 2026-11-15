'use strict';
// Minimal HLS master-playlist reader: which quality variants exist, and which separate audio playlist belongs to each.
const attrs = s => { const o = {}; for (const m of s.matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) o[m[1]] = m[2].replace(/^"|"$/g, ''); return o; };

/** Returns null when `text` is a media playlist (no variants), otherwise [{ height, width, bandwidth, url, audioUrl }] sorted tallest first. */
function parseMaster(text, base) {
  if (!/#EXT-X-STREAM-INF/.test(text)) return null;
  const lines = text.split(/\r?\n/).map(l => l.trim()), audio = {}, out = [];
  for (const l of lines) if (l.startsWith('#EXT-X-MEDIA:')) {
    const a = attrs(l.slice(13));
    if (a.TYPE === 'AUDIO' && a.URI) { const g = a['GROUP-ID']; if (!audio[g] || a.DEFAULT === 'YES') audio[g] = new URL(a.URI, base).href; }
  }
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const a = attrs(lines[i].slice(18)), uri = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (!uri) continue;
    const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
    out.push({ width: w || 0, height: h || 0, bandwidth: Number(a.BANDWIDTH) || 0, url: new URL(uri, base).href, audioUrl: a.AUDIO ? audio[a.AUDIO] || null : null, codecs: a.CODECS || '' });
  }
  const seen = new Set();   // same height listed twice (different bitrates): keep the best one
  return out.sort((x, y) => y.height - x.height || y.bandwidth - x.bandwidth).filter(v => { const k = v.height + ':' + (v.audioUrl || ''); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Media playlist -> { map, segments:[{url, range:[start,end]|null}], encrypted, live }. Handles EXT-X-MAP (fMP4 init) and EXT-X-BYTERANGE. */
function parseMedia(text, base) {
  const lines = text.split(/\r?\n/).map(l => l.trim()), segs = []; let map = null, enc = false, br = null, lastEnd = {};
  const rng = (spec, url) => { const [len, off] = spec.split('@').map(Number); const start = Number.isFinite(off) ? off : (lastEnd[url] ?? 0); lastEnd[url] = start + len; return [start, start + len - 1]; };
  for (const l of lines) {
    if (l.startsWith('#EXT-X-KEY:')) { const a = attrs(l.slice(11)); if (a.METHOD && a.METHOD !== 'NONE') enc = a.METHOD; }
    else if (l.startsWith('#EXT-X-MAP:')) { const a = attrs(l.slice(11)); if (a.URI) { const url = new URL(a.URI, base).href; map = { url, range: a.BYTERANGE ? rng(a.BYTERANGE, url) : null }; } }
    else if (l.startsWith('#EXT-X-BYTERANGE:')) br = l.slice(17);
    else if (l && !l.startsWith('#')) { const url = new URL(l, base).href; segs.push({ url, range: br ? rng(br, url) : null }); br = null; }
  }
  return { map, segments: segs, encrypted: enc, live: !/#EXT-X-ENDLIST/.test(text) };
}
module.exports = { parseMaster, parseMedia };
