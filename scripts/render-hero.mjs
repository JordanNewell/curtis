// Render assets/hero.html and assets/og.html to PNG.
// hero: 1280x400 README banner · og: 1200x630 social card (both at 2x, downscaled).
// Usage: node scripts/render-hero.mjs [hero|og|all]
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = {
  hero: { html: 'assets/hero.html', out: 'assets/hero.png', width: 1280, height: 400 },
  og: { html: 'assets/og.html', out: 'assets/og.png', width: 1200, height: 630 },
};
const which = process.argv[2] ?? 'hero';
const targets = which === 'all' ? Object.values(TARGETS) : [TARGETS[which]];

// Both pages style .eyebrow/.chip with 'JetBrains Mono', which is not a default
// font — without this the PNGs silently fall back to Consolas/Cascadia Code and
// differ per machine. The real TTFs sit in scripts/fonts/. They are injected
// build-only (addStyleTag) so the HTML files stay directly viewable, and the
// absolute file:// URLs are derived from ROOT at runtime, never hardcoded.
// The 500-weight face is declared across a weight range because the pages
// request weight 600; a bare font-weight: 500 declaration would let Chrome
// synthesize bold on top of the 500 face.
const FONT_FACES = [
  { family: 'JetBrains Mono', file: 'scripts/fonts/jetbrains-mono-500.ttf', weight: '400 700' },
];
const fileUrl = (p) => 'file:///' + resolve(ROOT, p).replaceAll('\\', '/');
const fontFaceCss = FONT_FACES.map((f) => `@font-face{font-family:'${f.family}';`
  + `src:url('${fileUrl(f.file)}') format('truetype');`
  + `font-weight:${f.weight};font-style:normal;}`).join('\n');

const browser = await chromium.launch({ channel: 'chrome' });
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 2 });
  await page.goto('file:///' + (ROOT + '/' + t.html).replaceAll('\\', '/'));
  await page.addStyleTag({ content: fontFaceCss });
  // Font fallback is silent, so verify each injected face actually loaded
  // before screenshotting — otherwise the PNG would depend on whatever
  // monospace font the local machine happens to have installed.
  for (const f of FONT_FACES) {
    const loaded = await page.evaluate(async (family) => {
      const faces = await document.fonts.load(`600 15px '${family}'`);
      return faces.length > 0 && faces.every((x) => x.status === 'loaded');
    }, f.family);
    if (!loaded) throw new Error(`font did not load: ${f.family} (${f.file})`);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: ROOT + '/' + t.out });
  await page.close();
  console.log('wrote ' + t.out);
}
await browser.close();
