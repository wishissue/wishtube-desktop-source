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

## What's new

- **Shorts, Music, Videos** are separate areas. A video is only a Short when its provider says so (a `shorts` tag, or portrait dimensions it reports); Music needs a provider Music category/tag or an audio item. Nothing is guessed from duration or title.
- **Music**: tracks, albums/releases (Internet Archive items have real tracklists), artists/channels, search, queue, shuffle, repeat, background audio, mini-player.
- **Downloads** rebuilt: resumable HTTP, separate audio+video merged with FFmpeg (no re-encode), HLS, MP3/M4A/Opus extraction, retry, pause/resume, speed/ETA, history. Every finished file is checked with ffprobe.
- **Comments** (PeerTube, Odysee, Internet Archive reviews): read-only, sort, search, replies, link to the original discussion.
- **Playlists**, **video queue**, library filter, search filters (type, duration, provider, sort).
- **Themes**: 11 themes incl. OLED, Material 3, Media Center, Monochrome; accent colours, fonts, text size, density, thumbnail size, corner radius, sidebar layout, custom backgrounds, motion levels.

Downloads use the FFmpeg binaries from `ffmpeg-static` / `ffprobe-static`; if the bundled one cannot run, WishTube falls back to `ffmpeg` on your PATH.

## Patch notes: updates, simpler loading, no Liquid Glass

- **Update checker**: once a day (and at start-up if a day has passed) WishTube looks at the latest Release of [wishissue/wishtube-desktop-source](https://github.com/wishissue/wishtube-desktop-source). If there is a newer version a small card offers **Update now** (downloads with a progress bar, then installs and restarts), **Later** or **Skip this version**. `Settings > Updates` has *Check now* and a daily-check switch. To ship an update: bump `version` in `package.json` and push a tag like `v0.4.0`; the workflow builds and publishes the Release.
- **Loading**: the terminal-style activity logs, the status pill and the "show what this player is doing" button are gone. Every wait now shows one animated logo ring with a single plain sentence.
- **Liquid Glass removed** (theme, settings panel, see-through window code). Saved settings that used it switch to OLED Black.
- **Music and Shorts picking**: popular, good-quality items lead (about 7 in 10 slots); the other 3 in 10 are decent but less-known picks for discovery. Music weighs views, track-like length (about 1.5 to 8 min) and song-like titles, and pushes podcasts, hour-long mixes and clips to the bottom. The order is reshuffled every session, and on the new **Shuffle** button in Music.

## Loading and error screens

- **Loading** is a Material-style wavy circular indicator in your theme's accent colour, with one plain sentence. The app icon is never shown while loading, including on the splash screen.
- **Failures and empty states** show a cat on the left and the explanation on the right, with a joke that changes. The card only uses theme colours, and body text stays above 11:1 contrast in all themes.
- Add your own cats and jokes in `renderer/assets/cats/README.md`.
