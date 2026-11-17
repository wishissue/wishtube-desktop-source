import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state, BG_PRESETS } from '../core/state.js';

/** Settings → Look. Every control applies live and persists through state.saveSettings(). */
const S = () => state.settings;
const live = () => state.applyTheme();
const save = () => state.saveSettings();
const field = (title, desc, ctl) => h('div.field', h('div.grow', h('b', title), desc ? h('span', desc) : null), ctl);
const fill = r => r.style.setProperty('--p', ((r.value - r.min) / ((r.max - r.min) || 1)) * 100 + '%');
const range = (key, min, max, step, fmt = v => v) => {
  const o = h('output.val', fmt(S()[key] ?? min));
  const i = h('input.wt-range', { type: 'range', min, max, step, value: S()[key] ?? min, 'aria-label': key, oninput: e => { S()[key] = +e.target.value; o.textContent = fmt(+e.target.value); fill(e.target); live(); }, onchange: save });
  fill(i); return h('div.rangebox', i, o);
};
/** Button group: every option visible at once, one tap to choose. `obj` is where the value lives (settings by default). */
const seg = (key, opts, after, obj = S()) => {
  const box = h('div.seg', { role: 'radiogroup', 'aria-label': key });
  const draw = () => clear(box).append(...opts.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(obj[key] === v), class: obj[key] === v ? 'on' : '', onclick: () => { obj[key] = v; save(); after?.(); draw(); } }, l)));
  draw(); return box;
};
const toggle = (get, set) => { const el = h('button.switch', { role: 'switch', 'aria-checked': String(!!get()), class: get() ? 'on' : '', onclick: () => { set(!get()); el.classList.toggle('on', get()); el.setAttribute('aria-checked', String(!!get())); save(); } }); return el; };

const SWATCHES = [null, '#0066ff', '#ff2a2a', '#ff8a00', '#eab308', '#22c55e', '#14b8a6', '#a66cff', '#ec4899'];
function accentPicker() {
  const box = h('div.row.wrap', { style: { gap: '8px' } });
  const draw = () => {
    clear(box).append(...SWATCHES.map(c => h('button.swatch', { class: (S().accent || null) === c ? 'on' : '', title: c || 'Theme default', 'aria-label': c || 'Theme default accent', style: { background: c || 'conic-gradient(#f66,#fc6,#6c6,#6cf,#96f,#f66)' }, onclick: () => { S().accent = c; save(); draw(); } })),
      h('label.swatch.custom', { title: 'Custom colour' }, icon('palette', 14), h('input', { type: 'color', value: S().accent || '#0066ff', oninput: e => { S().accent = e.target.value; live(); }, onchange: () => { save(); draw(); } })));
  };
  draw(); return box;
}

async function pickBackground(onDone) {
  const inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: { display: 'none' } }); document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files[0]; inp.remove(); if (!f) return;
    try {
      const bmp = await createImageBitmap(f), k = Math.min(1, 1920 / Math.max(bmp.width, bmp.height)), c = h('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });   // downscale so it stays light
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      state.bgImage = c.toDataURL('image/jpeg', 0.86); await window.wt.set('bgimage', state.bgImage);
      S().bgMode = 'image'; save(); onDone(); toast('Background set');
    } catch { toast('Couldn’t read that image', 3200, 'loadfail'); }
  };
  inp.click();
}

