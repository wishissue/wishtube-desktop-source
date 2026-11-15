/** Pure helpers for the comments panel (unit-tested). Comments are only ever what a provider returned: nothing is generated. */
export const SORTS = { new: 'Newest', top: 'Top', old: 'Oldest' };
export function sortComments(items, mode) {
  const l = [...items];
  if (mode === 'old') return l.sort((a, b) => (a.date || 0) - (b.date || 0));
  if (mode === 'top') return l.sort((a, b) => ((b.likes ?? -1) - (a.likes ?? -1)) || ((b.replies || 0) - (a.replies || 0)) || ((b.date || 0) - (a.date || 0)));
  return l.sort((a, b) => (b.date || 0) - (a.date || 0));
}
export function filterComments(items, q) {
  q = (q || '').trim().toLowerCase(); if (!q) return items;
  return items.filter(c => (c.text + ' ' + c.user).toLowerCase().includes(q));
}
/** Which sort modes the provider genuinely supports: Top needs likes or reply counts to mean anything. */
export const topMeaningful = items => items.some(c => c.likes != null || c.replies > 0);
