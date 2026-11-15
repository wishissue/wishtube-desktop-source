import test from 'node:test';
import assert from 'node:assert/strict';
import { sortComments, filterComments, topMeaningful } from '../renderer/core/comments.js';
import { WISHISSUE } from '../renderer/core/credits.js';
import { peertube } from '../renderer/sources/adapters.js';
import { isShort, isMusic } from '../renderer/core/models.js';

const C = [{ id: 'a', user: 'Ann', text: 'cats are great', date: 100, likes: 2, replies: 0 }, { id: 'b', user: 'Bob', text: 'dogs', date: 300, likes: 9, replies: 3 }, { id: 'c', user: 'Cy', text: 'birds', date: 200, likes: null, replies: 1 }];

test('comments: sorting newest / oldest / top, and search by text or user', () => {
  assert.deepEqual(sortComments(C, 'new').map(c => c.id), ['b', 'c', 'a']); assert.deepEqual(sortComments(C, 'old').map(c => c.id), ['a', 'c', 'b']);
  assert.deepEqual(sortComments(C, 'top').map(c => c.id), ['b', 'a', 'c']);
  assert.deepEqual(filterComments(C, 'DOGS').map(c => c.id), ['b']); assert.deepEqual(filterComments(C, 'ann').map(c => c.id), ['a']); assert.equal(filterComments(C, '  ').length, 3);
  assert.equal(topMeaningful([{ likes: null, replies: 0 }]), false, 'no likes/replies from the provider: Top means nothing'); assert.equal(topMeaningful(C), true);
  const copy = [...C]; sortComments(C, 'old'); assert.deepEqual(C, copy, 'sorting does not mutate');
});

test('credits: links match the ones published in wishissue/wishy-apps, all https', () => {
  assert.deepEqual(WISHISSUE, { github: 'https://github.com/wishissue', youtube: 'https://www.youtube.com/@wishismachine', discord: 'https://discord.com/invite/B5scEa987Y', donate: 'https://ko-fi.com/wishismachine' });
  for (const u of Object.values(WISHISSUE)) assert.equal(new URL(u).protocol, 'https:');
});

test('PeerTube: portrait / music / shorts come only from what the instance reports', () => {
  const base = { uuid: 'u1', name: 'x', duration: 30, channel: { name: 'c', host: 'h.tld' }, publishedAt: '2024-01-01T00:00:00Z' }, S = { mature: false };
  assert.equal(peertube.parse({ ...base }, 'https://h.tld', S).portrait, undefined, 'no aspectRatio reported: unknown, not guessed');
  assert.equal(isShort(peertube.parse({ ...base }, 'https://h.tld', S)), false, 'a 30s video is not a Short by duration alone');
  assert.equal(isShort(peertube.parse({ ...base, aspectRatio: 0.56 }, 'https://h.tld', S)), true);
  assert.equal(isShort(peertube.parse({ ...base, aspectRatio: 1.78 }, 'https://h.tld', S)), false);
  assert.equal(isShort(peertube.parse({ ...base, tags: ['Shorts'] }, 'https://h.tld', S)), true);
  assert.equal(isMusic(peertube.parse({ ...base, category: { id: 1, label: 'Music' } }, 'https://h.tld', S)), true);
  assert.equal(isMusic(peertube.parse({ ...base, name: 'my music mix' }, 'https://h.tld', S)), false);
});

test('adapters declare capabilities honestly: only providers with an API have comments / music / shorts', () => {
  assert.ok(peertube.caps.comments && peertube.caps.music && peertube.caps.shorts);
  assert.equal(typeof peertube.comments, 'function'); assert.equal(typeof peertube.music, 'function'); assert.equal(typeof peertube.shorts, 'function');
});
