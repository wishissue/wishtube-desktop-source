/** One list drives the settings picker, the Ctrl+K palette, the quick switcher and state validation.
 *  bg/bar/ac are only used to draw the little preview tile; the real look lives in themes.css. */
export const THEMES = [
  { id: 'terminal', name: 'Terminal',     bg: '#000',    bar: '#1a1a20', ac: '#a66cff', r: 0 },
  { id: 'aero',     name: 'Frutiger Aero', bg: 'linear-gradient(#5cb8ff,#d9f3ff 60%,#7fcf5a)', bar: 'rgba(255,255,255,.7)', ac: '#1e90e6', r: 6 },
  { id: 'xp',       name: 'Windows XP',   bg: 'linear-gradient(#0a5de8 22%,#fff 22%)', bar: '#0a5de8', ac: '#2f9a2a', r: 3 },
  { id: 'mac',      name: 'Mac OS',       bg: '#fff',    bar: '#000', ac: '#000', r: 4 },
  { id: 'classic',  name: 'Light',        bg: '#fff',    bar: '#f0f0f0', ac: '#e62117', r: 6 },
  { id: 'bit',      name: '2-bit',        bg: '#000',    bar: '#fff', ac: '#fff', r: 0 },
  { id: 'oled',     name: 'OLED Black',   bg: '#000',    bar: '#0c0c0c', ac: '#3ea6ff', r: 14 },
  { id: 'ytdark',   name: 'Classic Dark', bg: '#0f0f0f', bar: '#272727', ac: '#ff0000', r: 12 },
  { id: 'material', name: 'Material 3',   bg: '#141218', bar: '#2b2930', ac: '#d0bcff', r: 20 },
  { id: 'mono',     name: 'Monochrome',   bg: '#f5f5f4', bar: '#fff',    ac: '#111',    r: 2 },
  { id: 'retro',    name: 'Media Center', bg: 'linear-gradient(#123a7a,#040e22)', bar: 'linear-gradient(#2a6fc4,#103a78)', ac: '#5be3ff', r: 10 },
];
export const THEME_IDS = THEMES.map(t => t.id);
export const DEFAULT_THEME = 'terminal';
export const normalizeTheme = t => ({ dark: 'terminal', light: 'classic', glass: 'oled', liquid: 'oled', wishblue: 'oled' })[t] || (THEME_IDS.includes(t) ? t : DEFAULT_THEME);
