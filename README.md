# WishTube Desktop

Local-first open video client for Linux and Windows. PeerTube, Odysee, Internet Archive, media.ccc.de and Wikimedia Commons in one clean app. No account, no tracking, no server.

## Run / build
```
npm install
npm start                 # run from source
npm test                  # ranker tests
npm run dist:linux        # dist/WishTube-*-linux-x86_64.AppImage
npm run dist:win          # dist/WishTube-*-win-x64.exe (portable) + installer
```
Fedora: `chmod +x WishTube-*.AppImage && ./WishTube-*.AppImage`
(If it complains about FUSE: `sudo dnf install fuse fuse-libs`, or run with `--appimage-extract-and-run`.)
For a properly built Windows exe, push a `v*` tag: GitHub Actions builds both on native runners.

## The ranker ("Atlas") – `renderer/rec/`
- **Multi-interest taste**: up to 8 interest clusters, plus a 2-hour session vector.
- **Semantic layer**: learns which words are used together from every video fetched (on-device random indexing), so "pizza" matches "pasta".
- **Graded signals**: finishing > opening; bounce, skip and "not interested" push away; ignored impressions count lightly.
- **Learned weights**: logistic model trained online on your behaviour, bounded around sane priors.
- **Exploration**: Thompson-style sampling on uncertain creators; seeded so feeds don't reshuffle.
- **Diversity**: MMR re-rank, per-creator and per-source run limits.
- **Per-source popularity normalisation**, cross-source de-duplication, evergreen-aware freshness, language detection, title-quality prior.
- **Transparent**: Settings > Your taste shows interests and learned weights. Every card says why it's shown.

## Desktop-only
Persistent candidate pool (instant start, background refresh, 1500 videos), interest-driven retrieval across all sources, Ctrl+K palette with local search, paste-a-link, full keyboard player, HLS with quality menu, PiP, chapters, captions, native downloads, tray, media keys, single instance, profile export/import.
