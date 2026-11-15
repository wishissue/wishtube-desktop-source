import test from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from '../renderer/core/queue.js';
import { isShort, isMusic, kindOf } from '../renderer/core/models.js';

const T = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i, title: 'Track ' + i }));
const ids = q => q.items.map(x => x.id).join(',');

test('queue: sequential next/prev, end of queue, repeat all / one', () => {
  const q = new Queue(T(3)); assert.equal(q.current.id, 't0');
  assert.equal(q.next().id, 't1'); assert.equal(q.next().id, 't2'); assert.equal(q.next(true), null, 'ends without repeat');
  q.setRepeat('all'); assert.equal(q.next(true).id, 't0', 'wraps with repeat all');
  q.setRepeat('one'); assert.equal(q.next(true).id, 't0', 'auto-advance replays with repeat one'); assert.equal(q.next(false).id, 't1', 'manual skip still moves on');
  assert.equal(q.prev().id, 't0'); assert.equal(q.prev().id, 't0', 'prev at start stays put');
  assert.equal(q.cycleRepeat(), 'off'); assert.equal(q.cycleRepeat(), 'all');
});

test('queue: shuffle plays every item exactly once, current first, and survives edits', () => {
  const q = new Queue(T(20), 5); q.setShuffle(true); const seen = [q.current.id];
  for (let n = q.next(true); n; n = q.next(true)) seen.push(n.id);
  assert.equal(new Set(seen).size, 20); assert.equal(seen[0], 't5'); q.setRepeat('all');
  const again = new Set(); for (let i = 0; i < 20; i++) { again.add(q.current.id); q.next(true); } assert.equal(again.size, 20, 'a repeat-all shuffle lap also visits everything once');
  q.add({ id: 'x' }); q.remove(0); assert.ok(q.current);
});

test('queue: add, play next, dedupe, remove, move keep the current item', () => {
  const q = new Queue(T(4), 1);
  q.add({ id: 'n' }, { next: true }); assert.equal(ids(q), 't0,t1,n,t2,t3'); assert.equal(q.current.id, 't1');
  q.add({ id: 't3' }, { next: true }); assert.equal(ids(q), 't0,t1,t3,n,t2', 'existing item moves instead of duplicating');
  q.add({ id: 'e' }); assert.equal(q.items.at(-1).id, 'e');
  q.move(0, 4); assert.equal(q.current.id, 't1'); q.remove(q.items.indexOf(q.current)); assert.ok(q.current, 'removing the playing item lands on a neighbour');
  const empty = new Queue(); empty.add({ id: 'a' }); assert.equal(empty.current.id, 'a'); empty.remove(0); assert.equal(empty.current, null); assert.equal(empty.next(), null);
});

test('queue: survives JSON round trip', () => {
  const q = new Queue(T(5), 2); q.setShuffle(true); q.setRepeat('all'); const r = Queue.from(JSON.parse(JSON.stringify(q)));
  assert.equal(r.current.id, 't2'); assert.equal(r.shuffle, true); assert.equal(r.repeat, 'all');
});

test('Shorts need provider metadata: duration alone is never enough', () => {
  assert.equal(isShort({ dur: 30 }), false, 'a 30s landscape clip is not a Short');
  assert.equal(isShort({ dur: 30, portrait: false }), false);
  assert.equal(isShort({ dur: 30, portrait: true }), true, 'provider reported portrait');
  assert.equal(isShort({ dur: 900, portrait: true }), false, 'too long to be a Short');
  assert.equal(isShort({ dur: 40, tags: ['#Shorts'] }), true, 'explicit tag');
  assert.equal(isShort({ dur: 3000, tags: ['shorts'] }), false);
  assert.equal(isShort({ portrait: true }), false, 'portrait with unknown duration is not enough');
});

test('Music needs provider category/tag/collection; Shorts and Music never overlap', () => {
  assert.equal(isMusic({ cats: ['Music'] }), true); assert.equal(isMusic({ tags: ['Music', 'rock'] }), true); assert.equal(isMusic({ music: true }), true);
  assert.equal(isMusic({ cats: ['Education'], tags: ['lecture'] }), false); assert.equal(isMusic({ title: 'Official music video' }), false, 'title words do not count');
  assert.equal(kindOf({ cats: ['Music'], portrait: true, dur: 20 }), 'shorts'); assert.equal(kindOf({ cats: ['Music'] }), 'music'); assert.equal(kindOf({}), 'video');
});
