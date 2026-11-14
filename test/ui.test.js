import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { THEMES, THEME_IDS, normalizeTheme, DEFAULT_THEME } from '../renderer/core/themes.js';

const read = p => readFileSync(new URL('../renderer/' + p, import.meta.url), 'utf8');
const themesCss = read('themes.css');
// variables every component relies on; a theme missing one renders broken UI
const REQUIRED = ['--bg', '--surface', '--surface-2', '--surface-3', '--line', '--text', '--muted', '--accent', '--on-accent', '--chrome', '--ctl', '--ctl-h', '--pri', '--pri-text', '--on-bg', '--on-text', '--pop'];

test('theme registry: unique ids, includes the requested themes', () => {
  assert.equal(new Set(THEME_IDS).size, THEMES.length);
  for (const id of ['aero', 'xp', 'mac']) assert.ok(THEME_IDS.includes(id), id);
  assert.ok(THEME_IDS.includes(DEFAULT_THEME));
});

test('legacy / unknown saved themes fall back safely', () => {
  assert.equal(normalizeTheme('dark'), 'terminal');
  assert.equal(normalizeTheme('light'), 'classic');
  assert.equal(normalizeTheme('nonsense'), DEFAULT_THEME);
  assert.equal(normalizeTheme('xp'), 'xp');
});

for (const t of THEMES) {
  test(`theme "${t.id}" defines every required variable`, () => {
    const m = themesCss.match(new RegExp(`\\[data-theme="${t.id}"\\] \\{([\\s\\S]*?)\\n(?=\\[|/\\*|$)`));
    assert.ok(m, 'block missing in themes.css');
    const missing = REQUIRED.filter(v => !new RegExp(v.replace(/[-]/g, '\\-') + '\\s*:').test(m[1]));
    assert.deepEqual(missing, []);
  });
}

test('every icon("name") used in the UI exists in the generated Lucide set', () => {
  const have = new Set([...read('ui/icons.js').matchAll(/"([a-z]+)":\[\[/g)].map(m => m[1]));
  const files = ['app.js', ...readdirSync(new URL('../renderer/ui/', import.meta.url)).map(f => 'ui/' + f)];
  const used = new Set(); for (const f of files) for (const m of read(f).matchAll(/icon\(\s*'([a-z]+)'/g)) used.add(m[1]);
  for (const m of read('ui/overlays.js').matchAll(/ic: '([a-z]+)'/g)) used.add(m[1]);
  assert.deepEqual([...used].filter(n => !have.has(n)), []);
});

test('assets referenced by index.html and fonts.css exist (and are not in the gitignored vendor/ dir)', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/href="([^"]+\.css)"/g)) assert.ok(existsSync(new URL('../renderer/' + m[1], import.meta.url)), m[1]);
  for (const m of read('assets/fonts.css').matchAll(/url\("([^"]+)"\)/g)) assert.ok(existsSync(new URL('../renderer/assets/' + m[1], import.meta.url)), m[1]);
  assert.ok(!/href="vendor\//.test(html), 'stylesheets must not live in gitignored vendor/');
});

test('licenses for everything vendored are shipped', () => {
  const have = readdirSync(new URL('../renderer/assets/licenses/', import.meta.url));
  for (const n of ['Inter', 'JetBrainsMono', 'NotoSans', 'Lucide', 'OpenProps', '7.css', 'XP.css', 'system.css']) assert.ok(have.some(f => f.startsWith(n)), n);
});

test('glass: has orbs, tunable blur/tint vars, and a native see-through mode', () => {
  const css = read('themes.css'), html = read('index.html');
  assert.match(css, /--glass-blur/); assert.match(css, /--glass-tint/);
  assert.match(css, /\.native-glass\[data-theme="glass"\]/);
  assert.equal((html.match(/class="orb o\d"/g) || []).length, 3);
});

test('main process allows the fullscreen permission and the search icon is a real button', () => {
  const main = readFileSync(new URL('../main/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /ALLOWED = new Set\(\['fullscreen'\]\)/);
  assert.match(read('app.js'), /button\.sgo/);
});
