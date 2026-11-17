import { h } from './dom.js';
import { pickCat, catSrc } from '../core/cats.js';

/** Failure / empty screen: the cat on the left, the words on the right. Colours come only from theme variables
 *  (a solid popover surface and the theme's text colour), so it stays readable in every theme and over every background.
 *  @param {string} kind key of KINDS in core/cats.js
 *  @param {{title:string,text?:string,actions?:Node[],size?:'sm',style?:object}} o title = what happened, text = why / what to do */
export function catPanel(kind, { title, text, actions, size, style } = {}) {
  const p = pickCat(kind), c = p.cat;
  const img = h('img', { src: catSrc(c), alt: '', draggable: false, style: { objectFit: c.fit || 'cover', objectPosition: c.pos || '50% 50%' }, onerror: e => e.target.closest('.catpic')?.remove() });
  const pic = h('div.catpic', { style: c.bg ? { background: c.bg } : null }, img);
  return h('div.catstate' + (size === 'sm' ? '.sm' : ''), { role: 'group', 'aria-label': title, style },
    pic,
    h('div.cattext', h('div.catkick', p.head), h('h2', title), h('p.catjoke', p.joke), text ? h('p.catwhy', text) : null,
      actions?.length ? h('div.catact', actions) : null));
}

/** A small round cat for cards and inline messages. */
export function catThumb(kind, px = 56) {
  const c = pickCat(kind).cat;
  return h('img.catthumb', { src: catSrc(c), alt: '', draggable: false, style: { width: px + 'px', height: px + 'px', objectFit: c.fit || 'cover', objectPosition: c.pos || '50% 50%', background: c.bg || null } });
}
