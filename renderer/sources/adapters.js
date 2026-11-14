import { qs, parseDate, stripHtml, parseLicense } from '../core/models.js';

const J = (url, o) => window.wt.json(url, o);
const PAGE = 20;
const MATURE_TAGS = ['mature', 'porn', 'nsfw', 'xxx'];

/* ------------------------------ PeerTube ------------------------------ */
export const peertube = {
  id: 'peertube',
  caps: { download: true, captions: true, chapters: true },
  defaults: ['https://framatube.org', 'https://video.blender.org', 'https://peer.tube'],
  parse(o, base, S) {
    if (!o || !o.uuid) return null;
    if (!S.mature && (o.nsfw === true || o.nsfw === 'true' || o.nsfw === 1)) return null;
    const ch = o.channel || {}, ac = o.account || {};
    const host = ch.host || ac.host, name = ch.name || ac.name;
    if (!host || !name || !o.name) return null;
    return {
      id: `peertube:${host}|${o.uuid}`, source: 'peertube', sid: `${host}|${o.uuid}`,
      title: o.name, desc: o.description || '', creator: ch.displayName || ac.displayName || name, creatorId: `${name}@${host}`,
      thumb: o.thumbnailUrl || (o.thumbnailPath ? base + o.thumbnailPath : null), dur: o.duration || 0,
      date: parseDate(o.publishedAt), views: o.views ?? null, tags: o.tags || [], cats: o.category?.label ? [o.category.label] : [],
      url: o.url || `https://${host}/w/${o.uuid}`, license: parseLicense(o.licence?.label),
      lang: o.language?.id || null,
    };
  },
  async search(q, page, sort, S) {
    const s = { relevance: '-match', newest: '-publishedAt', oldest: 'publishedAt', popular: '-views' }[sort] || '-match';
    const r = await J(qs('https://sepiasearch.org/api/v1/search/videos', { search: q, start: page * PAGE, count: PAGE, sort: s, nsfw: S.mature ? 'true' : 'false' }));
    return (r.data || []).map(o => this.parse(o, 'https://sepiasearch.org', S)).filter(Boolean);
  },
  async feed(page, kind, S) {
    const insts = [...new Set([S.ptInstance, ...this.defaults].filter(Boolean))];
    const n = 20, sort = kind === 'new' ? '-publishedAt' : '-trending';
    const lists = await Promise.all(insts.map(i => J(qs(`${i}/api/v1/videos`, { start: page * n, count: n, sort, nsfw: S.mature ? 'true' : 'false' }))
      .then(r => (r.data || []).map(o => this.parse(o, i, S)).filter(Boolean)).catch(() => [])));
    return lists.flat();
  },
  async creatorVideos(cid, page, S) {
    const base = `https://${cid.split('@')[1]}`;
    const r = await J(qs(`${base}/api/v1/video-channels/${cid}/videos`, { start: page * PAGE, count: PAGE, sort: '-publishedAt' }));
    return (r.data || []).map(o => this.parse(o, base, S)).filter(Boolean);
  },
  async creatorInfo(cid) {
    const host = cid.split('@')[1];
    const o = await J(`https://${host}/api/v1/video-channels/${cid}`);
    const av = (o.avatars || []).at(-1)?.path || o.avatar?.path;
    return { name: o.displayName || cid.split('@')[0], desc: o.description || '', avatar: av ? `https://${host}${av}` : null, followers: o.followersCount ?? null, url: o.url };
  },
  async resolveStream(v) {
    const [host, uuid] = v.sid.split('|'), api = `https://${host}/api/v1/videos/${uuid}`;
    const abs = u => (u && u.startsWith('/') ? `https://${host}${u}` : u);
    const [o, caps, chap, desc] = await Promise.all([
      J(api),
      J(`${api}/captions`).then(r => (r.data || []).map(c => ({ url: abs(c.captionPath), lang: c.language?.id || 'und', label: c.language?.label || 'Captions' }))).catch(() => []),
      J(`${api}/chapters`).then(r => (r.chapters || []).map(c => ({ t: c.timecode, title: c.title }))).catch(() => []),
      J(`${api}/description`).then(r => r.description).catch(() => null),
    ]);
    const files = (o.files || o.webVideoFiles || []).filter(f => f.fileUrl).sort((a, b) => (b.resolution?.id || 0) - (a.resolution?.id || 0));
    const hls = abs(o.streamingPlaylists?.[0]?.playlistUrl);
    const mp4 = files.map(f => abs(f.fileUrl));
    const urls = [hls, ...mp4].filter(Boolean);
    if (!urls.length) throw new Error('No playable stream (private, live or restricted)');
    return { urls, hls: !!hls, download: abs(files[0]?.fileDownloadUrl) || mp4[0] || null, captions: caps, chapters: chap, desc };
  },
  async resolveUrl(url, S) {
    const u = new URL(url), seg = u.pathname.split('/').filter(Boolean);
    const id = seg[0] === 'w' ? seg[1] : seg[0] === 'videos' && seg[1] === 'watch' ? seg[2] : null;
    if (!id) return null;
    return this.parse(await J(`https://${u.host}/api/v1/videos/${id}`), `https://${u.host}`, S);
  },
};

