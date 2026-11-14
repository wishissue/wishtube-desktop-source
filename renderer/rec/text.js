// Text understanding for ranking: tokenizer, feature hashing, TF-IDF vectors, language detection.
// Pure functions, no DOM and no Node APIs, so it runs in the app and in tests.

const STOP = new Set(`the and for with that this from your you are was were will have has had not but all can what when how why who which their there about into over just more most some than then them they his her its our out one two also been being would could should very much many any each other only own same such too use using via vs
de la el los las una un del por con para que es en se lo como pero sus al más este esta
le les des est une pour dans qui sur pas plus par avec sont
der die das und ist nicht ein eine mit den dem auf für von zu im
video videos episode part official full new watch live hd 4k`.split(/\s+/));

const FNV = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
export const DIMS = 1 << 18;                 // 262k buckets: collisions are negligible at our vocabulary size
export const hashTerm = t => FNV(t) % DIMS;

function stem(w) {
  if (w.length < 5 || !/^[a-z]+$/.test(w)) return w;
  return w.replace(/(ies)$/, 'y').replace(/(ing|ed|ly|es|s)$/, m => (w.length - m.length >= 4 ? '' : m));
}

export function tokens(s) {
  const out = [];
  for (const m of (s || '').toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}'+#.-]*/gu)) {
    let w = m[0].replace(/^[.'-]+|[.'-]+$/g, '');
    if (w.length < 2 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Raw term frequencies for a video (weighted by field): title 3x, tags 3x, categories 2x, description 1x. Cached per object. */
const tfCache = new WeakMap();
export function termFreq(v) {
  let tf = tfCache.get(v); if (tf) return tf;
  tf = new Map();
  const add = (term, w) => { const h = hashTerm(term); tf.set(h, (tf.get(h) || 0) + w); lexicon.set(h, term); };
  const title = tokens(v.title);
  title.forEach(t => add(t, 3));
  for (let i = 0; i < title.length - 1; i++) add(title[i] + ' ' + title[i + 1], 2);   // bigrams capture "machine learning", "linux kernel"
  (v.tags || []).forEach(t => tokens(String(t)).forEach(x => add(x, 3)));
  (v.cats || []).forEach(t => tokens(String(t)).forEach(x => add(x, 2)));
  tokens((v.desc || '').slice(0, 400)).forEach(t => add(t, 1));
  tfCache.set(v, tf);
  return tf;
}

/** hash -> readable term, so the UI can say *why* something was recommended. Bounded. */
export const lexicon = new Map();
export function trimLexicon(max = 60000) { if (lexicon.size > max) { let n = lexicon.size - max; for (const k of lexicon.keys()) { lexicon.delete(k); if (--n <= 0) break; } } }


/* ---------------- Semantic layer: reflective random indexing ----------------
 * Every term gets a fixed sparse random "index vector". A term's *context vector* is the sum of the index vectors of every
 * term it has appeared alongside. Terms used in similar company (pizza / pasta / dough) end up with similar context vectors,
 * so "pizza" and "pasta" match even though they share no letters. It learns from every video the app fetches, on-device. */
export const SEM = 48;
export const SEM_BASE = 1 << 20;                                  // semantic dimensions live at keys >= SEM_BASE in the same sparse Map
const indexVec = h => { const out = []; let x = h || 1; for (let i = 0; i < 6; i++) { x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) + i | 0; x = Math.imul(x ^ (x >>> 12), 0x297a2d39); out.push([(x >>> 3) % SEM, (x & 1) ? 1 : -1]); } return out; };

export class Semantic {
  constructor(d) {
    this.ctx = new Map(); this.n = new Map();
    for (const [h, b64, n] of d?.terms || []) {
      const bin = atobSafe(b64), a = new Float32Array(SEM);
      for (let i = 0; i < SEM; i++) a[i] = (bin.charCodeAt(i) << 24 >> 24) / 127;
      this.ctx.set(h, a); this.n.set(h, n);
    }
  }
  learn(tf) {
    const terms = [...tf].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([h]) => h);
    if (terms.length < 3) return;
    const sum = new Float32Array(SEM);
    for (const h of terms) for (const [i, sg] of indexVec(h)) sum[i] += sg;
    for (const h of terms) {
      let c = this.ctx.get(h); if (!c) { c = new Float32Array(SEM); this.ctx.set(h, c); this.n.set(h, 0); }
      for (let i = 0; i < SEM; i++) c[i] += sum[i];
      for (const [i, sg] of indexVec(h)) c[i] -= sg;                   // leave out the term's own index vector (the "reflective" part)
      this.n.set(h, this.n.get(h) + 1);
    }
    if (this.ctx.size > 40000) this.trim();
  }
  trim() { const keep = [...this.n].sort((a, b) => b[1] - a[1]).slice(0, 25000); const k = new Set(keep.map(x => x[0])); for (const h of [...this.ctx.keys()]) if (!k.has(h)) { this.ctx.delete(h); this.n.delete(h); } }
  /** Unit-length context vector for a term, only once it has been seen enough times to be trustworthy. */
  get(h) {
    const c = this.ctx.get(h); if (!c || (this.n.get(h) || 0) < 3) return null;
    let s = 0; for (let i = 0; i < SEM; i++) s += c[i] * c[i];
    return s > 0 ? [c, 1 / Math.sqrt(s)] : null;
  }
  toJSON(max = 12000) {
    const rows = [...this.ctx].filter(([h]) => (this.n.get(h) || 0) >= 3).sort((x, y) => this.n.get(y[0]) - this.n.get(x[0])).slice(0, max);
    return { terms: rows.map(([h, c]) => {
      let s = 0; for (const x of c) s += x * x; s = Math.sqrt(s) || 1;
      return [h, btoaSafe(String.fromCharCode(...Array.from(c, x => Math.round(x / s * 127) & 255))), this.n.get(h)];
    }) };
  }
}
const btoaSafe = s => (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'latin1').toString('base64'));
const atobSafe = s => (typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('latin1'));

