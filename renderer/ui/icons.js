const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  compass: 'M12 21a9 9 0 100-18 9 9 0 000 18zM15.5 8.5l-2 5-5 2 2-5z',
  users: 'M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.9M16 4.1a3.5 3.5 0 010 6.8',
  library: 'M4 4v16M9 4v16M14 6l5 14M14 6l-1-.3',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
  menu: 'M4 6h16M4 12h16M4 18h16',
  back: 'M15 18l-6-6 6-6', fwd: 'M9 6l6 6-6 6',
  play: 'M7 4.5v15l13-7.5z', pause: 'M7 4h3.5v16H7zM13.5 4H17v16h-3.5z',
  vol: 'M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13', mute: 'M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', exitfull: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  theater: 'M3 6h18v12H3z', pip: 'M3 5h18v14H3zM12 12h8v6h-8z', cc: 'M3 5h18v14H3zM10 10a2.5 2.5 0 100 4M17 10a2.5 2.5 0 100 4',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2M18 12h2M12 4v2M12 18v2',
  heart: 'M20.8 5.6a5.5 5.5 0 00-7.8 0L12 6.7l-1-1.1a5.5 5.5 0 00-7.8 7.8L12 22l8.8-8.6a5.5 5.5 0 000-7.8z',
  bookmark: 'M6 3h12v18l-6-4-6 4z', clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', x: 'M6 6l12 12M18 6L6 18', more: 'M5 12h.01M12 12h.01M19 12h.01',
  eyeoff: 'M3 3l18 18M10.6 6.1A9.8 9.8 0 0112 6c5 0 8.5 4 9.5 6a14 14 0 01-2.4 3.2M6.5 6.9A14 14 0 002.5 12c1 2 4.5 6 9.5 6 1.5 0 2.8-.4 4-.9M9.9 9.9a3 3 0 004.2 4.2',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5', refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5', skip: 'M5 4l10 8-10 8zM19 5v14',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', folder: 'M3 6h6l2 2h10v11H3z', sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
};
export const icon = (name, size = 20, sw = 1.7) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', sw); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', P[name] || ''); s.append(p);
  if (['play', 'pause', 'bookmark_fill'].includes(name)) { p.setAttribute('fill', 'currentColor'); p.setAttribute('stroke-width', '0.5'); }
  return s;
};
