// Render the in-app mark (CURTIS_ICON_SVG geometry from src/icons.ts) to the
// transparent PNG variants inlined into src/styles.css by inline-logo.mjs:
//   assets/logo-transparent.png        -> dark theme  (.ai-chat-empty-icon, .ai-message-avatar)
//   assets/logo-transparent-light.png  -> light theme (.theme-light overrides)
//   assets/about-logo.png              -> Settings -> About tile
// All three carry the identity green #0E7A45 (the on-black identity master
// proves the contrast; one ink on both themes keeps the mark recognizable).
// Transparent background — the glyph floats on the user's theme.
// Usage: node scripts/render-mark.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#0E7A45';
const SIZE = 288;

const icons = readFileSync(resolve(ROOT, 'src/icons.ts'), 'utf8');
const match = icons.match(/CURTIS_ICON_SVG = `([^`]+)`/);
if (!match) throw new Error('CURTIS_ICON_SVG not found in src/icons.ts');
const svg = match[1];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0"><div id="mark" style="width:${SIZE}px;height:${SIZE}px;padding:9%;box-sizing:border-box;color:${INK};display:flex">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body>`);
const el = page.locator('#mark');
for (const out of ['assets/logo-transparent.png', 'assets/logo-transparent-light.png', 'assets/about-logo.png']) {
  await el.screenshot({ path: resolve(ROOT, out), omitBackground: true });
  console.log('wrote ' + out);
}
await page.close();
await browser.close();
