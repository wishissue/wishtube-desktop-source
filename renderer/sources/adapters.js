import { qs, parseDate, stripHtml, parseLicense } from '../core/models.js';
import { net } from '../core/net.js';

const J = (url, o) => net.json(url, o);
const PAGE = 20;
const rnd = n => Math.floor(Math.random() * n), pick = a => a[rnd(a.length)];
const sample = (a, k) => { const c = [...a]; for (let i = c.length - 1; i > 0; i--) { const j = rnd(i + 1); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, k); };
/** Broad topics used to probe every source, so each refresh brings in things nobody asked for yet. */
export const TOPICS = ['documentary', 'science', 'history', 'art', 'nature', 'travel', 'cooking', 'technology', 'linux', 'programming', 'animation', 'short film', 'interview', 'tutorial', 'lecture', 'music live', 'gaming', 'space', 'ocean', 'diy', 'electronics', 'philosophy', 'comedy', 'sport', 'architecture', 'retro computing', 'design', 'wildlife', 'podcast', 'news', 'education', 'cinema', 'photography', 'language', 'math', 'chess', 'robotics', 'climate'];
const PT_SORTS = ['-trending', '-hot', '-likes', '-views', '-publishedAt'];
const DAYS = 86400;
const MATURE_TAGS = ['mature', 'porn', 'nsfw', 'xxx'];

