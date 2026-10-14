// Render the canonical Curtis mark (assets/brand/mark.svg, 2026-10 rebrand)
// to the transparent PNG variants inlined into src/styles.css by inline-logo.mjs:
//   assets/logo-transparent.png        -> dark theme  (.ai-chat-empty-icon, .ai-message-avatar)
//   assets/logo-transparent-light.png  -> light theme (.theme-light overrides)
//   assets/about-logo.png              -> Settings -> About tile
// All three carry the identity green #1E7A46 (mood board --live; the stripes
// are cutouts, so one ink works on both themes). Transparent background —
// the glyph floats on the user's theme.
// Usage: node scripts/render-mark.mjs
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#1E7A46';
const SIZE = 288;
const svg = readFileSync(resolve(ROOT, 'assets/brand/mark.svg'), 'utf8');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0"><div id="mark" style="width:${SIZE}px;height:${SIZE}px;padding:9%;box-sizing:border-box;color:${INK};display:flex">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body>`);
const el = page.locator('#mark');
for (const out of ['assets/logo-transparent.png', 'assets/logo-transparent-light.png', 'assets/about-logo.png']) {
  await el.screenshot({ path: resolve(ROOT, out), omitBackground: true });
  console.log('wrote ' + out);
}
// QC probes: the mark must read at ribbon (24px) and modal-lockup (16px) sizes.
for (const qc of [24, 16]) {
  await page.setContent(`<body style="margin:0;background:#1a1a1a"><div id="mark" style="width:${qc}px;height:${qc}px;color:${INK};display:flex">${svg.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div></body>`);
  await page.locator('#mark').screenshot({ path: resolve(ROOT, `C:/tmp/mark-qc-${qc}.png`), omitBackground: false });
  console.log(`wrote C:/tmp/mark-qc-${qc}.png`);
}
await page.close();
await browser.close();
