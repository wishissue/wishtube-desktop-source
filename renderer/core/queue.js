/** Play queue with shuffle + repeat. Pure logic (no DOM), so it is unit-tested. Items are video/track objects with a unique `id`. */
export class Queue {
  constructor(items = [], index = items.length ? 0 : -1) { this.items = [...items]; this.index = index; this.shuffle = false; this.repeat = 'off'; this.order = null; this.pos = 0; }
  get current() { return this.items[this.index] || null; }
  get length() { return this.items.length; }
  _reorder(keep = true) {                                          // shuffled order: current item first, the rest in random order
    if (!this.shuffle) { this.order = null; return; }
    const rest = this.items.map((_, i) => i).filter(i => i !== this.index);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = this.index >= 0 && keep ? [this.index, ...rest] : rest; this.pos = 0;
  }
  setShuffle(on) { this.shuffle = !!on; this._reorder(); return this.shuffle; }
  setRepeat(m) { this.repeat = ['off', 'all', 'one'].includes(m) ? m : 'off'; return this.repeat; }
  cycleRepeat() { return this.setRepeat({ off: 'all', all: 'one', one: 'off' }[this.repeat]); }
  load(items, start = 0) { this.items = [...items]; this.index = items.length ? Math.max(0, Math.min(start, items.length - 1)) : -1; this._reorder(); return this.current; }
  /** Add to the end, or right after the current item (`next: true`). Duplicates already queued are moved, not repeated. */
  add(item, { next = false } = {}) {
    const cur = this.current, at = this.items.findIndex(x => x.id === item.id);
    if (at >= 0 && at === this.index) return false;
    if (at >= 0) this.items.splice(at, 1);
    const ins = next ? (this.items.indexOf(cur) + 1 || this.items.length) : this.items.length;
    this.items.splice(ins, 0, item); this.index = cur ? this.items.indexOf(cur) : (this.items.length === 1 ? 0 : this.index);
    this._reorder(); return true;
  }
  remove(i) {
    if (i < 0 || i >= this.items.length) return null; const cur = this.current, [gone] = this.items.splice(i, 1);
    this.index = !this.items.length ? -1 : gone === cur ? Math.min(i, this.items.length - 1) : this.items.indexOf(cur);
    this._reorder(); return gone;
  }
  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.items.length || to >= this.items.length) return; const cur = this.current;
    const [x] = this.items.splice(from, 1); this.items.splice(to, 0, x); this.index = this.items.indexOf(cur); this._reorder();
  }
  clear(keepCurrent = false) { const cur = this.current; this.items = keepCurrent && cur ? [cur] : []; this.index = this.items.length ? 0 : -1; this._reorder(); }
  jump(i) { if (i < 0 || i >= this.items.length) return null; this.index = i; if (this.shuffle) { this.pos = Math.max(0, this.order.indexOf(i)); } return this.current; }
  /** Next item for "skip" (auto = false) or for "track ended" (auto = true, where repeat-one replays the same item). */
  next(auto = false) {
    if (!this.items.length) return null;
    if (auto && this.repeat === 'one') return this.current;
    if (this.shuffle) {
      if (!this.order) this._reorder();
      if (this.pos + 1 < this.order.length) { this.index = this.order[++this.pos]; return this.current; }
      if (this.repeat === 'all') { this._reorder(false); this.pos = 0; this.index = this.order[0]; return this.current; }
      return null;
    }
    if (this.index + 1 < this.items.length) { this.index++; return this.current; }
    if (this.repeat === 'all' || (!auto && this.repeat === 'one')) { this.index = 0; return this.current; }
    return null;
  }
  prev() {
    if (!this.items.length) return null;
    if (this.shuffle) { if (this.pos > 0) { this.index = this.order[--this.pos]; return this.current; } return this.current; }
    if (this.index > 0) { this.index--; return this.current; }
    return this.repeat === 'all' ? (this.index = this.items.length - 1, this.current) : this.current;
  }
  toJSON() { return { items: this.items, index: this.index, shuffle: this.shuffle, repeat: this.repeat }; }
  static from(j) { const q = new Queue(j?.items || [], j?.index ?? -1); q.shuffle = !!j?.shuffle; q.repeat = j?.repeat || 'off'; q._reorder(); return q; }
}
