import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { site, parseHttp, cleanBounds } = createRequire(import.meta.url)('../main/netguard.cjs');
const src = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('site(): registrable domain, including two-part TLDs', () => {
  assert.equal(site('www.youtube.com'), 'youtube.com');
  assert.equal(site('consent.youtube.com'), 'youtube.com');
  assert.equal(site('odysee.com'), 'odysee.com');
  assert.equal(site('www.example.co.uk'), 'example.co.uk');
  assert.notEqual(site('evil-youtube.com'), site('youtube.com'));
  assert.notEqual(site('youtube.com.evil.io'), site('youtube.com'));
});

test('parseHttp(): only http(s), bounded length', () => {
  assert.ok(parseHttp('https://example.com/a'));
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'chrome://gpu', 'not a url', 42, null, 'https://x.com/' + 'a'.repeat(3000)]) assert.equal(parseHttp(bad), null, String(bad).slice(0, 30));
});

test('cleanBounds(): numbers only, clamped', () => {
  assert.deepEqual(cleanBounds({ x: 1.6, y: -5, width: NaN, height: 1e9 }), { x: 2, y: 0, width: 0, height: 20000 });
  assert.equal(cleanBounds('x'), null); assert.equal(cleanBounds(null), null);
});

test('browser fallback: sandboxed, isolated, no preload, trusted-sender IPC, three buttons', () => {
  const b = src('main/browser.cjs');
  for (const re of [/contextIsolation: true/, /nodeIntegration: false/, /sandbox: true/, /partition: PARTITION/, /Untrusted sender/, /will-navigate/, /will-redirect/, /setWindowOpenHandler/, /perm === 'fullscreen'/]) assert.match(b, re);
  assert.doesNotMatch(b, /preload\s*:/);
  const p = src('renderer/ui/player.js'), w = src('renderer/ui/watch.js');
  for (const t of ['Try Again', 'Open Original', 'Pretend as Browser']) { assert.ok(p.includes(t), 'player ' + t); assert.ok(w.includes(t), 'watch ' + t); }
});

test('search history: dedupes, caps, skips links, removes, clears', async () => {
  globalThis.window = { wt: { set() {}, get: async () => null } };
  const { state } = await import('../renderer/core/state.js');
  state.lib.searches = [];
  state.addSearch('Blender'); state.addSearch('blender'); state.addSearch('  linux  '); state.addSearch('https://example.com/x'); state.addSearch('   ');
  assert.deepEqual(state.lib.searches, ['linux', 'blender']);
  for (let i = 0; i < 40; i++) state.addSearch('q' + i);
  assert.equal(state.lib.searches.length, 30);
  state.removeSearch('q39'); assert.ok(!state.lib.searches.includes('q39'));
  state.clearSearches(); assert.deepEqual(state.lib.searches, []);
});