export function lookPanels(themePick) {
  const bgBox = h('div');
  const drawBg = () => {
    clear(bgBox).append(
      field('Background', 'Panels turn translucent so it shows through', seg('bgMode', [['theme', 'Theme'], ['preset', 'Gradient'], ['image', 'My image']], drawBg)));
    if (S().bgMode === 'preset') bgBox.append(h('div.field', h('div.row.wrap', { style: { gap: '8px' } }, ...Object.entries(BG_PRESETS).map(([k, v]) => h('button.bgchip', { class: S().bgPreset === k ? 'on' : '', title: k, style: { background: v }, onclick: () => { S().bgPreset = k; save(); drawBg(); } })))));
    if (S().bgMode === 'image') bgBox.append(field('Image', state.bgImage ? 'Stored on this computer only' : 'Pick a picture (it is shrunk to 1920px)', h('div.row', h('button.btn.sm', { onclick: () => pickBackground(drawBg) }, icon('image', 15), state.bgImage ? 'Change' : 'Choose…'),
      state.bgImage ? h('button.btn.sm.danger', { onclick: async () => { state.bgImage = null; await window.wt.set('bgimage', null); S().bgMode = 'theme'; save(); drawBg(); } }, icon('trash', 15), 'Remove') : null)));
    if (S().bgMode !== 'theme') bgBox.append(field('Blur', null, range('bgBlur', 0, 40, 1, v => v + 'px')), field('Dim', null, range('bgDim', 0, 0.9, 0.05, v => Math.round(v * 100) + '%')), field('Panel opacity', 'Lower shows more background', range('panelOpacity', 0.2, 1, 0.02, v => Math.round(v * 100) + '%')));
  };
  drawBg();

  const navItems = [['home', 'Home'], ['shorts', 'Shorts'], ['music', 'Music'], ['following', 'Following'], ['library', 'Library'], ['downloads', 'Downloads']];
  const radiusRow = () => { const box = h('div.row'); const draw = () => { clear(box).append(toggle(() => S().radius != null, v => { S().radius = v ? 12 : null; live(); draw(); }), S().radius != null ? range('radius', 0, 28, 1, v => v + 'px') : h('span.sub', 'Theme default')); }; draw(); return box; };

  return [
    h('div.panel', h('h2', 'Theme'), themePick),
    h('div.panel', h('h2', 'Colours'), field('Accent colour', 'Buttons, progress, highlights', accentPicker())),
    h('div.panel', h('h2', 'Layout & text'),
      field('Font', null, seg('font', [['theme', 'Theme'], ['inter', 'Inter'], ['noto', 'Noto Sans'], ['mono', 'Mono'], ['system', 'System'], ['serif', 'Serif']], live)),
      field('Text size', null, range('uiScale', 0.85, 1.3, 0.05, v => Math.round(v * 100) + '%')),
      field('Density', null, seg('density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']])),
      field('Thumbnail size', null, range('thumbSize', 190, 440, 2, v => v + 'px')),
      field('Corner roundness', null, radiusRow()),
      field('Sidebar', null, seg('rail', [['full', 'Labels'], ['icons', 'Icons'], ['hidden', 'Hidden']])),
      field('Sidebar side', null, seg('railSide', [['left', 'Left'], ['right', 'Right']])),
      h('div.field', h('details.grow', h('summary', 'Sidebar items'), h('div.row.wrap', { style: { marginTop: '10px', gap: '8px' } }, ...navItems.map(([id, l]) => h('button.chip', { class: S().nav[id] === false ? '' : 'on', onclick: e => { S().nav[id] = S().nav[id] === false; e.currentTarget.classList.toggle('on', S().nav[id] !== false); save(); } }, l)))))),
    h('div.panel', h('h2', 'Background'), bgBox),
    h('div.panel', h('h2', 'Motion'), field('Animations', 'Full: everything moves. Reduced: no decorative motion. Off: instant.', seg('motionLevel', [['full', 'Full'], ['reduced', 'Reduced'], ['off', 'Off']]))),
  ];
}

export function playerPanel() {
  const P = () => S().player;
  const ps = (key, opts) => seg(key, opts, null, P());
  return h('div.panel', h('h2', 'Player'),
    field('Default speed', null, ps('speed', [[0.5, '0.5×'], [0.75, '0.75×'], [1, '1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']])),
    field('Skip step (J / L)', null, ps('skip', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']])),
    field('Captions on by default', null, toggle(() => P().captions, v => { P().captions = v; })),
    field('Start in theater mode', null, toggle(() => P().theater, v => { P().theater = v; })),
    field('Remember volume', null, toggle(() => P().rememberVolume, v => { P().rememberVolume = v; })));
}
