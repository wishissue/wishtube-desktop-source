import test from 'node:test';
import assert from 'node:assert/strict';
import { trace } from '../renderer/core/trace.js';
import { feedFilter, freshen, capPerCreator, mutedMatcher, pickQueries, feedSettings } from '../renderer/rec/filters.js';
import { scorePopularity, rankMusic } from '../renderer/rec/musicrank.js';

const v = (id, o = {}) => ({ id, title: 'A normal video title', creator: 'c' + id, source: 'peertube', creatorId: 'c' + id, dur: 600, thumb: 'x', date: Date.now(), tags: [], ...o });

test('trace folds identical lines, keeps scopes apart and notifies subscribers', () => {
  const seen = []; const off = trace.on(e => seen.push(e.msg));
  trace.info('t1', 'hello'); trace.info('t1', 'hello'); trace.warn('t2', 'other'); off();
  assert.equal(trace.query('t1').length, 1); assert.equal(trace.query('t1')[0].count, 2); assert.equal(trace.query('t2').length, 1); assert.ok(seen.length >= 2);
});

test('feed filters: length, age, watched, muted words, thumbnails, clickbait', () => {
  const now = Date.now(), S = { feed: { lengths: ['long'], maxAge: 30, hideWatched: true, muted: ['Minecraft'], needThumb: true } };
  const list = [v('a', { dur: 3000 }), v('b', { dur: 100 }), v('c', { dur: 3000, date: now - 90 * 86400000 }), v('d', { dur: 3000 }), v('e', { dur: 3000, title: 'Playing minecraft today' }), v('f', { dur: 3000, thumb: '' }), v('g', { dur: 0 }), v('h', { dur: 3000, title: 'WOW!!! AMAZING!!! CLICK NOW!!!' })];
  const out = feedFilter(list, S, { watched: { d: 0.95 }, now }).map(x => x.id);
  assert.deepEqual(out, ['a', 'g']);
  assert.equal(feedFilter([v('x')], {}, {}).length, 1, 'defaults keep normal videos');
});

test('muted matcher uses whole words, so "art" does not hide "party"', () => {
  const m = mutedMatcher(['art']); assert.ok(m(v('1', { title: 'Digital art tips' }))); assert.ok(!m(v('2', { title: 'A party' })));
});

test('freshen puts roughly the requested share of never-shown videos in the first screen, spread out, losing nothing', () => {
  const ranked = Array.from({ length: 40 }, (_, i) => ({ v: v('v' + i) })), fresh = new Set(ranked.slice(20).map(r => r.v.id));
  const out = freshen(ranked, fresh, { share: 0.5, window: 20 });
  assert.equal(out.length, 40); assert.equal(new Set(out.map(r => r.v.id)).size, 40);
  const head = out.slice(0, 20), n = head.filter(r => fresh.has(r.v.id)).length; assert.ok(n >= 9 && n <= 11, 'got ' + n);
  assert.ok(head.slice(0, 4).some(r => !fresh.has(r.v.id)), 'not clumped at the start');
  assert.equal(freshen(ranked, new Set(), { share: 0.5 }), ranked);
});

test('capPerCreator limits one creator', () => {
  const r = ['a', 'a', 'a', 'b'].map((c, i) => ({ v: v('x' + i, { creator: c, creatorId: c }) })); assert.equal(capPerCreator(r, 2).length, 3); assert.equal(capPerCreator(r, 0).length, 4);
});

test('pickQueries mixes your topics with random ones and differs between calls', () => {
  const pool = Array.from({ length: 30 }, (_, i) => 't' + i), seen = new Set();
  for (let i = 0; i < 12; i++) { const q = pickQueries({ topics: ['mine'], pool, random: Math.random }); assert.ok(q.includes('mine')); assert.equal(q.length, 3); seen.add(q.join()); }
  assert.ok(seen.size > 4);
});

test('music: popular, track-length, song-like items lead; junk and clips sink; order changes with the seed', () => {
  const good = Array.from({ length: 10 }, (_, i) => v('g' + i, { source: 'peertube', views: 1e6 - i * 1e4, dur: 210, title: 'Song ' + i, thumb: 't' }));
  const junk = Array.from({ length: 10 }, (_, i) => v('j' + i, { source: 'peertube', views: 100 + i, dur: 7200, title: 'Podcast interview ' + i, thumb: 't' }));
  const all = [...good, ...junk, v('clip', { source: 'odysee', dur: 12, title: 'x' })]; scorePopularity(good); scorePopularity(junk);
  const orders = new Set(); let total = 0, min = 10; const N = 40;
  for (let seed = 1; seed <= N; seed++) {
    const out = rankMusic(all, { seed }).map(x => x.id); orders.add(out.join());
    const g = out.slice(0, 10).filter(id => id.startsWith('g')).length; total += g; min = Math.min(min, g);
    assert.ok(out.indexOf('clip') > 12, 'sub-45s clips sink');
  }
  assert.ok(total / N >= 6.5, 'on average about 7 of the first 10 are the good tracks, got ' + total / N); assert.ok(min >= 4, 'never mostly junk, worst was ' + min);
  assert.ok(orders.size > 1, 'a different seed gives a different order');
  assert.deepEqual(rankMusic(all, { seed: 3 }).map(x => x.id), rankMusic(all, { seed: 3 }).map(x => x.id), 'same seed is stable while browsing');
  assert.deepEqual(rankMusic([v('o', { date: 1 }), v('n', { date: 9 })], { sort: 'new' }).map(x => x.id), ['n', 'o']);
});

test('settings defaults deep-merge so old saves get the new Feed options', () => {
  const f = feedSettings({ feed: { perCreator: 1, shelves: { follows: false } } });
  assert.equal(f.perCreator, 1); assert.equal(f.shelves.follows, false); assert.equal(f.shelves.continue, true); assert.equal(f.autoRefresh, 'open');
});
