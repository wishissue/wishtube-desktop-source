import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { SOURCES } from '../core/models.js';
import { FEATURES } from '../rec/engine.js';
import { pool } from '../rec/pool.js';
import { THEMES, normalizeTheme } from '../core/themes.js';
import { lookPanels, playerPanel } from './appearance.js';
import { feedControls } from './feedpanel.js';
import { WISHISSUE } from '../core/credits.js';
import { updatesPanel } from './updates.js';

const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ru', 'Русский'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['ar', 'العربية'], ['hi', 'हिन्दी']];
const WLABEL = { interest: 'Your interests', session: 'This session', creator: 'Creators you like', follow: 'Follows', quality: 'Quality', velocity: 'Trending', fresh: 'Freshness', novelty: 'Novelty', durFit: 'Length fit', srcPref: 'Source habit', small: 'Small creators', lang: 'Language', seen: 'Already seen', neg: 'Things you dislike' };

const save = () => state.saveSettings();
const toggle = (get, set) => { const el = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!get()), class: get() ? 'on' : '', onclick: () => { set(!get()); el.classList.toggle('on', get()); el.setAttribute('aria-checked', String(!!get())); save(); } }); return el; };
const slider = (k, min = 0, max = 1) => h('input', { type: 'range', min, max, step: 0.05, value: state.settings[k], oninput: e => { state.settings[k] = +e.target.value; }, onchange: save });
const field = (title, desc, ctl) => { if (ctl instanceof Element && !ctl.getAttribute('aria-label') && (ctl.matches('[role=switch],input,select') )) ctl.setAttribute('aria-label', title); return h('div.field', h('div.grow', h('b', title), desc ? h('span', desc) : null), ctl); };

export function settings(root) {
  const S = state.settings, taste = h('div');
  function drawTaste() {
    const d = state.ranker.describe();
    clear(taste).append(
      d.events < 3 ? h('p.sub', 'Watch or like a few videos and it shows up here.') :
      h('div', h('div.taste', ...(d.interests.length ? d.interests : [{ terms: ['no strong interests yet'], strength: 0.05 }]).map(i => h('div.interest', h('div.terms', ...i.terms.map(t => h('span', t))), h('div.row', h('div.bar2', h('i', { style: { width: Math.round(i.strength * 100) + '%' } })), h('span.sub', Math.round(i.strength * 100) + '%'))))),
        h('h2', { style: { margin: '18px 0 6px' } }, 'What matters to it'),
        ...FEATURES.map(k => { const w = d.weights[k]; return h('div.wrow', h('span', WLABEL[k]), h('div.bar2' + (w < 0 ? '.neg' : ''), h('i', { style: { width: Math.min(100, Math.abs(w) / 3.5 * 100) + '%' } })), h('b', w.toFixed(2))); })));
  }

  const themePick = h('div.themes', ...THEMES.map(t => h('button.tpick', { title: t.name, class: normalizeTheme(S.theme) === t.id ? 'on' : '', onclick: e => { S.theme = t.id; save(); e.currentTarget.parentNode.querySelectorAll('.tpick').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } },
    h('i', { style: { background: t.bg, borderRadius: t.r + 'px' } }, h('b', { style: { background: t.bar } }), h('u', { style: { background: t.ac, borderRadius: Math.min(t.r, 4) + 'px' } })), t.name)));

  root.append(h('div.page', { style: { maxWidth: '820px' } }, h('h1', { style: { marginBottom: '18px' } }, 'Settings'),

    ...lookPanels(themePick),

    h('div.panel', h('h2', 'Feed'),
      feedControls(),
      h('div.field', h('details.grow', h('summary', 'Languages'), h('div.chips', { style: { flexWrap: 'wrap', marginTop: '10px' } }, ...LANGS.map(([c, n]) => h('button.chip', { class: S.languages.includes(c) ? 'on' : '', onclick: e => { S.languages = S.languages.includes(c) ? S.languages.filter(x => x !== c) : [...S.languages, c]; e.currentTarget.classList.toggle('on'); save(); } }, n))))),
      h('div.field', h('details.grow', h('summary', 'What it learned about you'), taste, h('div.row', { style: { marginTop: '14px' } }, h('button.btn.danger.sm', { onclick: () => { if (confirm('Forget everything the ranker learned? Library and follows stay.')) { state.ranker.reset(); state.ranker.setSettings(S); state.flushProfile(); drawTaste(); toast('Reset'); } } }, icon('trash', 15), 'Reset'))))),

    h('div.panel', h('h2', 'Sources'),
      ...S.order.map((id, i) => h('div.field', h('i.dot', { style: { background: SOURCES[id].color } }), h('div.grow', h('b', SOURCES[id].label)),
        h('button.iconbtn', { disabled: i === 0, title: 'Move up', onclick: () => { move(i, -1); } }, icon('back', 16, 2)), h('button.iconbtn', { disabled: i === S.order.length - 1, title: 'Move down', onclick: () => { move(i, 1); } }, icon('fwd', 16, 2)), toggle(() => S.sources[id], v => { S.sources[id] = v; }))),
      field('PeerTube instance', null, h('input.input', { value: S.ptInstance, onchange: e => { const v = e.target.value.trim().replace(/\/$/, ''); if (!/^https:\/\/[\w.-]+\.[a-z]{2,}$/i.test(v)) { toast('Enter a https:// address'); e.target.value = S.ptInstance; return; } S.ptInstance = v; save(); } })),
      field('Mature content', null, toggle(() => S.mature, v => { S.mature = v; }))),

    playerPanel(),

    h('div.panel', h('h2', 'Playback'),
      field('Autoplay next', null, toggle(() => S.autoplay, v => { S.autoplay = v; })),
      field('Keep playing in tray', null, toggle(() => S.closeToTray, v => { S.closeToTray = v; })),
      field('Download folder', S.downloadDir || 'Videos/WishTube', h('button.btn.sm', { onclick: async () => { const d = await window.wt.pickDir(); if (d) { S.downloadDir = d; save(); location.reload(); } } }, icon('folder', 15), 'Change'))),

    updatesPanel(),

    h('div.panel', h('h2', 'Data'),
      h('div.row.wrap', h('button.btn', { onclick: async () => { if (await window.wt.exportFile('wishtube-profile.json', state.exportProfile())) toast('Exported'); } }, 'Export'),
        h('button.btn', { onclick: async () => { const t = await window.wt.importFile(); if (!t) return; try { await state.importProfile(t); toast('Imported', 2600, 'win'); setTimeout(() => location.reload(), 600); } catch (e) { toast('Import failed: ' + e.message); } } }, 'Import'),
        h('button.btn', { onclick: async () => { pool.t = 0; pool.videos = []; window.wt.set('pool', null); toast('Cache cleared'); } }, 'Clear feed cache')),
      h('p.sub', { style: { marginTop: '12px' } }, 'Everything stays on this computer. No account, no analytics.')),

    h('div.panel', h('h2', 'WishIssue'),
      h('div.row.wrap', { style: { gap: '8px' } }, ...[['github', 'GitHub', 'github'], ['youtube', 'YouTube', 'youtube'], ['discord', 'Discord', 'msg'], ['donate', 'Donate', 'coffee']].filter(([k]) => WISHISSUE[k]).map(([k, l, ic]) => h('button.btn', { onclick: () => window.wt.openExternal(WISHISSUE[k]) }, icon(ic, 16), l))))));

  function move(i, d) { const a = S.order, j = i + d; [a[i], a[j]] = [a[j], a[i]]; save(); clear(root); settings(root); }
  drawTaste();
  return () => {};
}
