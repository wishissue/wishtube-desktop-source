import test from 'node:test';
import assert from 'node:assert/strict';
import { Ranker, dedupe, titleQuality, newProfile } from '../renderer/rec/engine.js';
import { detectLanguage } from '../renderer/rec/text.js';
import { creatorKey } from '../renderer/core/models.js';

const NOW = Date.UTC(2026, 10, 13);
let n = 0;
const mk = (title, o = {}) => ({ id: `peertube:h|${++n}`, source: 'peertube', sid: `h|${n}`, title, desc: o.desc || '', creator: o.creator || 'c' + n, creatorId: o.creatorId || 'c' + n,
  thumb: 'x', dur: o.dur ?? 600, date: NOW - (o.age ?? 3) * 86400000, views: o.views ?? 1000 + n * 37, tags: o.tags || [], cats: [], url: '', license: {}, ...o });

const COOK = ['Sourdough bread baking for beginners', 'How to bake crusty sourdough bread at home', 'Pasta carbonara recipe the Roman way', 'Easy homemade pizza dough and tomato sauce', 'Baking focaccia bread with olive oil', 'Knife skills every home cook needs', 'Slow cooked ragu recipe for Sunday dinner', 'Perfect croissants: lamination explained'];
const LINUX = ['Linux kernel scheduler deep dive', 'Writing a Linux kernel module in Rust', 'Fedora Linux tips for power users', 'Understanding eBPF tracing on Linux', 'Kernel debugging with gdb and QEMU', 'Systemd unit files explained'];
const MISC = ['Birdwatching in the Scottish Highlands', 'History of the Roman aqueducts', 'Ceramic glazing techniques for potters', 'Beginner chess openings guide', 'Aurora timelapse from Iceland', 'Restoring a vintage typewriter'];
const pool = () => [...COOK, ...LINUX, ...MISC].map((t, i) => mk(t, { creator: 'creator' + i, creatorId: 'cr' + i }));

function trained(r, vids, kind = 'watch') { for (const v of vids) r.record(v, kind, { completion: 0.95, seconds: 500 }, NOW - 86400000); }

test('cold start returns every video and ranks something', () => {
  const r = new Ranker(); const out = r.rank(pool(), { now: NOW });
  assert.ok(out.length >= 15); assert.ok(out.every(x => Number.isFinite(x.score)));
});

/* A realistic pool: topics share a vocabulary, but any two titles overlap very little (like real feeds). */
const TOPICS = {
  cook: 'bread bake dough pizza pasta recipe kitchen oven flour sauce cooking chef sourdough tomato cheese baking dinner homemade',
  linux: 'linux kernel rust fedora systemd debian compiler driver terminal bash shell opensource gcc ebpf patch distro',
  chess: 'chess opening endgame gambit grandmaster rook bishop tactics checkmate blitz engine tournament strategy pawn',
  birds: 'bird birdwatching owl eagle migration feather forest nest wildlife habitat sparrow ornithology binoculars',
  space: 'space rocket orbit telescope galaxy planet mars nasa astronomy cosmos launch satellite nebula',
  music: 'guitar piano chord melody band album jazz concert drums synth song lesson tuning',
};
function rng(seed) { let a = seed; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }
function synth(per = 60) {
  const r = rng(42), out = {};
  for (const [t, ws] of Object.entries(TOPICS)) {
    const w = ws.split(' '); out[t] = [];
    for (let i = 0; i < per; i++) {
      const pick = () => w[Math.floor(r() * w.length)];
      out[t].push(mk(`${pick()} ${pick()} ${['guide', 'tips', 'explained', 'for beginners', 'masterclass', 'deep dive'][Math.floor(r() * 6)]} ${pick()}`,
        { desc: `${pick()} ${pick()} ${pick()} ${pick()} ${pick()}`, creator: `${t}${i % 12}`, creatorId: `${t}${i % 12}`, views: Math.floor(r() * 50000) }));
    }
  }
  return out;
}
const flat = o => Object.values(o).flat();
const topicOf = (o, v) => Object.keys(o).find(k => o[k].includes(v));

test('semantic layer: same-topic words become similar, cross-topic words do not', async () => {
  const { vectorize, cosine } = await import('../renderer/rec/text.js');
  const T = synth(), r = new Ranker(); r.observe(flat(T));
  const V = t => vectorize(mk(t), r.corpus);
  const sCook = cosine(V('pizza dough'), V('pasta sauce')), sCross = cosine(V('pizza dough'), V('chess gambit'));
  assert.ok(sCook > sCross + 0.15, `cook-cook ${sCook.toFixed(2)} should clearly beat cook-chess ${sCross.toFixed(2)}`);
});

