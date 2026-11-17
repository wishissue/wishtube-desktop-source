import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { CATS, KINDS, pickCat } from '../renderer/core/cats.js';

const R = p => new URL('../renderer/' + p, import.meta.url);
const read = p => readFileSync(R(p), 'utf8');
const uiFiles = ['app.js', ...readdirSync(R('ui/')).map(f => 'ui/' + f)];

test('every cat image exists on disk', () => {
  for (const [id, c] of Object.entries(CATS)) assert.ok(existsSync(R('assets/cats/' + c.f)), `${id} -> ${c.f}`);
});

test('every kind points at real cats and has enough jokes', () => {
  for (const [k, v] of Object.entries(KINDS)) {
    assert.ok(v.cats.length && v.cats.every(c => CATS[c]), `${k} has unknown cat`);
    assert.ok(v.head && v.jokes.length >= 2 && v.jokes.every(j => j.trim()), `${k} needs a headline and 2+ jokes`);
  }
});

test('every cat in the pack is used by at least one screen', () => {
  const used = new Set(Object.values(KINDS).flatMap(k => k.cats));
  assert.deepEqual(Object.keys(CATS).filter(c => !used.has(c)), []);
});

test('the same joke never shows twice in a row', () => {
  for (const k of Object.keys(KINDS)) { let prev = null; for (let i = 0; i < 40; i++) { const j = pickCat(k).joke; assert.notEqual(j, prev, k); prev = j; } }
});

test('every cat kind named in the UI exists', () => {
  const used = new Set();
  for (const f of uiFiles) {
    const s = read(f);
    for (const m of s.matchAll(/catPanel\(\s*(?:[^'"(),]*\?\s*)?'([a-z]+)'(?:\s*:\s*'([a-z]+)')?/g)) { used.add(m[1]); if (m[2]) used.add(m[2]); }
    for (const m of s.matchAll(/toast\([^;]*?,\s*\d+,\s*'([a-z]+)'\)/g)) used.add(m[1]);
    for (const m of s.matchAll(/pickCat\('([a-z]+)'\)/g)) used.add(m[1]);
    for (const m of s.matchAll(/catThumb\('([a-z]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 12, 'expected the UI to use many kinds, found ' + used.size);
  assert.deepEqual([...used].filter(k => !KINDS[k]), []);
});

test('loading never shows the app icon', () => {
  assert.ok(!/logo-128|\.png/.test(read('ui/terminal.js')), 'terminal.js must not reference an image icon');
  assert.ok(!/logo-128/.test(read('index.html')), 'the splash must not use the app icon');
  assert.ok(/class="wv"/.test(read('index.html')), 'splash uses the wavy ring');
  assert.ok(!/class="(ring|lring|lmark)"/.test(read('index.html')));
});

test('no plain empty-state boxes are left for errors', () => {
  const left = uiFiles.flatMap(f => [...read(f).matchAll(/h\('div\.empty'/g)].map(() => f));
  assert.deepEqual(left, []);
});