/* ------------------------------ PeerTube ------------------------------ */
export const peertube = {
  id: 'peertube',
  caps: { download: true, captions: true, chapters: true, comments: true, music: true, shorts: true },
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
      lang: o.language?.id || null, portrait: typeof o.aspectRatio === 'number' && o.aspectRatio > 0 ? o.aspectRatio < 1 : undefined,   // only when the instance reports it
    };
  },
  async search(q, page, sort, S) {
    const s = { relevance: '-match', newest: '-publishedAt', oldest: 'publishedAt', popular: '-views' }[sort] || '-match';
    const r = await J(qs('https://sepiasearch.org/api/v1/search/videos', { search: q, start: page * PAGE, count: PAGE, sort: s, nsfw: S.mature ? 'true' : 'false' }));
    return (r.data || []).map(o => this.parse(o, 'https://sepiasearch.org', S)).filter(Boolean);
  },
  /** kind: 'trending' | 'new' | 'random' (a random sort, so repeated refreshes don't see the same ranking). One dead instance never blocks the others. */
  async feed(page, kind, S) {
    const insts = [...new Set([S.ptInstance, ...this.defaults].filter(Boolean))];
    const n = 20, sort = kind === 'new' ? '-publishedAt' : kind === 'random' ? pick(PT_SORTS) : '-trending';
    const lists = await Promise.all(insts.map(i => J(qs(`${i}/api/v1/videos`, { start: page * n, count: n, sort, nsfw: S.mature ? 'true' : 'false' }), { timeout: 8000 })
      .then(r => (r.data || []).map(o => this.parse(o, i, S)).filter(Boolean)).catch(() => [])));
    return lists.flat();
  },
  /** Instance feed with provider-side filters (category / tags). */
  async filtered(page, params, S) {
    const insts = [...new Set([S.ptInstance, ...this.defaults].filter(Boolean))], n = 20;
    const lists = await Promise.all(insts.map(i => J(qs(`${i}/api/v1/videos`, { start: page * n, count: n, sort: '-trending', nsfw: S.mature ? 'true' : 'false', ...params }), { timeout: 8000 })
      .then(r => (r.data || []).map(o => this.parse(o, i, S)).filter(Boolean)).catch(() => [])));
    return lists.flat();
  },
  async music(q, page, S) {                                        // PeerTube category 1 = Music. S.musicSort: popular (most views) | trending | new
    const sort = { popular: '-views', trending: '-trending', new: '-publishedAt' }[S.musicSort] || '-views';
    if (!q) return this.filtered(page, { categoryOneOf: 1, sort }, S);
    const r = await J(qs('https://sepiasearch.org/api/v1/search/videos', { search: q, start: page * PAGE, count: PAGE, sort: S.musicSort === 'new' ? '-publishedAt' : '-match', categoryOneOf: 1, nsfw: S.mature ? 'true' : 'false' }));
    return (r.data || []).map(o => this.parse(o, 'https://sepiasearch.org', S)).filter(Boolean);
  },
  shorts(page, S) { return this.filtered(page, { tagsOneOf: ['shorts', 'short'] }, S); },
  async comments(v, { page = 0, sort = 'new' } = {}) {
    const [host, uuid] = v.sid.split('|'), n = 25;
    const r = await J(qs(`https://${host}/api/v1/videos/${uuid}/comment-threads`, { start: page * n, count: n, sort: sort === 'top' ? '-totalReplies' : '-createdAt' })).catch(e => { if (/409|403/.test(e.message)) throw new Error('Comments are turned off for this video'); throw e; });
    const av = a => { const p = (a?.avatars || []).at(-1)?.path || a?.avatar?.path; return p && a.host ? `https://${a.host}${p}` : null; };
    return { total: r.total ?? null, hasMore: (page + 1) * n < (r.total || 0), items: (r.data || []).filter(c => !c.isDeleted).map(c => ({ id: String(c.id), thread: String(c.threadId || c.id), user: c.account?.displayName || c.account?.name || 'Anonymous', avatar: av(c.account), text: stripHtml(c.text || ''), likes: null, date: parseDate(c.createdAt), replies: c.totalReplies || 0, url: c.url || null })) };
  },
  async replies(v, c) {
    const [host, uuid] = v.sid.split('|'), r = await J(`https://${host}/api/v1/videos/${uuid}/comment-threads/${c.thread}`), flat = [];
    const walk = (nodes, depth) => nodes.forEach(n => { const x = n.comment; if (x && !x.isDeleted) flat.push({ id: String(x.id), thread: c.thread, depth, user: x.account?.displayName || x.account?.name || 'Anonymous', avatar: null, text: stripHtml(x.text || ''), likes: null, date: parseDate(x.createdAt), replies: 0 }); walk(n.children || [], depth + 1); });
    walk(r.children || [], 1); return flat;
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
    // Download choices: direct web-video files when the instance has them (resumable, already muxed), else the HLS renditions.
    const ext = u => (/\.(mp4|webm|mkv|ogv)(\?|$)/i.exec(u) || [])[1]?.toLowerCase() || 'mp4';
    const options = files.length ? files.map(f => ({ kind: 'muxed', url: abs(f.fileUrl), height: f.resolution?.id || 0, ext: ext(f.fileUrl), size: f.size || 0 }))
      : (o.streamingPlaylists?.[0]?.files || []).filter(f => f.resolution?.id).map(f => ({ kind: 'hls', url: hls, height: f.resolution.id, ext: 'mp4', size: f.size || 0 }));
    if (!options.length && hls) options.push({ kind: 'hls', url: hls, height: 0, ext: 'mp4', size: 0 });
    return { urls, hls: !!hls, download: abs(files[0]?.fileDownloadUrl) || mp4[0] || null, options, captions: caps, chapters: chap, desc };
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
  caps: { download: true, comments: true, music: true, shorts: true },
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
      license: parseLicense(v.license), lang: v.languages?.[0] || null, portrait: v.video?.width && v.video?.height ? v.video.height > v.video.width : undefined,
      music: v.stream_type === 'audio' ? true : undefined, audio: v.stream_type === 'audio',
    };
  },
  async run(p, S) { const r = await rpc('claim_search', this.base(S, p.page, p.extra)); return (r.items || []).map(i => this.parse(i, S)).filter(Boolean); },
  music(q, page, S) {                                              // S.musicSort: popular (most supported all-time) | trending | new
    const order = { popular: ['effective_amount'], trending: ['trending_group', 'trending_mixed'], new: ['release_time'] }[S.musicSort] || ['effective_amount'];
    return this.run({ page, extra: { stream_types: ['audio', 'video'], any_tags: ['music'], ...(q && S.musicSort !== 'new' ? { text: q } : { order_by: order, ...(q ? { text: q } : {}) }) } }, S);
  },
  shorts(page, S) { return this.run({ page, extra: { any_tags: ['shorts', 'short'], order_by: ['release_time'] } }, S); },
  async comments(v, { page = 0, sort = 'new' } = {}) {
    const claim = v.sid.split('|')[1], n = 25;
    const r = (await J('https://comments.odysee.tv/api/v2?m=comment.List', { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'comment.List', params: { claim_id: claim, page: page + 1, page_size: n, top_level: true, sort_by: sort === 'top' ? 3 : 0, visible: true } }) })).result || {};
    return { total: r.total_filtered_items ?? r.total_items ?? null, hasMore: (r.total_pages || 0) > page + 1, items: (r.items || []).map(c => ({ id: c.comment_id, thread: c.comment_id, user: (c.channel_name || '@anonymous').replace(/^@/, ''), avatar: null, text: c.comment || '', likes: c.likes ?? null, date: (c.timestamp || 0) * 1000, replies: c.replies || 0, url: null })) };
  },
  async replies(v, c) {
    const claim = v.sid.split('|')[1];
    const r = (await J('https://comments.odysee.tv/api/v2?m=comment.List', { body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'comment.List', params: { claim_id: claim, parent_id: c.thread, page: 1, page_size: 50, sort_by: 0, visible: true } }) })).result || {};
    return (r.items || []).map(x => ({ id: x.comment_id, thread: c.thread, depth: 1, user: (x.channel_name || '@anonymous').replace(/^@/, ''), avatar: null, text: x.comment || '', likes: x.likes ?? null, date: (x.timestamp || 0) * 1000, replies: 0 }));
  },
  search(q, page, sort, S) { return this.run({ page, extra: { text: q, ...(sort === 'newest' ? { order_by: ['release_time'] } : sort === 'popular' ? { order_by: ['effective_amount'] } : {}) } }, S); },
  feed(page, kind, S) {
    if (kind === 'random') {                                       // "best of the last N days" with a random window and ranking: different every refresh
      const order = pick([['trending_group', 'trending_mixed'], ['effective_amount'], ['release_time']]);
      return this.run({ page, extra: { order_by: order, ...(order[0] === 'release_time' ? {} : { release_time: '>' + (Math.floor(Date.now() / 1000) - pick([7, 30, 90, 365]) * DAYS) }) } }, S);
    }
    return this.run({ page, extra: { order_by: kind === 'new' ? ['release_time'] : ['trending_group', 'trending_mixed'] } }, S);
  },
  creatorVideos(cid, page, S) { return this.run({ page, extra: { channel_ids: [cid], order_by: ['release_time'] } }, S); },
  async creatorInfo(cid) {
    const r = await rpc('claim_search', { claim_ids: [cid], claim_type: ['channel'], page_size: 1, no_totals: true });
    const it = r.items?.[0]; if (!it) return null;
    return { name: it.value?.title || it.name.replace(/^@/, ''), desc: it.value?.description || '', avatar: it.value?.thumbnail?.url || null, followers: null, url: it.canonical_url && 'https://odysee.com/' + it.canonical_url.replace('lbry://', '').replace('#', ':') };
  },
  async resolveStream(v) {
    const [name, claim, sd] = v.sid.split('|'), n = encodeURIComponent(name);
    // The two CDN URLs usually work and are known immediately. The slow "get" RPC (which has to start the stream on the network) is no longer on the critical path:
    // it is offered as `lazy`, and the player only asks for it after the CDN URLs have failed.
    const urls = [`https://player.odycdn.com/api/v3/streams/free/${n}/${claim}/${sd}.mp4`, `https://lbrytv.ca/api/v3/streams/free/${n}/${claim}/${sd}.mp4`];
    const lazy = async () => { const u = await rpc('get', { uri: `lbry://${name}#${claim}` }).then(r => r.streaming_url).catch(() => null); return u ? [u] : []; };
    return { urls, lazy, hls: false, download: urls[0], options: [{ kind: 'muxed', url: urls[0], height: 0, ext: 'mp4', size: 0 }], captions: [], chapters: [], desc: null };
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
const IA_FL = 'identifier,title,description,creator,date,downloads,subject,language,mediatype';
export const archive = {
  id: 'archive',
  caps: { download: true, comments: true, music: true },
  parse(d) {
    if (!d.identifier || !d.title) return null;
    const one = x => Array.isArray(x) ? x[0] : x;
    const cr = one(d.creator) || 'Internet Archive';
    return {
      id: `archive:${d.identifier}`, source: 'archive', sid: d.identifier, title: String(one(d.title)), desc: stripHtml(String(one(d.description) || '')).slice(0, 1500),
      creator: cr, creatorId: cr, thumb: `https://archive.org/services/img/${d.identifier}`, dur: 0, date: parseDate(d.date), views: d.downloads ?? null,
      tags: [].concat(d.subject || []).slice(0, 12), cats: [d.mediatype === 'audio' ? 'Audio' : 'Moving image'], music: d.mediatype === 'audio' ? true : undefined, audio: d.mediatype === 'audio', url: `https://archive.org/details/${d.identifier}`, license: parseLicense(null), lang: one(d.language) || null,
    };
  },
  async run(q, sort, page) {
    const r = await J(qs('https://archive.org/advancedsearch.php', { q, fl: IA_FL, 'sort[]': sort, rows: PAGE, page: page + 1, output: 'json' }));
    return (r.response?.docs || []).map(d => this.parse(d)).filter(Boolean);
  },
  search(q, page, sort) { return this.run(`mediatype:movies AND (${q})`, sort === 'newest' ? 'date desc' : sort === 'oldest' ? 'date asc' : 'downloads desc', page); },
  feed(page, kind) {
    if (kind === 'random') {                                       // a random handful of collections, ranking and depth
      const cols = sample(['opensource_movies', 'feature_films', 'prelinger', 'computerchronicles', 'classic_tv', 'vlogs', 'artsandmusicvideos', 'gamevideos', 'newsandpublicaffairs', 'animationandcartoons', 'nasa', 'sports'], 3 + rnd(3));
      return this.run(`mediatype:movies AND (${cols.map(c => 'collection:' + c).join(' OR ')})`, pick(['downloads desc', 'week desc', 'date desc', 'downloads desc']), page);
    }
    return this.run('mediatype:movies AND (collection:opensource_movies OR collection:feature_films OR collection:prelinger OR collection:computerchronicles)', kind === 'new' ? 'date desc' : 'downloads desc', page);
  },
  creatorVideos(cid, page) { return this.run(`creator:"${cid.replace(/"/g, '')}" AND (mediatype:movies OR mediatype:audio)`, 'date desc', page); },
  music(q, page, S) {
    const sort = { popular: 'downloads desc', trending: 'week desc', new: 'date desc' }[S.musicSort] || 'downloads desc';
    return this.run(`mediatype:audio AND (collection:netlabels OR collection:opensource_audio OR collection:audio_music)${q ? ` AND (${q})` : ''}`, sort, page);
  },
  async comments(v) {                                              // Internet Archive "reviews" are the item's public comments
    const m = await J(`https://archive.org/metadata/${v.sid}`);
    const items = (m.reviews || []).map((r, i) => ({ id: 'r' + i, thread: 'r' + i, user: r.reviewer || 'Anonymous', avatar: null, text: [r.reviewtitle, stripHtml(r.reviewbody || '')].filter(Boolean).join('\n\n'), likes: null, date: parseDate(r.reviewdate || r.createdate), replies: 0, stars: Number(r.stars) || null }));
    return { total: items.length, hasMore: false, items };
  },
  async creatorInfo(cid) { return { name: cid, desc: 'Internet Archive creator', avatar: null, followers: null, url: `https://archive.org/search?query=creator%3A%22${encodeURIComponent(cid)}%22` }; },
  async resolveStream(v) {
    const m = await J(`https://archive.org/metadata/${v.sid}`);
    if (v.audio) {                                                 // an audio item is an album/release: one entry per track file
      const link = f => `https://${m.server}${m.dir}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`;
      const isTrack = f => /\.(mp3|ogg|opus|flac|m4a)$/i.test(f.name) && f.source !== 'metadata';
      const all = (m.files || []).filter(isTrack), mp3 = all.filter(f => /mp3$/i.test(f.name)), pick = mp3.length ? mp3 : all;
      const tracks = pick.sort((a, b) => (parseInt(a.track, 10) || 1e6) - (parseInt(b.track, 10) || 1e6) || a.name.localeCompare(b.name)).map(f => ({ title: f.title || f.name.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]+/, ''), url: link(f), dur: Number(f.length) || 0, artist: f.creator || f.artist || null, album: f.album || null }));
      if (!tracks.length) throw new Error('No audio files found');
      return { urls: tracks.map(t => t.url).slice(0, 3), hls: false, download: tracks[0].url, options: tracks.slice(0, 1).map(t => ({ kind: 'muxed', url: t.url, height: 0, ext: t.url.split('.').pop().toLowerCase(), size: 0 })), tracks, captions: [], chapters: [], desc: null };
    }
    const rank = f => { const n = (f.name || '').toLowerCase(); return n.endsWith('.mp4') ? 3 : n.endsWith('.webm') ? 2 : n.endsWith('.ogv') ? 1 : 0; };
    const files = (m.files || []).filter(f => rank(f) && f.source !== 'metadata').sort((a, b) => rank(b) - rank(a) || (Number(b.size) || 0) - (Number(a.size) || 0));
    if (!files.length) throw new Error('No video file found');
    const urls = files.slice(0, 3).map(f => `https://${m.server}${m.dir}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`);
    const len = Number(files[0].length); 
    const link = f => `https://${m.server}${m.dir}/${encodeURIComponent(f.name).replace(/%2F/g, '/')}`;
    const options = files.filter(f => /\.(mp4|webm)$/i.test(f.name)).slice(0, 6).map(f => ({ kind: 'muxed', url: link(f), height: Number(f.height) || 0, ext: f.name.split('.').pop().toLowerCase(), size: Number(f.size) || 0 }));
    return { urls, hls: false, download: urls[0], options, captions: [], chapters: [], desc: null, dur: Number.isFinite(len) ? len : 0 };
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
    const ev = await cccEvents();
    if (kind === 'random') return sample(ev, PAGE).map(e => this.parse(e)).filter(Boolean);       // the whole archive is in memory, so a true random sample is free
    const all = [...ev].sort((a, b) => kind === 'new' ? (b.date || '').localeCompare(a.date || '') : (b.view_count || 0) - (a.view_count || 0));
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
    const options = recs.map(r => ({ kind: 'muxed', url: r.recording_url, height: r.height || 0, ext: /webm/.test(r.mime_type || r.recording_url) ? 'webm' : 'mp4', size: (r.size || 0) * 1048576 }));
    return { urls: recs.slice(0, 3).map(r => r.recording_url), hls: false, download: recs[0].recording_url, options, captions: [], chapters: [], desc: e.description || null };
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
  parse(p, audio = false) {
    const ii = p.imageinfo?.[0]; if (!ii?.url || !(audio ? /\.(ogg|oga|opus|mp3|wav|flac)$/i : /\.(webm|ogv|mp4)$/i).test(ii.url)) return null;
    const x = ii.extmetadata || {}, artist = stripHtml(x.Artist?.value || '').trim() || 'Wikimedia contributor';
    const title = p.title.replace(/^File:/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    return {
      id: `wikimedia:${p.pageid}`, source: 'wikimedia', sid: p.title, title, desc: stripHtml(x.ImageDescription?.value || title).slice(0, 1200), creator: artist, creatorId: artist,
      thumb: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p.title.replace(/^File:/, ''))}?width=480`, dur: 0, date: parseDate(ii.timestamp), views: null,
      tags: (x.Categories?.value || '').split('|').filter(Boolean).slice(0, 10), cats: [audio ? 'Audio' : 'Wikimedia'], music: audio ? true : undefined, audio, url: ii.url, direct: ii.url, license: parseLicense(x.LicenseShortName?.value),
    };
  },
  async music(q, page) {                                           // audio files are only offered for an explicit search (Commons audio is not all music)
    if (!q) return [];
    const r = await J(qs(WM, { action: 'query', generator: 'search', gsrsearch: `${q} filetype:audio`, gsrnamespace: 6, gsrlimit: PAGE, gsroffset: page * PAGE, prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata|timestamp', format: 'json', origin: '*' }));
    return Object.values(r.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map(p => this.parse(p, true)).filter(Boolean);
  },
  search(q, page) { return this.run(q, page); },
  feed(page, kind) { return kind === 'new' ? this.run('', page) : this.run(pick(TOPICS), rnd(3)); },
  creatorVideos(cid, page) { return this.run(cid, page); },
  async creatorInfo(cid) { return { name: cid, desc: 'Wikimedia Commons contributor', avatar: null, followers: null, url: 'https://commons.wikimedia.org' }; },
  async resolveStream(v) { const u = v.direct || v.url; return { urls: [u], hls: false, download: u, options: [{ kind: 'muxed', url: u, height: 0, ext: (/\.(webm|ogv|mp4)$/i.exec(u) || [])[1]?.toLowerCase() || 'webm', size: 0 }], captions: [], chapters: [], desc: null }; },
  async resolveUrl(url) {
    const u = new URL(url); if (!u.host.includes('wikimedia.org')) return null;
    const t = decodeURIComponent(u.pathname.split('/').pop() || ''); if (!t) return null;
    const r = await J(qs(WM, { action: 'query', titles: t.startsWith('File:') ? t : 'File:' + t, prop: 'imageinfo', iiprop: 'url|extmetadata|timestamp', format: 'json', origin: '*' }));
    return this.parse(Object.values(r.query?.pages || {})[0] || {});
  },
};

export const ADAPTERS = [peertube, odysee, archive, ccc, wikimedia];