/* ------------------------------- Odysee ------------------------------- */
const ODY = 'https://api.na-backend.odysee.com/api/v1/proxy';
const rpc = async (method, params) => (await J(`${ODY}?m=${method}`, { body: JSON.stringify({ jsonrpc: '2.0', method, id: 1, params }) })).result;
export const odysee = {
  id: 'odysee',
  caps: { download: true },
  base(S, page, extra) {
    return { page_size: PAGE, page: page + 1, claim_type: ['stream'], stream_types: ['video'], has_source: true, no_totals: true, ...(S.mature ? {} : { not_tags: MATURE_TAGS }), ...extra };
  },
  parse(o, S) {
    const v = o?.value; if (!v) return null;
    if (!S.mature && (v.tags || []).some(t => MATURE_TAGS.includes(String(t).toLowerCase()))) return null;
    if (Number(v.fee?.amount) > 0) return null;                    // paid content is not supported
    const sd = v.source?.sd_hash; if (!sd || !o.name || !o.claim_id) return null;
    const ch = o.signing_channel, chName = ch?.name || '@anonymous';
    return {
      id: `odysee:${o.claim_id}`, source: 'odysee', sid: `${o.name}|${o.claim_id}|${sd}`,
      title: v.title || o.name, desc: v.description || '', creator: ch?.value?.title || chName.replace(/^@/, ''), creatorId: ch?.claim_id || 'anonymous',
      thumb: v.thumbnail?.url || null, dur: v.video?.duration || 0, date: (Number(v.release_time) || o.timestamp || 0) * 1000, views: null,
      tags: v.tags || [], cats: [], url: o.canonical_url ? 'https://odysee.com/' + o.canonical_url.replace('lbry://', '').replace('#', ':') : 'https://odysee.com',
      license: parseLicense(v.license), lang: v.languages?.[0] || null,
    };
  },
  async run(p, S) { const r = await rpc('claim_search', this.base(S, p.page, p.extra)); return (r.items || []).map(i => this.parse(i, S)).filter(Boolean); },
  search(q, page, sort, S) { return this.run({ page, extra: { text: q, ...(sort === 'newest' ? { order_by: ['release_time'] } : sort === 'popular' ? { order_by: ['effective_amount'] } : {}) } }, S); },
  feed(page, kind, S) { return this.run({ page, extra: { order_by: kind === 'new' ? ['release_time'] : ['trending_group', 'trending_mixed'] } }, S); },
  creatorVideos(cid, page, S) { return this.run({ page, extra: { channel_ids: [cid], order_by: ['release_time'] } }, S); },
  async creatorInfo(cid) {
    const r = await rpc('claim_search', { claim_ids: [cid], claim_type: ['channel'], page_size: 1, no_totals: true });
    const it = r.items?.[0]; if (!it) return null;
    return { name: it.value?.title || it.name.replace(/^@/, ''), desc: it.value?.description || '', avatar: it.value?.thumbnail?.url || null, followers: null, url: it.canonical_url && 'https://odysee.com/' + it.canonical_url.replace('lbry://', '').replace('#', ':') };
  },
  async resolveStream(v) {
    const [name, claim, sd] = v.sid.split('|'), n = encodeURIComponent(name);
    const viaRpc = await rpc('get', { uri: `lbry://${name}#${claim}` }).then(r => r.streaming_url).catch(() => null);
    const urls = [`https://player.odycdn.com/api/v3/streams/free/${n}/${claim}/${sd}.mp4`, `https://lbrytv.ca/api/v3/streams/free/${n}/${claim}/${sd}.mp4`, viaRpc].filter(Boolean);
    return { urls, hls: false, download: urls[0], captions: [], chapters: [], desc: null };
  },
  async resolveUrl(url, S) {
    const u = new URL(url); if (u.host.replace('www.', '') !== 'odysee.com') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    const uri = seg.length >= 2 && seg[0].startsWith('@') ? `lbry://${seg[0].replace(':', '#')}/${seg[1].replace(':', '#')}` : null;
    if (!uri) return null;
    const r = await rpc('resolve', { urls: [uri] });
    return this.parse(r[uri] || Object.values(r)[0], S);
  },
};

