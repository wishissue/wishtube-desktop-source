/** The cat pack. Pure data, no DOM, so it can be tested.
 *  To add a cat: drop an image into assets/cats/, add one entry to CATS, and put its id in the `cats` list of any kind below.
 *  fit: 'cover' crops to fill the square frame (photos); 'contain' shows the whole picture on `bg` (stickers, cut-outs). */
export const CATS = {
  'sad-paw':    { f: 'sad-paw.jpg', pos: '50% 30%' },
  scream:       { f: 'scream.jpg', pos: '45% 50%' },
  calc:         { f: 'calc.jpg', fit: 'contain', bg: '#000' },
  shrug:        { f: 'shrug.jpg', fit: 'contain', bg: '#fff' },
  'nerd-point': { f: 'nerd-point.jpg', fit: 'contain', bg: '#fff' },
  'nerd-point-2': { f: 'nerd-point-2.jpg', fit: 'contain', bg: '#fff' },
  'nerd-emoji': { f: 'nerd-emoji.jpg' },
  grumpy:       { f: 'grumpy.jpg' },
  hoodie:       { f: 'hoodie.jpg', pos: '50% 35%' },
  'laptop-nap': { f: 'laptop-nap.jpg', pos: '35% 50%' },
  coder:        { f: 'coder.jpg', pos: '75% 50%' },
  sweater:      { f: 'sweater.jpg' },
  grape:        { f: 'grape.jpg', pos: '50% 40%' },
  kitten:       { f: 'kitten.jpg', fit: 'contain', bg: '#000' },
  broke:        { f: 'broke.jpg' },
  lying:        { f: 'lying.jpg' },
  judge:        { f: 'judge.jpg', pos: '50% 40%' },
  yes:          { f: 'yes.gif' },
};

/** One entry per kind of screen. `head` is the cat's one-liner; `jokes` rotate so you rarely see the same one twice in a row. */
export const KINDS = {
  streams:  { cats: ['scream', 'sad-paw'], head: 'Oopsie, sorry!', jokes: ['Every single stream failed. We are screaming too.', 'We tried every mirror and asked nicely. Meow.', 'The video ran away. We sent a cat after it.', 'Okay, that one is probably on us.'] },
  loadfail: { cats: ['calc', 'sad-paw'], head: 'I did the maths…', jokes: ['…and the maths says this failed. Retry?', 'I counted the bytes twice. Still broken.', 'Result: one sad cat.', 'Oops! Sorry! Pretend this never happened.'] },
  noresults:{ cats: ['shrug'], head: 'Nothing. Nada.', jokes: ['Not even a tiny bit of catnip.', 'We checked under the couch too.', 'Zero results. Try different words, human.'] },
  source:   { cats: ['hoodie'], head: 'The source went dark.', jokes: ['The server pulled up its hood and left.', 'Nobody answered. Very suspicious.', 'Check your connection. Or the server’s mood.'] },
  notfound: { cats: ['nerd-point'], head: 'Well, actually…', jokes: ['Technically, it was never here.', 'It left the building. We checked.', 'It probably expired. Everything does.'] },
  comments: { cats: ['nerd-point-2'], head: 'Um, actually', jokes: ['The comments didn’t load. Probably for the best.', 'The replies are on strike.', 'Even the comments need a nap.'] },
  badlink:  { cats: ['nerd-emoji'], head: 'I inspected it closely.', jokes: ['That is not a video link. It might be a sandwich.', 'Looks suspicious. Very suspicious.', 'I put on my glasses. Still no idea.'] },
  slow:     { cats: ['grumpy'], head: 'Still here.', jokes: ['Yes, it is slow. No, I am not happy about it.', 'Staring at your Wi-Fi until it behaves.', 'Good things take time. This is not one.'] },
  update:   { cats: ['laptop-nap'], head: 'Cat vs. update', jokes: ['I tried to update. Then I fell asleep on it.', 'I only touched one key. I swear.', 'Open the release page. I will keep the laptop warm.'] },
  pagefail: { cats: ['coder'], head: 'Debugging…', jokes: ['Have you tried turning it off and on again?', 'It works on my machine. (It does not.)', 'git blame says it was the cat.'] },
  nothing:  { cats: ['grape'], head: 'Nothing here…', jokes: ['The feed is empty, but I have a grape.', 'Nothing new. I am balancing a grape meanwhile.', 'Empty! Perfectly balanced, as all things should be.'] },
  nomedia:  { cats: ['sweater'], head: 'Nothing found', jokes: ['I checked every source. Twice. Pushed my glasses up.', 'Did my homework. Still nothing.', 'Silence is a vibe too.'] },
  emptylist:{ cats: ['kitten'], head: 'It’s empty.', jokes: ['Waiting for you to add something. Standing up straight.', 'So empty. So much room.', 'Add something. I will wait right here.'] },
  emptylib: { cats: ['broke'], head: 'Balance: $0.00', jokes: ['Wallet empty, history empty, vibes empty.', 'Totally brokeholic.', 'Watch something and I will fill this up.'] },
  nodl:     { cats: ['lying'], head: 'Downloads: none', jokes: ['Lying here, waiting for your first download.', 'Press the button. I will cheer.', 'Nothing downloading. Peak relaxation.'] },
  nofollow: { cats: ['judge'], head: 'Following nobody?', jokes: ['I am judging you silently.', 'Zero follows. Bold strategy.', 'Hit Follow on a video. I am watching.'] },
  win:      { cats: ['yes'], head: 'Yesss!', jokes: ['Done! Good human.', 'It worked. I knew you could do it.', 'Treat time?'] },
};

const last = {};
export const catSrc = c => 'assets/cats/' + c.f;

/** Random cat + joke for a kind, never the same joke twice in a row. */
export function pickCat(kind, rng = Math.random) {
  const k = KINDS[kind] || KINDS.loadfail, id = k.cats[Math.floor(rng() * k.cats.length)];
  let i = Math.floor(rng() * k.jokes.length); if (k.jokes.length > 1 && i === last[kind]) i = (i + 1) % k.jokes.length; last[kind] = i;
  return { id, cat: CATS[id], head: k.head, joke: k.jokes[i] };
}