test('learns a topic from 3 watched videos and surfaces UNSEEN videos on that topic', () => {
  const T = synth(), p = flat(T), r = new Ranker(); r.observe(p);
  trained(r, T.cook.slice(0, 3));
  const top = r.rank(p, { now: NOW, seed: 7, limit: 12 }).slice(0, 10).map(x => topicOf(T, x.v));
  const cook = top.filter(t => t === 'cook').length;
  assert.ok(cook >= 5, `expected >=5 cooking in top 10, got ${cook}: ${top.join(',')}`);
});

test('holds TWO interests at once (multi-interest clusters)', () => {
  const T = synth(), p = flat(T), r = new Ranker(); r.observe(p);
  trained(r, T.cook.slice(0, 3)); trained(r, T.linux.slice(0, 3));
  assert.ok(r.p.clusters.length >= 2, 'should form separate clusters');
  const top = r.rank(p, { now: NOW, seed: 3, limit: 20 }).slice(0, 16).map(x => topicOf(T, x.v));
  const c = top.filter(t => t === 'cook').length, l = top.filter(t => t === 'linux').length;
  assert.ok(c >= 3 && l >= 3, `cook ${c}, linux ${l}: ${top.join(',')}`);
});

test('interest shelves: one shelf per interest, filled with that topic', () => {
  const T = synth(), p = flat(T), r = new Ranker(); r.observe(p);
  trained(r, T.cook.slice(0, 4)); trained(r, T.linux.slice(0, 4));
  const shelves = r.byInterest(p, { now: NOW });
  assert.ok(shelves.length >= 2, 'expected 2 shelves, got ' + shelves.length);
  for (const sh of shelves) { const topic = ['cook', 'linux'].find(k => sh.items.filter(v => T[k].includes(v)).length > sh.items.length * 0.6); assert.ok(topic, 'shelf should be mostly one topic: ' + sh.terms.join(',')); }
});

test('"not interested" drops that video and its neighbours', () => {
  const T = synth(), p = flat(T), r = new Ranker(); r.observe(p);
  trained(r, T.cook.slice(0, 2)); trained(r, T.linux.slice(0, 2));
  const order = () => r.rank(p, { now: NOW, seed: 1, limit: 100 }).map(x => x.v);
  const base = order(), cookVids = base.filter(v => topicOf(T, v) === 'cook');
  const targets = cookVids.slice(0, 3), probe = targets[2];
  const posOf = id => { const i = order().findIndex(v => v.id === id); return i < 0 ? 999 : i; };
  const before = posOf(probe.id);
  for (const v of targets.slice(0, 2)) r.record(v, 'hide', {}, NOW);
  assert.ok(posOf(probe.id) > before, `a neighbour of hidden videos should fall: ${before} -> ${posOf(probe.id)}`);
});

test('bounce (opened then left) is negative, finishing is positive', () => {
  const r = new Ranker(), a = mk('Quantum field theory lecture', { creatorId: 'q' }), b = mk('Quantum computing explained', { creatorId: 'q2' });
  r.observe([a, b]);
  r.record(a, 'watch', { completion: 0.02, seconds: 12 }, NOW);
  r.record(b, 'watch', { completion: 0.9, seconds: 800 }, NOW);
  assert.ok(r.p.creators[creatorKey(a)].neg > 0); assert.ok(r.p.creators[creatorKey(b)].pos > 0);
});

test('online learner moves weights toward behaviour, and stays bounded and sign-safe', () => {
  const r = new Ranker(), p = pool(); r.observe(p);
  const w0 = { ...r.p.weights };
  for (let i = 0; i < 60; i++) { r.rank(p, { now: NOW, seed: i }); r.record(p[i % p.length], 'like', {}, NOW); r.record(p[(i + 3) % p.length], 'hide', {}, NOW); }
  const w = r.p.weights;
  assert.ok(w.seen <= 0 && w.neg <= 0 && w.interest >= 0 && w.lang >= 0);
  assert.ok(Object.keys(w).some(k => Math.abs(w[k] - w0[k]) > 0.01), 'weights should adapt');
  assert.ok(Object.values(w).every(Number.isFinite));
});