/* --------------------------- Internet Archive --------------------------- */
const IA_FL = 'identifier,title,description,creator,date,downloads,subject,language';
export const archive = {
  id: 'archive',
  caps: { download: true },
  parse(d) {
    if (!d.identifier || !d.title) return null;
    const one = x => Array.isArray(x) ? x[0] : x;
    const cr = one(d.creator) || 'Internet Archive';
    return {
      id: `archive:${d.identifier}`, source: 'archive', sid: d.identifier, title: String(one(d.title)), desc: stripHtml(String(one(d.description) || '')).slice(0, 1500),
      creator: cr, creatorId: cr, thumb: `https://archive.org/services/img/${d.identifier}`, dur: 0, date: parseDate(d.date), views: d.downloads ?? null,
      tags: [].concat(d.subject || []).slice(0, 12), cats: ['Moving image'], url: `https://archive.org/details/${d.identifier}`, license: parseLicense(null), lang: one(d.language) || null,
    };
  },
  async run(q, sort, page) {
    const r = await J(qs('https://archive.org/advancedsearch.php', { q, fl: IA_FL, 'sort[]': sort, rows: PAGE, page: page + 1, output: 'json' }));
    return (r.response?.docs || []).map(d => this.parse(d)).filter(Boolean);
  },
  search(q, page, sort) { return this.run(`mediatype:movies AND (${q})`, sort === 'newest' ? 'date desc' : sort === 'oldest' ? 'date asc' : 'downloads desc', page); },
  feed(page, kind) { return this.run('mediatype:movies AND (collection:opensource_movies OR collection:feature_films OR collection:prelinger OR collection:computerchronicles)', kind === 'new' ? 'date desc' : 'downloads desc', page); },
  creatorVideos(cid, page) { return this.run(`creator:"${cid.replace(/"/g, '')}" AND mediatype:movies`, 'date desc', page); },
  async creatorInfo(cid) { return { name: cid, desc: 'Internet Archive creator', avatar: null, followers: null, url: `https://archive.org/search?query=creator%3A%22${encodeURIComponent(cid)}%22` }; },
  async resolveStream(v) {
    const m = await J(`https://archive.org/metadata/${v.sid}`);
    const rank = f => { const n = (f.name || '').toLowerCase(); return n.endsWith('.mp4') ? 3 : n.endsWith('.webm') ? 2 : n.endsWith('.ogv') ? 1 : 0; };
    const files = (m.files || []).filter(f => rank(f) && f.source !== 'metadata').sort((a, b) => rank(b) - rank(a) || (Number(b.size) || 0) - (Number(a.size) || 0));
    if (!files.length) throw new Error('No video file found');
    const urls = files.slice(0, 3).map(f => `https://${m.server}${m.dir}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`);
    const len = Number(files[0].length); 
    return { urls, hls: false, download: urls[0], captions: [], chapters: [], desc: null, dur: Number.isFinite(len) ? len : 0 };
  },
  async resolveUrl(url) {
    const u = new URL(url); if (!u.host.endsWith('archive.org')) return null;
    const id = u.pathname.split('/').filter(Boolean)[1]; if (!id) return null;
    const m = await J(`https://archive.org/metadata/${id}`);
    return this.parse({ identifier: id, ...m.metadata });
  },
};

