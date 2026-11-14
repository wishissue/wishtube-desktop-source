export const SOURCES = {
  peertube: { label: 'PeerTube', color: '#f1680d' },
  odysee: { label: 'Odysee', color: '#e2457a' },
  archive: { label: 'Internet Archive', color: '#7aa2f7' },
  ccc: { label: 'media.ccc.de', color: '#9ece6a' },
  wikimedia: { label: 'Wikimedia', color: '#bb9af7' },
};
export const SOURCE_IDS = Object.keys(SOURCES);

/** Sources whose content is naturally old: freshness must not punish them. */
export const EVERGREEN = new Set(['archive', 'wikimedia', 'ccc']);

export const creatorKey = v => `${v.source}:${v.creatorId}`;

export function parseLicense(s) {
  const l = (s || '').toLowerCase();
  if (l.includes('public domain') || l.includes('cc0')) return { name: s || 'Public Domain', reuse: 'remix' };
  if (l.includes('by-sa') || l.includes('by sa')) return { name: 'CC BY-SA', reuse: 'remix' };
  if (/\bcc[ -]by\b/.test(l) || l.includes('attribution')) return { name: 'CC BY', reuse: 'remix' };
  if (l.includes('creative commons')) return { name: s, reuse: 'remix' };
  return { name: s || 'Check rights', reuse: 'check' };
}

/** Timestamp lines in a description become chapters (works for any source). */
export function parseChapters(desc = '') {
  const re = /^\s*(?:[-•*]\s*)?\(?((?:\d{1,2}:)?\d{1,2}:\d{2})\)?\s*[-–—:]?\s*(.+?)\s*$/gm;
  const list = [...desc.matchAll(re)].map(m => ({ t: m[1].split(':').map(Number).reduce((a, b) => a * 60 + b, 0), title: m[2] }));
  const ok = list.length >= 3 && list[0].t <= 5 && list.every((c, i) => i === 0 || c.t > list[i - 1].t);
  return ok ? list : [];
}

export const stripHtml = s => (s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
export const qs = (base, params) => { const u = new URL(base); for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v); return u.toString(); };
export const parseDate = s => { const t = Date.parse(s); return Number.isFinite(t) ? t : 0; };
