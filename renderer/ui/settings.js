import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { SOURCES, SOURCE_IDS } from '../core/models.js';
import { FEATURES } from '../rec/engine.js';
import { pool } from '../rec/pool.js';

const THEME_DEFS = [{ id: 'terminal', name: 'Terminal', bg: '#000', fg: '#25252d', ac: '#a66cff' }, { id: 'glass', name: 'Glass', bg: '#2c4a73', fg: '#ffffff55', ac: '#f4f5f7' }, { id: 'bit', name: '2-bit', bg: '#000', fg: '#fff', ac: '#fff' }, { id: 'classic', name: 'Classic', bg: '#fff', fg: '#ddd', ac: '#e62117' }];
const _ACCENTS = ['#7c8cff', '#ff7a90', '#4fd1c5', '#f5b14c', '#a78bfa', '#6ee7a1', '#f472b6'];
const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ru', 'Русский'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['ar', 'العربية'], ['hi', 'हिन्दी']];
const WLABEL = { interest: 'Your interests', session: 'This session', creator: 'Creators you like', follow: 'Follows', quality: 'Quality', velocity: 'Trending', fresh: 'Freshness', novelty: 'Novelty', durFit: 'Length fit', srcPref: 'Source habit', small: 'Small creators', lang: 'Language', seen: 'Already seen', neg: 'Things you dislike' };

const save = () => state.saveSettings();
const toggle = (get, set) => { const el = h('button.switch', { role: 'switch', class: get() ? 'on' : '', onclick: () => { set(!get()); el.classList.toggle('on', get()); save(); } }); return el; };
const slider = (k, min = 0, max = 1) => h('input', { type: 'range', min, max, step: 0.05, value: state.settings[k], oninput: e => { state.settings[k] = +e.target.value; }, onchange: save });
const field = (title, desc, ctl) => h('div.field', h('div.grow', h('b', title), desc ? h('span', desc) : null), ctl);