/* ------------------------------ media.ccc.de ------------------------------ */
let cccCache = { t: 0, events: [] };
const cccEvents = async () => {
  if (Date.now() - cccCache.t < 600000 && cccCache.events.length) return cccCache.events;
  const r = await J('https://api.media.ccc.de/public/events', { timeout: 45000 });
  cccCache = { t: Date.now(), events: r.events || [] };
  return cccCache.events;
};
export const ccc = {
  id: 'ccc',
  caps: { download: true },
  parse(e) {
    const guid = e.guid || e.id; if (!guid || !e.title) return null;
    const persons = e.persons || [], cr = persons.length ? persons.join(', ') : 'media.ccc.de';
    return {
      id: `ccc:${guid}`, source: 'ccc', sid: guid, title: e.title, desc: e.description || e.subtitle || '', creator: cr, creatorId: cr,
      thumb: e.poster_url || e.thumb_url || null, dur: e.duration || 0, date: parseDate(e.date || e.release_date), views: e.view_count ?? null,
      tags: e.tags || [], cats: ['Conference'], url: e.frontend_link || e.url || `https://media.ccc.de/v/${guid}`, license: parseLicense('CC BY'), lang: e.original_language || null,
    };
  },
  async search(q, page) {
    const t = q.toLowerCase(), all = (await cccEvents()).filter(e => `${e.title} ${e.subtitle || ''} ${e.description || ''} ${(e.tags || []).join(' ')}`.toLowerCase().includes(t));
    return all.slice(page * PAGE, (page + 1) * PAGE).map(e => this.parse(e)).filter(Boolean);
  },
  async feed(page, kind) {
    const all = [...await cccEvents()].sort((a, b) => kind === 'new' ? (b.date || '').localeCompare(a.date || '') : (b.view_count || 0) - (a.view_count || 0));
    return all.slice(page * PAGE, (page + 1) * PAGE).map(e => this.parse(e)).filter(Boolean);
  },
  async creatorVideos(cid, page) {
    const all = (await cccEvents()).filter(e => (e.persons || []).some(p => cid.toLowerCase().includes(p.toLowerCase())));
    return all.slice(page * PAGE, (page + 1) * PAGE).map(e => this.parse(e)).filter(Boolean);
  },
  async creatorInfo(cid) { return { name: cid, desc: 'Speaker on media.ccc.de', avatar: null, followers: null, url: 'https://media.ccc.de' }; },
  async resolveStream(v) {
    const e = await J(`https://api.media.ccc.de/public/events/${v.sid}`);
    const recs = (e.recordings || []).filter(r => r.recording_url && /mp4|webm/.test(r.mime_type || r.recording_url));
    recs.sort((a, b) => (b.width || 0) - (a.width || 0));
    if (!recs.length) throw new Error('No recordings');
    return { urls: recs.slice(0, 3).map(r => r.recording_url), hls: false, download: recs[0].recording_url, captions: [], chapters: [], desc: e.description || null };
  },
  async resolveUrl(url) {
    const u = new URL(url); if (!u.host.includes('media.ccc.de')) return null;
    const seg = u.pathname.split('/').filter(Boolean); if (seg[0] !== 'v') return null;
    return this.parse(await J(`https://api.media.ccc.de/public/events/${seg[1]}`));
  },
};

/* ---------------------------- Wikimedia Commons ---------------------------- */
const WM = 'https://commons.wikimedia.org/w/api.php';
export const wikimedia = {
  id: 'wikimedia',
  caps: { download: true },
  async run(q, page) {
    // one request for search + metadata (generator) instead of N+1 lookups
    const r = await J(qs(WM, { action: 'query', generator: 'search', gsrsearch: `${q} filetype:video`.trim(), gsrnamespace: 6, gsrlimit: PAGE, gsroffset: page * PAGE,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|timestamp', format: 'json', origin: '*' }));
    return Object.values(r.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map(p => this.parse(p)).filter(Boolean);
  },
  parse(p) {
    const ii = p.imageinfo?.[0]; if (!ii?.url || !/\.(webm|ogv|mp4)$/i.test(ii.url)) return null;
    const x = ii.extmetadata || {}, artist = stripHtml(x.Artist?.value || '').trim() || 'Wikimedia contributor';
    const title = p.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    return {
      id: `wikimedia:${p.pageid}`, source: 'wikimedia', sid: p.title, title, desc: stripHtml(x.ImageDescription?.value || title).slice(0, 1200), creator: artist, creatorId: artist,
      thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.title.replace(/^File:/, ''))}?width=480`, dur: 0, date: parseDate(ii.timestamp), views: null,
      tags: (x.Categories?.value || '').split('|').filter(Boolean).slice(0, 10), cats: ['Wikimedia'], url: ii.url, direct: ii.url, license: parseLicense(x.LicenseShortName?.value),
    };
  },
  search(q, page) { return this.run(q, page); },
  feed(page) { return this.run('', page); },
  creatorVideos(cid, page) { return this.run(cid, page); },
  async creatorInfo(cid) { return { name: cid, desc: 'Wikimedia Commons contributor', avatar: null, followers: null, url: 'https://commons.wikimedia.org' }; },
  async resolveStream(v) { return { urls: [v.direct || v.url], hls: false, download: v.direct || v.url, captions: [], chapters: [], desc: null }; },
  async resolveUrl(url) {
    const u = new URL(url); if (!u.host.includes('wikimedia.org')) return null;
    const t = decodeURIComponent(u.pathname.split('/').pop() || ''); if (!t) return null;
    const r = await J(qs(WM, { action: 'query', titles: t.startsWith('File:') ? t : 'File:' + t, prop: 'imageinfo', iiprop: 'url|extmetadata|timestamp', format: 'json', origin: '*' }));
    return this.parse(Object.values(r.query?.pages || {})[0] || {});
  },
};

export const ADAPTERS = [peertube, odysee, archive, ccc, wikimedia];
