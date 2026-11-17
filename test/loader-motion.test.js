import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../renderer/index.html', import.meta.url), 'utf8');

/** Regression: the global "kill all animation" rules (OS reduced-motion and Settings > Animations > Off) set every animation to .001ms,
 *  which freezes `infinite` loaders and makes the app look hung. Loaders must be exempted with a rule that wins over those !important rules. */
test('reduced-motion / Off still lets the loading ring turn', () => {
  const kills = css.match(/animation-duration:\s*\.001ms\s*!important/g) || [];
  assert.ok(kills.length >= 2, 'expected the two blanket kill-switches to exist (this test guards how loaders escape them)');

  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*html \.wv[\s\S]*?\n\}/);
  assert.ok(reduced, 'reduced-motion block must re-enable the loader');
  assert.match(reduced[0], /html \.wv \{ animation: wvspin [\d.]+s linear infinite !important; \}/);
  assert.match(reduced[0], /html \.spin \{ animation: wtspin/);

  assert.match(css, /html\.no-motion \.wv \{ animation: wvspin [\d.]+s linear infinite !important; \}/);
  assert.match(css, /html\.no-motion \.spin \{ animation: wtspin/);
});

test('nothing turns the ring animation off outright any more', () => {
  assert.doesNotMatch(css, /html\.no-motion \.wv(?!\s[.{])[^{]*\{\s*animation:\s*none;/, 'a plain animation:none on .wv freezes the loader');
});

test('the splash ring uses the same .wv class so it gets the same treatment', () => {
  assert.match(html, /<div id="splash"[^>]*><svg class="wv"/);
});