/** Document-frequency table, learned from everything the app has ever seen. Makes rare, specific terms matter more. */
export class Corpus {
  constructor(d) { this.n = d?.n || 0; this.df = new Map(d?.df || []); this.sem = new Semantic(d?.sem); }
  add(v) { const tf = termFreq(v); this.n++; this.sem.learn(tf); for (const h of tf.keys()) this.df.set(h, (this.df.get(h) || 0) + 1); if (this.n > 60000) this.halve(); }
  halve() { this.n = Math.ceil(this.n / 2); for (const [h, c] of this.df) { const x = c >> 1; x ? this.df.set(h, x) : this.df.delete(h); } }
  idf(h) { return Math.log((this.n + 2) / ((this.df.get(h) || 0) + 1)) + 1; }
  toJSON() { return { n: this.n, df: [...this.df].filter(([, c]) => c > 1), sem: this.sem.toJSON() }; }
}

/** Unit-length vector: lexical TF-IDF (exact words) concatenated with a semantic part (words used in similar company). */
const LEX = 0.55, SEMW = 0.45;
export function vectorize(v, corpus) {
  const lex = new Map(); let norm = 0;
  for (const [h, f] of termFreq(v)) { const w = (1 + Math.log(f)) * corpus.idf(h); lex.set(h, w); norm += w * w; }
  norm = Math.sqrt(norm) || 1;
  const sem = new Float32Array(SEM); let used = 0;
  if (corpus.sem) for (const [h, w] of lex) { const g = corpus.sem.get(h); if (!g) continue; used++; const k = (w / norm) * g[1], c = g[0]; for (let i = 0; i < SEM; i++) sem[i] += c[i] * k; }
  let sn = 0; for (let i = 0; i < SEM; i++) sn += sem[i] * sem[i]; sn = Math.sqrt(sn);
  const useSem = used >= 2 && sn > 1e-6, a = useSem ? Math.sqrt(LEX) : 1;
  const out = new Map();
  for (const [h, w] of lex) out.set(h, (w / norm) * a);
  if (useSem) { const k = Math.sqrt(SEMW) / sn; for (let i = 0; i < SEM; i++) if (sem[i]) out.set(SEM_BASE + i, sem[i] * k); }
  return out;
}

export function dot(a, b) { if (a.size > b.size) [a, b] = [b, a]; let s = 0; for (const [h, w] of a) { const x = b.get(h); if (x) s += w * x; } return s; }
export const norm = a => { let s = 0; for (const w of a.values()) s += w * w; return Math.sqrt(s); };
export const cosine = (a, b) => { const d = dot(a, b); return d ? d / ((norm(a) * norm(b)) || 1) : 0; };

/** Keep the strongest n terms so profile vectors stay small and fast. */
export function prune(m, n = 160) {
  const lex = [], keep = new Map();
  for (const e of m) (e[0] >= SEM_BASE ? keep.set(e[0], e[1]) : lex.push(e));      // semantic dimensions are dense and always kept
  for (const [h, w] of lex.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, n)) keep.set(h, w);
  return keep;
}

/* ---------------- Language detection (script + stopword voting) ---------------- */
const LANG_WORDS = {
  en: 'the and of to in is that for with you this are was on it as at be have from or not but they your what when how',
  es: 'el la de que y en los las un una por con para es se del al como más pero sus este esta lo no',
  fr: 'le la les de des et en un une est pour dans qui sur pas plus par avec sont ce que au',
  de: 'der die das und ist nicht ein eine mit den dem auf für von zu im sich auch es dass wie',
  pt: 'o a os as de que e em um uma para com não por mais como do da dos das se mas',
  it: 'il la le di che e in un una per con non è sono del della come più ma si',
  nl: 'de het een en van in is dat op te voor met niet zijn aan er maar om ook',
};
const LANG_SETS = Object.fromEntries(Object.entries(LANG_WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));

export function detectLanguage(text) {
  const s = (text || '').slice(0, 600);
  if (s.length < 8) return null;
  const count = re => (s.match(re) || []).length;
  const letters = count(/\p{L}/gu) || 1;
  if (count(/[\u3040-\u30ff]/g) / letters > 0.1) return 'ja';
  if (count(/[\uac00-\ud7af]/g) / letters > 0.1) return 'ko';
  if (count(/[\u4e00-\u9fff]/g) / letters > 0.2) return 'zh';
  if (count(/[\u0400-\u04ff]/g) / letters > 0.3) return 'ru';
  if (count(/[\u0600-\u06ff]/g) / letters > 0.3) return 'ar';
  if (count(/[\u0900-\u097f]/g) / letters > 0.3) return 'hi';
  const words = s.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.length < 3) return null;
  let best = null, bestN = 0, second = 0;
  for (const [lang, set] of Object.entries(LANG_SETS)) {
    const n = words.reduce((a, w) => a + (set.has(w) ? 1 : 0), 0);
    if (n > bestN) { second = bestN; bestN = n; best = lang; } else if (n > second) second = n;
  }
  return bestN >= 2 && bestN > second ? best : null;
}

export function videoLanguage(v) {
  if (v.lang) return String(v.lang).slice(0, 2).toLowerCase();
  if (v._lang === undefined) v._lang = detectLanguage(`${v.title}. ${(v.desc || '').slice(0, 300)}`);
  return v._lang;
}
