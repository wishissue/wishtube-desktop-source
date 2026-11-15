// End-to-end download tests: real ffmpeg, real local HTTP server (with Range support), real ffprobe verification.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { Downloads } = require('../main/downloads.cjs');
const { locate, probe } = require('../main/media/ffmpeg.cjs');
const { parseMaster } = require('../main/media/hls.cjs');

const FF = locate().ffmpeg;
const skip = !FF && 'ffmpeg not available';
let srv, base, media, out, failOnce = new Set(), hits = {};

const ff = (...a) => execFileSync(FF, ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
before(async () => {
  if (skip) return;
  media = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-media-')); out = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-out-'));
  const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6'];
  ff(...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(media, 'muxed.mp4'));
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(media, 'video-only.mp4'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', path.join(media, 'audio-only.m4a'));
  ff('-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=6', '-c:v', 'libvpx-vp9', '-b:v', '200k', path.join(media, 'video-vp9.webm'));
  ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'libopus', path.join(media, 'audio-opus.webm'));
  // HLS: video-only rendition + separate audio rendition, the layout that makes naive downloaders save audio-only / silent files
  ff('-i', path.join(media, 'video-only.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(media, 'v%d.ts'), path.join(media, 'v.m3u8'));
  ff('-i', path.join(media, 'audio-only.m4a'), '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_playlist_type', 'vod', '-hls_segment_filename', path.join(media, 'a%d.ts'), path.join(media, 'a.m3u8'));
  fs.writeFileSync(path.join(media, 'master.m3u8'), '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="a",DEFAULT=YES,URI="a.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=320x240,AUDIO="aud"\nv.m3u8\n');
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), name = u.pathname.slice(1); hits[name] = (hits[name] || 0) + 1;
    if (failOnce.has(name)) { failOnce.delete(name); res.writeHead(503); return res.end('busy'); }
    const f = path.join(media, path.basename(name));
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const size = fs.statSync(f).size, m = /bytes=(\d+)-/.exec(req.headers.range || '');
    const type = f.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'application/octet-stream';
    if (m) { const s = +m[1]; if (s >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${size - 1}/${size}`, 'Content-Length': size - s }); return fs.createReadStream(f, { start: s }).pipe(res); }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${srv.address().port}/`;
});
after(() => { srv?.close(); if (media) fs.rmSync(media, { recursive: true, force: true }); if (out) fs.rmSync(out, { recursive: true, force: true }); });

const mgr = () => new Downloads({ app: {}, getWin: () => null, ua: 'WishTube-test', getDir: () => out, store: null, allowLocal: true });
const finish = (m, id, ms = 40000) => new Promise((res, rej) => {
  const t0 = Date.now(), iv = setInterval(() => { const it = m.get(id); if (['done', 'error', 'cancelled', 'paused'].includes(it.state)) { clearInterval(iv); res(it); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout in state ' + it.state)); } }, 50);
});

test('muxed mp4 downloads and verifies with audio + video', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Muxed', option: { kind: 'muxed', url: base + 'muxed.mp4', ext: 'mp4', height: 240 }, format: 'best' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
  const p = await probe(it.file); assert.equal(p.video.length, 1); assert.equal(p.audio.length, 1); assert.ok(it.verified); assert.match(it.file, /Muxed \(240p\)\.mp4$/);
});

test('split video + audio are merged into ONE file containing both streams', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Split', option: { kind: 'split', url: base + 'video-only.mp4', audioUrl: base + 'audio-only.m4a', ext: 'mp4', height: 240 }, format: 'mp4' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
  const p = await probe(it.file); assert.equal(p.video.length, 1, 'video stream'); assert.equal(p.audio.length, 1, 'audio stream'); assert.ok(p.duration > 4);
  assert.ok(!fs.readdirSync(out).some(f => f.startsWith('Split') && f.endsWith('.part')), 'temp parts removed');
});

test('VP9 + Opus split streams merge (webm) without re-encoding', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Webm', option: { kind: 'split', url: base + 'video-vp9.webm', audioUrl: base + 'audio-opus.webm', ext: 'webm', height: 240 }, format: 'webm' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
  const p = await probe(it.file); assert.equal(p.video[0].codec, 'vp9'); assert.equal(p.audio[0].codec, 'opus'); assert.match(it.file, /\.webm$/);
});

test('VP9 + Opus asked as MP4 falls back to Matroska instead of failing', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Fallback', option: { kind: 'split', url: base + 'video-vp9.webm', audioUrl: base + 'audio-opus.webm', ext: 'mp4', height: 240 }, format: 'mp4' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error); const p = await probe(it.file); assert.equal(p.video.length + p.audio.length, 2);
});

test('HLS with a separate audio rendition downloads with sound', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Hls', dur: 6, option: { kind: 'hls', url: base + 'master.m3u8', height: 240 }, format: 'mp4' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
  const p = await probe(it.file); assert.equal(p.video.length, 1); assert.equal(p.audio.length, 1, 'HLS audio rendition must be merged in');
});

test('a video-only file is rejected, not reported as done', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Silent', option: { kind: 'muxed', url: base + 'video-only.mp4', ext: 'mp4' }, format: 'best' });
  const it = await finish(m, id); assert.equal(it.state, 'error'); assert.match(it.error, /no audio track/); assert.equal(it.file && fs.existsSync(it.file), false);
});

test('audio extraction: mp3, m4a (stream copy) and opus', { skip }, async () => {
  for (const [fmt, codec] of [['mp3', 'mp3'], ['m4a', 'aac'], ['opus', 'opus']]) {
    const m = mgr(), id = m.start({ title: 'Song ' + fmt, dur: 6, option: { kind: 'muxed', url: base + 'muxed.mp4', ext: 'mp4' }, format: fmt });
    const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
    const p = await probe(it.file); assert.equal(p.video.length, 0); assert.equal(p.audio[0].codec, codec); assert.match(it.file, new RegExp(`\\.${fmt}$`));
  }
});

