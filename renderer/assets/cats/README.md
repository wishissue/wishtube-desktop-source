# Cat pack

Every failure, empty and "nothing found" screen shows one of these cats on the left with a joke and the real reason on the right.

## Add a cat
1. Drop the image here (jpg, png, webp or gif; about 640 px is plenty).
2. Add one line to `CATS` in `renderer/core/cats.js`:
   `'my-cat': { f: 'my-cat.jpg' }`
   Use `fit: 'contain', bg: '#fff'` for stickers and cut-outs, and `pos: '50% 30%'` to choose which part of a photo stays in frame.
3. Put its id in the `cats` list of any screen kind in `KINDS`. A kind with several cats picks one at random.

## Add a joke
Add a string to that kind's `jokes` list. The same joke is never shown twice in a row.

## Kinds
streams, loadfail, noresults, source, notfound, comments, badlink, slow, update, pagefail, nothing, nomedia, emptylist, emptylib, nodl, nofollow, win

`npm test` checks that every image exists, every kind points at real cats, and every cat is used somewhere.