test('diversity: no creator floods the top of the feed', () => {
  const r = new Ranker(); const p = [];
  for (let i = 0; i < 10; i++) p.push(mk(`Sourdough bread baking part ${i + 1} ${['crust','starter','scoring','proofing','oven','flour','salt','shaping','hydration','autolyse'][i]}`, { creator: 'Bakery', creatorId: 'bakery' }));
  for (let i = 0; i < 8; i++) p.push(mk(COOK[i % COOK.length] + ' ' + i, { creator: 'other' + i, creatorId: 'o' + i }));
  r.observe(p); trained(r, p.slice(0, 3));
  const top = r.rank(p, { now: NOW, limit: 10, seed: 2 }).slice(0, 8).map(x => x.v.creatorId);
  assert.ok(top.filter(c => c === 'bakery').length <= 4, top.join(','));
});

test('feed is stable for a given seed and varies across seeds', () => {
  const r = new Ranker(), p = pool(); r.observe(p);
  const a = r.rank(p, { now: NOW, seed: 5 }).map(x => x.v.id).join(), b = r.rank(p, { now: NOW, seed: 5 }).map(x => x.v.id).join();
  assert.equal(a, b);
});

test('dedupe collapses same talk on two sources, keeps different videos', () => {
  const a = mk('Reflections on Trusting Trust: a talk', { dur: 3600, source: 'ccc', id: 'ccc:1', creatorId: 'k' });
  const b = mk('Reflections on Trusting Trust: a talk', { dur: 3590, source: 'peertube', id: 'p:1', creatorId: 'k2', views: 90000 });
  const c = mk('Reflections on something entirely different here', { dur: 3600, creatorId: 'z' });
  const out = dedupe([a, b, c]); assert.equal(out.length, 2); assert.ok(out.some(v => v.id === 'p:1'));
});

test('language: foreign-language videos are pushed down when preferences are set', () => {
  const r = new Ranker(new Ranker().toJSON(), { languages: ['en'] });
  const en = mk('How the internet actually works under the hood', { desc: 'In this video we look at how the packets travel through the network and what is going on.' });
  const es = mk('Cómo funciona realmente internet por dentro', { desc: 'En este video vemos como los paquetes viajan por la red y que es lo que pasa en el camino.', creatorId: 'esx' });
  r.observe([en, es]);
  const out = r.rank([en, es], { now: NOW }); assert.equal(out[0].v.id, en.id);
  assert.equal(detectLanguage(es.title + '. ' + es.desc), 'es'); assert.equal(detectLanguage('東京の夜景を撮影しました。とても綺麗です'), 'ja');
});

test('evergreen sources are not punished for being old; news-like sources decay', () => {
  const r = new Ranker(), old = mk('Classic public domain film noir', { source: 'archive', age: 9000, id: 'archive:a' }), oldPt = mk('Classic public domain film noir 2', { age: 9000, id: 'peertube:z', creatorId: 'zz' });
  r.observe([old, oldPt]);
  const ctx = r._context([old, oldPt], new Set(), NOW);
  assert.ok(r.features(old, ctx, NOW).f.fresh > r.features(oldPt, ctx, NOW).f.fresh * 100);
});

test('title quality penalises shouting and spam punctuation', () => { assert.ok(titleQuality('Normal good title here') > titleQuality('YOU WON\'T BELIEVE THIS!!! SHOCKING')); });

test('profile survives JSON round trip and keeps behaving', () => {
  const r = new Ranker(), p = pool(); r.observe(p); trained(r, p.slice(0, 4));
  const r2 = new Ranker(JSON.parse(JSON.stringify(r.toJSON())));
  assert.equal(r2.p.clusters.length, r.p.clusters.length);
  assert.ok(r2.rank(p, { now: NOW }).length > 10);
});

test('scales: 1,200 candidates rank in well under a second', () => {
  const r = new Ranker(), p = []; const words = 'linux kernel rust python baking bread chess music guitar travel history science physics garden coffee cinema film art code web'.split(' ');
  for (let i = 0; i < 1200; i++) p.push(mk(`${words[i % 20]} ${words[(i * 7) % 20]} ${words[(i * 3) % 20]} episode ${i}`, { creatorId: 'c' + (i % 90), desc: words[(i * 5) % 20] }));
  r.observe(p); trained(r, p.slice(0, 5));
  const t = performance.now(); const out = r.rank(p, { now: NOW, limit: 120 }); const ms = performance.now() - t;
  console.log(`      1200 candidates ranked in ${ms.toFixed(0)} ms`); assert.ok(out.length === 120 && ms < 1500);
});