test('transient server errors are retried', { skip }, async () => {
  failOnce.add('muxed.mp4'); const m = mgr(), id = m.start({ title: 'Retry', option: { kind: 'muxed', url: base + 'muxed.mp4', ext: 'mp4' }, format: 'best' });
  const it = await finish(m, id); assert.equal(it.state, 'done', it.error);
});

test('404 fails fast with a clear error and retry re-queues', { skip }, async () => {
  const m = mgr(), id = m.start({ title: 'Missing', option: { kind: 'muxed', url: base + 'nope.mp4', ext: 'mp4' }, format: 'best' });
  const it = await finish(m, id); assert.equal(it.state, 'error'); assert.match(it.error, /404/);
  assert.equal(m.retry(id), true); assert.equal(m.get(id).state === 'queued' || m.get(id).state === 'active', true); await finish(m, id);
});

test('pause keeps the partial file and resume continues with a Range request', { skip }, async () => {
  const big = path.join(media, 'big.bin'); fs.writeFileSync(big, Buffer.alloc(32 * 1024 * 1024, 7));
  // slow server for this one file so there is time to pause mid-transfer
  const slow = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || ''), s = m ? +m[1] : 0, size = fs.statSync(big).size;
    hits.ranges = (hits.ranges || []).concat(m ? s : 0);
    res.writeHead(m ? 206 : 200, { 'Content-Length': size - s, ...(m ? { 'Content-Range': `bytes ${s}-${size - 1}/${size}` } : {}) });
    const rs = fs.createReadStream(big, { start: s, highWaterMark: 64 * 1024 }); rs.on('data', c => { res.write(c); rs.pause(); setTimeout(() => rs.resume(), 12); }); rs.on('end', () => res.end());
    res.on('close', () => rs.destroy());
  });
  await new Promise(r => slow.listen(0, '127.0.0.1', r));
  try {
    const m = mgr(), id = m.start({ title: 'Big', option: { kind: 'muxed', url: `http://127.0.0.1:${slow.address().port}/big.bin`, ext: 'bin' }, format: 'best' });
    await new Promise(r => setTimeout(r, 400)); assert.equal(m.pause(id), true);
    const paused = await finish(m, id); assert.equal(paused.state, 'paused'); const part = paused.file + '.part'; assert.ok(fs.statSync(part).size > 0, 'partial file kept');
    const keep = fs.statSync(part).size; hits.ranges = [];
    m.resume(id); await new Promise(r => setTimeout(r, 200)); assert.ok(hits.ranges[0] >= keep, `resumed from byte ${hits.ranges[0]} (had ${keep})`);
    assert.equal(m.cancel(id), true); const c = await finish(m, id); assert.equal(c.state, 'cancelled'); assert.equal(fs.existsSync(part), false, 'cancel removes the partial file');
  } finally { slow.close(); }
});

test('speed, progress and history are tracked and exposed', { skip }, async () => {
  const saved = {}, store = { get: (k, d) => saved[k] ?? d, set: (k, v) => { saved[k] = JSON.parse(JSON.stringify(v)); } };
  const m = new Downloads({ app: {}, getWin: () => null, ua: 't', getDir: () => out, store, allowLocal: true });
  const id = m.start({ title: 'History', creator: 'Me', option: { kind: 'muxed', url: base + 'muxed.mp4', ext: 'mp4', height: 240 }, format: 'best' }); await finish(m, id);
  assert.equal(saved.downloads.length >= 1, true); const m2 = new Downloads({ app: {}, getWin: () => null, ua: 't', getDir: () => out, store, allowLocal: true });
  assert.equal(m2.get(id).state, 'done'); assert.equal(m2.get(id).quality, '240p'); assert.ok(m2.get(id).streams.audio);
  assert.equal(m2.start({ title: 'x', option: { kind: 'muxed', url: base + 'muxed.mp4' }, format: 'best' }) > '', true);
});

test('IPC input is validated: file:, private hosts, bad formats, bad kinds', () => {
  const m = new Downloads({ app: {}, getWin: () => null, ua: 't', getDir: () => os.tmpdir(), store: null });
  for (const bad of [
    { option: { kind: 'muxed', url: 'file:///etc/passwd' } }, { option: { kind: 'muxed', url: 'http://127.0.0.1/x.mp4' } }, { option: { kind: 'muxed', url: 'http://192.168.1.5/x.mp4' } },
    { option: { kind: 'muxed', url: 'https://example.com/x.mp4' }, format: 'exe' }, { option: { kind: 'shell', url: 'https://example.com/x' } }, { option: { kind: 'split', url: 'https://example.com/v.mp4' } }, null, {},
  ]) assert.throws(() => m.validate(bad), undefined, JSON.stringify(bad));
  assert.doesNotThrow(() => m.validate({ option: { kind: 'hls', url: 'https://example.com/master.m3u8' }, format: 'mp3' }));
});

test('HLS master parser pairs audio renditions with variants', () => {
  const v = parseMaster('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",DEFAULT=YES,URI="aud.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720,AUDIO="a"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=640x360,AUDIO="a"\n360.m3u8', 'https://h/p/m.m3u8');
  assert.deepEqual(v.map(x => x.height), [720, 360]); assert.equal(v[0].audioUrl, 'https://h/p/aud.m3u8'); assert.equal(parseMaster('#EXTM3U\n#EXTINF:4,\nseg.ts', 'https://h/x.m3u8'), null);
});
