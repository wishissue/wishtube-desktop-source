import { h, clear, toast } from './dom.js';
import { icon } from './icons.js';
import { state } from '../core/state.js';
import { pool } from '../rec/pool.js';
import { FEED_PRESETS, feedSettings, FEED_DEFAULTS } from '../rec/filters.js';

/** Settings > Feed. Controls are laid out as label-left / control-right rows (.frow) so text never collides with a slider. */
const save = () => state.saveSettings();
const fill = r => r.style.setProperty('--p', ((r.value - r.min) / ((r.max - r.min) || 1)) * 100 + '%');
const row = (title, desc, ctl) => h('div.frow', h('div', h('b', title), desc ? h('span', desc) : null), ctl);
const group = (title, desc, ...rows) => h('div.fgroup', h('h3', title), desc ? h('p.sub', desc) : null, ...rows);
/** A slider bound to obj[key] with a live value label. */
const rng = (obj, key, min, max, step, fmt = v => v, live) => {
  const o = h('output.val', fmt(obj[key]));
  const i = h('input.wt-range', { type: 'range', min, max, step, value: obj[key], 'aria-label': key, oninput: e => { obj[key] = +e.target.value; o.textContent = fmt(obj[key]); fill(e.target); live?.(); }, onchange: save });
  fill(i); return h('div.rangebox', i, o);
};
const seg = (obj, key, opts, after) => {
  const box = h('div.seg', { role: 'radiogroup' });
  const draw = () => clear(box).append(...opts.map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(obj[key] === v), class: obj[key] === v ? 'on' : '', onclick: () => { obj[key] = v; save(); after?.(); draw(); } }, l)));
  draw(); return box;
};
const sw = (get, set) => { const el = h('button.switch', { role: 'switch', 'aria-checked': String(!!get()), class: get() ? 'on' : '', onclick: () => { set(!get()); el.classList.toggle('on', !!get()); el.setAttribute('aria-checked', String(!!get())); save(); } }); return el; };
const pct = v => Math.round(v * 100) + '%';

/** Editable list of words (add with Enter, remove with ×). */
function tags(list, placeholder, onChange) {
  const box = h('div.tagbox');
  const draw = () => clear(box).append(...list.map((t, i) => h('span.tag2', t, h('button', { type: 'button', 'aria-label': 'Remove ' + t, onclick: () => { list.splice(i, 1); onChange(); draw(); } }, icon('x', 12)))),
    h('input.input', { placeholder, 'aria-label': placeholder, onkeydown: e => { if (e.key !== 'Enter' && e.key !== ',') return; e.preventDefault(); const v = e.target.value.trim().toLowerCase().replace(/,/g, ''); if (v && !list.includes(v) && list.length < 40) { list.push(v); onChange(); draw(); box.querySelector('input').focus(); } } }));
  draw(); return box;
};

export function feedControls() {
  const S = state.settings, host = h('div.fset');
  const draw = () => {
    const F = S.feed = feedSettings(S);
    const lenChip = (k, l) => h('button.chip', { class: F.lengths.includes(k) ? 'on' : '', 'aria-pressed': String(F.lengths.includes(k)), onclick: () => { F.lengths = F.lengths.includes(k) ? F.lengths.filter(x => x !== k) : [...F.lengths, k]; if (!F.lengths.length) F.lengths = ['short', 'medium', 'long']; save(); draw(); } }, l);
    clear(host).append(
      group('Style', 'One tap sets the sliders below. Fine-tune afterwards.', h('div.presetrow', ...Object.entries(FEED_PRESETS).map(([k, p]) => h('button', { class: Math.abs(S.explore - p.explore) < .01 && Math.abs(S.freshness - p.freshness) < .01 && Math.abs(S.diversity - p.diversity) < .01 ? 'on' : '', onclick: () => { Object.assign(S, { explore: p.explore, freshness: p.freshness, diversity: p.diversity }); F.newShare = p.newShare; save(); draw(); } },
        h('b', p.label), h('span', { balanced: 'A bit of everything', discover: 'More new topics and creators', familiar: 'Stay close to what you watch', latest: 'Newest uploads first' }[k]))))),
      group('Balance', null,
        row('Explore new things', 'Higher = more topics you haven’t watched yet.', rng(S, 'explore', 0, 1, 0.05, pct)),
        row('Prefer fresh videos', 'Higher = recent uploads rank above older ones.', rng(S, 'freshness', 0, 1, 0.05, pct)),
        row('Mix it up', 'Higher = fewer videos in a row from the same topic or creator.', rng(S, 'diversity', 0, 1, 0.05, pct)),
        row('New picks on top', 'Share of the first screens that are videos you were never shown before.', rng(F, 'newShare', 0, 0.8, 0.05, pct)),
        row('Max per creator', 'Cap on how many videos one creator can fill in the main grid.', seg(F, 'perCreator', [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [0, 'No limit']]))),
      group('Your topics', 'Add subjects and WishTube searches every source for them on each refresh. Add words or creators to hide.',
        row('More of', 'e.g. blender, synthwave, woodworking', tags(F.topics, 'Add a topic, press Enter', () => { S.interests = [...new Set([...(S.interests || []), ...F.topics])].slice(0, 40); save(); })),
        row('Never show', 'Matches title, tags and creator name.', tags(F.muted, 'Add a word, press Enter', save))),
      group('What to show', null,
        row('Video length', 'Videos with unknown length are always kept.', h('div.chips', lenChip('short', 'Under 5 min'), lenChip('medium', '5–20 min'), lenChip('long', 'Over 20 min'))),
        row('How old', null, seg(F, 'maxAge', [[0, 'Any'], [365, '1 year'], [90, '3 months'], [30, '1 month']])),
        row('Hide videos I finished', null, sw(() => F.hideWatched, v => { F.hideWatched = v; })),
        row('Skip clickbait titles', 'Hides ALL-CAPS, “!!!” and near-empty titles.', sw(() => F.cleanTitles, v => { F.cleanTitles = v; })),
        row('Only videos with a thumbnail', null, sw(() => F.needThumb, v => { F.needThumb = v; }))),
      group('Home shelves', 'Rows shown above the main grid on the “For you” tab.', ...[['continue', 'Continue watching'], ['follows', 'From people you follow'], ['interests', 'Because you like…'], ['trending', 'New and rising']].map(([k, l]) => row(l, null, sw(() => F.shelves[k], v => { F.shelves[k] = v; })))),
      group('Refreshing', null,
        row('Find new videos', 'How often Home fetches new videos in the background.', seg(F, 'autoRefresh', [['open', 'Every visit'], ['hourly', 'Hourly'], ['manual', 'Manual']])),
        row('Right now', 'Fetches a different mix than last time.', h('button.btn', { onclick: async e => { e.currentTarget.disabled = true; try { const r = await pool.refresh(); toast(r?.added ? `${r.added} new videos found` : 'Nothing new right now'); } catch { toast('Refresh failed'); } e.currentTarget.disabled = false; } }, icon('refresh', 15), 'Refresh the feed'))),
      h('div.row', { style: { justifyContent: 'flex-end' } }, h('button.btn.sm', { onclick: () => { Object.assign(S, { explore: 0.35, freshness: 0.5, diversity: 0.6 }); S.feed = { ...FEED_DEFAULTS, shelves: { ...FEED_DEFAULTS.shelves } }; save(); draw(); toast('Feed settings reset'); } }, 'Reset feed settings')));
  };
  draw(); return host;
}