export function settings(root) {
  const S = state.settings, taste = h('div');
  function drawTaste() {
    const d = state.ranker.describe();
    clear(taste).append(
      d.events < 3 ? h('p.sub', 'Watch, like or hide a few videos and what the ranker has learned about you appears here. It’s all stored on this computer.') :
      h('div', h('div.taste', ...(d.interests.length ? d.interests : [{ terms: ['no strong interests yet'], strength: 0.05 }]).map(i => h('div.interest', h('div.terms', ...i.terms.map(t => h('span', t))), h('div.row', h('div.bar2', h('i', { style: { width: Math.round(i.strength * 100) + '%' } })), h('span.sub', Math.round(i.strength * 100) + '%'))))),
        h('h2', { style: { margin: '20px 0 6px' } }, 'What the ranker pays attention to'),
        h('p.sub', 'These weights start from sensible defaults and drift toward your behaviour. Longer bar = matters more to you.'),
        ...FEATURES.map(k => { const w = d.weights[k]; return h('div.wrow', h('span', WLABEL[k]), h('div.bar2' + (w < 0 ? '.neg' : ''), h('i', { style: { width: Math.min(100, Math.abs(w) / 3.5 * 100) + '%' } })), h('b', w.toFixed(2))); })));
  }

  root.append(h('div.page', { style: { maxWidth: '860px' } }, h('h1', { style: { marginBottom: '18px' } }, 'Settings'),

    h('div.panel', h('h2', 'Appearance'),
      field('Theme', 'Every theme is flat and square. Pick the mood.', h('div.themes', ...THEME_DEFS.map(t => h('button.tpick', { class: document.documentElement.dataset.theme === t.id ? 'on' : '', onclick: e => { S.theme = t.id; save(); e.currentTarget.parentNode.querySelectorAll('.tpick').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } }, h('i', { style: { background: t.bg, borderColor: t.fg } }, h('b', { style: { position: 'absolute', left: '6px', bottom: '6px', width: '40%', height: '6px', background: t.ac } })), t.name)))),
      field('Density', 'Compact shows more videos per screen', h('select.input', { style: { minWidth: '150px' }, onchange: e => { S.density = e.target.value; save(); } }, ...[['comfortable', 'Comfortable'], ['compact', 'Compact']].map(([v, l]) => h('option', { value: v, selected: S.density === v }, l)))),
      field('Accent override', 'Leave on theme default unless you want your own', h('div.row', h('input', { type: 'color', value: S.accent || '#a66cff', onchange: e => { S.accent = e.target.value; save(); } }), h('button.btn.sm', { onclick: () => { S.accent = null; save(); toast('Accent reset'); } }, 'Theme default'))),
      field('Animations', 'Turn off for a calmer, faster interface', toggle(() => S.motion, v => { S.motion = v; }))),

    h('div.panel', h('h2', 'Feed & algorithm'), h('p.sub', 'Everything is computed on this machine. Nothing is uploaded, ever.'),
      field('Exploration', 'How often to try creators and topics you haven’t seen', slider('explore')),
      field('Freshness', 'Prefer newly published videos over older ones', slider('freshness')),
      field('Variety', 'Spread topics and creators across your feed', slider('diversity')),
      field('Preferred languages', 'Other languages are pushed down, not hidden. Clear all to see everything.',
        h('div.chips', { style: { flexWrap: 'wrap', maxWidth: '420px' } }, ...LANGS.map(([c, n]) => h('button.chip', { class: S.languages.includes(c) ? 'on' : '', onclick: e => { S.languages = S.languages.includes(c) ? S.languages.filter(x => x !== c) : [...S.languages, c]; e.currentTarget.classList.toggle('on'); save(); } }, n))))),

    h('div.panel', h('h2', 'Your taste'), h('p.sub', 'A live look at what the ranker believes.'), taste,
      h('div.row', { style: { marginTop: '16px' } }, h('button.btn.danger.sm', { onclick: () => { if (confirm('Forget everything the ranker learned? Library and follows stay.')) { state.ranker.reset(); state.ranker.setSettings(S); state.flushProfile(); drawTaste(); toast('Taste reset'); } } }, icon('trash', 15), 'Reset what it learned'))),

    h('div.panel', h('h2', 'Sources'), h('p.sub', 'Reorder to change which source leads when results are mixed.'),
      ...S.order.map((id, i) => h('div.field', h('i.dot', { style: { background: SOURCES[id].color } }), h('div.grow', h('b', SOURCES[id].label)),
        h('button.iconbtn', { disabled: i === 0, title: 'Move up', onclick: () => { move(i, -1); } }, icon('back', 16, 2)), h('button.iconbtn', { disabled: i === S.order.length - 1, title: 'Move down', onclick: () => { move(i, 1); } }, icon('fwd', 16, 2)), toggle(() => S.sources[id], v => { S.sources[id] = v; }))),
      field('PeerTube instance', 'Used for the main feed', h('input.input', { value: S.ptInstance, onchange: e => { const v = e.target.value.trim().replace(/\/$/, ''); if (!/^https:\/\/[\w.-]+\.[a-z]{2,}$/i.test(v)) { toast('Enter a https:// address'); e.target.value = S.ptInstance; return; } S.ptInstance = v; save(); } })),
      field('Show mature content', 'Off by default', toggle(() => S.mature, v => { S.mature = v; }))),

    h('div.panel', h('h2', 'Playback & desktop'),
      field('Autoplay next', 'Continue to the top “Up next” video when one ends', toggle(() => S.autoplay, v => { S.autoplay = v; })),
      field('Keep running in tray when closed', 'Audio keeps playing, media keys keep working', toggle(() => S.closeToTray, v => { S.closeToTray = v; })),
      field('Download folder', S.downloadDir || 'Videos/WishTube', h('button.btn.sm', { onclick: async () => { const d = await window.wt.pickDir(); if (d) { S.downloadDir = d; save(); location.reload(); } } }, icon('folder', 15), 'Change'))),

    h('div.panel', h('h2', 'Your data'), h('p.sub', 'Profile, history, library and what the ranker learned in one portable file.'),
      h('div.row', h('button.btn', { onclick: async () => { if (await window.wt.exportFile('wishtube-profile.json', state.exportProfile())) toast('Exported'); } }, 'Export profile'),
        h('button.btn', { onclick: async () => { const t = await window.wt.importFile(); if (!t) return; try { await state.importProfile(t); toast('Imported'); setTimeout(() => location.reload(), 600); } catch (e) { toast('Import failed: ' + e.message); } } }, 'Import profile'),
        h('button.btn', { onclick: async () => { pool.t = 0; pool.videos = []; window.wt.set('pool', null); toast('Cache cleared'); } }, 'Clear feed cache')),
      h('p.sub', { style: { marginTop: '12px' } }, 'No account. No analytics. No WishTube server. WishTube only talks to the video sources you enable.'))));

  function move(i, d) { const a = S.order, j = i + d; [a[i], a[j]] = [a[j], a[i]]; save(); clear(root); settings(root); }
  drawTaste();
  return () => {};
}
