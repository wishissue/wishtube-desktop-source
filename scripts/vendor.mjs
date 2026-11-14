// Copies hls.js into the renderer so the packaged app has no runtime network dependency for the player.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
const src = 'node_modules/hls.js/dist/hls.min.js';
if (!existsSync(src)) { console.error('hls.js missing, run npm install first'); process.exit(1); }
mkdirSync('renderer/vendor', { recursive: true });
copyFileSync(src, 'renderer/vendor/hls.min.js');
console.log('vendored hls.js');
