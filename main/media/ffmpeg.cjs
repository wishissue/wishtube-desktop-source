'use strict';
// FFmpeg / ffprobe helpers. Binaries come from ffmpeg-static / ffprobe-static (unpacked from the asar), falling back to PATH.
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');

const unasar = p => (p ? p.replace('app.asar' + require('node:path').sep, 'app.asar.unpacked' + require('node:path').sep) : p);
function bundled(mod, pick) { try { const p = unasar(pick(require(mod))); return p && fs.existsSync(p) ? p : null; } catch { return null; } }
const os = require('node:os'), path = require('node:path');
const works = bin => { try { return spawnSync(bin, ['-version'], { timeout: 8000 }).status === 0; } catch { return false; } };

/** `-version` passing proves little: some static builds start fine and then crash on real input. Remux a tiny MPEG-TS clip to MP4 to prove the binary is usable. */
function selfTest(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-ff-')), ts = path.join(dir, 't.ts'), mp4 = path.join(dir, 't.mp4');
  try {
    const run = a => spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...a], { timeout: 15000 }).status === 0;
    return run(['-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5:duration=0.4', '-f', 'lavfi', '-i', 'sine=duration=0.4', '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpegts', ts])
      && run(['-i', ts, '-c', 'copy', '-f', 'mp4', mp4]) && fs.existsSync(mp4);
  } catch { return false; } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

let cache = null;
function locate(force) {
  if (cache && !force) return cache;
  const probeBin = (bundledPath, name, test) => { for (const c of [bundledPath, name]) if (c && works(c) && (!test || selfTest(c))) return c; return null; };
  const ffmpeg = probeBin(bundled('ffmpeg-static', m => m), 'ffmpeg', true);
  const ffprobe = probeBin(bundled('ffprobe-static', m => m.path), 'ffprobe', false);
  cache = { ffmpeg, ffprobe };
  return cache;
}

// Only network protocols: a hostile playlist must never be able to read local files.
const SAFE_IN = ['-protocol_whitelist', 'http,https,tcp,tls,crypto'];
/** Arguments for one network input: http(s) only, with our User-Agent. */
const netIn = (url, ua) => [...SAFE_IN, ...(ua ? ['-user_agent', ua] : []), '-i', url];

/** Runs ffmpeg and reports progress through onProgress({ timeSec, size }). Returns { promise, kill, pause, resume }. */
function runFfmpeg(args, { onProgress } = {}) {
  const bin = locate().ffmpeg; if (!bin) { const e = new Error('FFmpeg was not found. Reinstall WishTube or install ffmpeg.'); e.code = 'NO_FFMPEG'; return { promise: Promise.reject(e), kill() {}, pause() { return false; }, resume() { return false; } }; }
  const full = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-y', ...args];
  const p = spawn(bin, full, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let err = '', buf = '', killed = false;
  p.stderr.on('data', d => { err = (err + d).slice(-4000); });
  p.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const m = /^(out_time_us|out_time_ms|total_size)=(\d+)/.exec(line);
      if (m && onProgress) { if (m[1] === 'total_size') onProgress({ size: +m[2] }); else onProgress({ timeSec: +m[2] / 1e6 }); }
    }
  });
  const promise = new Promise((res, rej) => {
    p.on('error', rej);
    p.on('close', code => (killed ? rej(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' })) : code === 0 ? res() : rej(new Error((err.trim().split('\n').pop() || 'ffmpeg failed') + ` (exit ${code})`))));
  });
  return {
    promise, kill() { killed = true; p.kill('SIGKILL'); },
    pause() { if (process.platform === 'win32') return false; try { p.kill('SIGSTOP'); return true; } catch { return false; } },
    resume() { if (process.platform === 'win32') return false; try { p.kill('SIGCONT'); return true; } catch { return false; } },
  };
}

/** Streams actually present in a file. Used to verify a finished download. */
function probe(file, { remote = false } = {}) {
  return new Promise((resolve, reject) => {
    const bin = locate().ffprobe; if (!bin) return reject(Object.assign(new Error('ffprobe not found'), { code: 'NO_FFPROBE' }));
    const p = spawn(bin, ['-v', 'error', '-protocol_whitelist', remote ? 'http,https,tcp,tls,crypto' : 'file', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true });
    let out = '', err = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || 'ffprobe failed'));
      try {
        const j = JSON.parse(out), s = j.streams || [];
        resolve({ video: s.filter(x => x.codec_type === 'video' && x.disposition?.attached_pic !== 1).map(x => ({ codec: x.codec_name, width: x.width, height: x.height })),
          audio: s.filter(x => x.codec_type === 'audio').map(x => ({ codec: x.codec_name })), duration: Number(j.format?.duration) || 0, size: Number(j.format?.size) || 0 });
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { locate, runFfmpeg, probe, SAFE_IN, netIn };
