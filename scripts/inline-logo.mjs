// Inline the transparent mark variants into src/styles.css as PNG data URIs,
// in both slots the mark appears: the empty-state hero and the 20px
// per-message avatar (which must stay byte-identical to the hero mark).
//   assets/logo-transparent.png         -> dark theme  (.ai-chat-empty-icon, .ai-message-avatar)
//   assets/logo-transparent-light.png   -> light theme (.theme-light overrides of both)
// The marks are transparent PNGs of the frozen C. geometry (no baked disc —
// the glyph floats on the user's theme). Regenerate them from the mark SVG
// when the identity changes; colors come from curtis-ai-tech/tokens.json.
// Idempotent per variant: each is inserted via its __CURTIS_LOGO_DATA_URI__*
// placeholder, or by replacing the URI inside its OWN CSS rule (scoped by
// selector — never "first match", which can clobber the other slot).
import { readFileSync, writeFileSync } from 'fs';

const badge = 'data:image/png;base64,' + readFileSync('assets/newell-badge.png').toString('base64');
const about = 'data:image/png;base64,' + readFileSync('assets/about-logo.png').toString('base64');
const dark = 'data:image/png;base64,' + readFileSync('assets/logo-transparent.png').toString('base64');
const light = 'data:image/png;base64,' + readFileSync('assets/logo-transparent-light.png').toString('base64');
let css = readFileSync('src/styles.css', 'utf8');

// Replace the data URI inside the rule opened by `selector`.
function inlineVariant(uri, placeholder, selector) {
  if (css.includes(placeholder)) {
    css = css.replace(placeholder, uri);
    return 'placeholder';
  }
  // Find the selector as an actual rule opener: preceded by a newline (rules
  // live at column 0) and followed by `{`. The name otherwise also matches
  // inside comments, the media query, and the .theme-light selector itself.
  let braceOpen = -1;
  let pos = 0;
  for (;;) {
    const idx = css.indexOf(selector, pos);
    if (idx === -1) break;
    const atLineStart = idx === 0 || css[idx - 1] === '\n';
    if (atLineStart && /^\s*\{/.test(css.slice(idx + selector.length))) {
      braceOpen = css.indexOf('{', idx + selector.length);
      break;
    }
    pos = idx + selector.length;
  }
  if (braceOpen === -1) return null;
  const braceClose = css.indexOf('}', braceOpen);
  const chunk = css.slice(braceOpen, braceClose);
  if (!chunk.includes("url('data:image/png;base64,")) return null;
  const updated = chunk.replace(/url\('data:image\/png;base64,[^']+'\)/, `url('${uri}')`);
  css = css.slice(0, braceOpen) + updated + css.slice(braceClose);
  return 'replaced';
}

const howDark = inlineVariant(dark, '__CURTIS_LOGO_DATA_URI__', '.ai-chat-empty-icon');
const howLight = inlineVariant(light, '__CURTIS_LOGO_DATA_URI_LIGHT__', '.theme-light .ai-chat-empty-icon');
const howAvatarDark = inlineVariant(dark, '__CURTIS_LOGO_AVATAR_DATA_URI__', '.ai-message-avatar');
const howAvatarLight = inlineVariant(light, '__CURTIS_LOGO_AVATAR_DATA_URI_LIGHT__', '.theme-light .ai-message-avatar');
const howBadge = inlineVariant(badge, '__CURTIS_NEWELL_BADGE_DATA_URI__', '.curtis-newell-badge');
const howAbout = inlineVariant(about, '__CURTIS_ABOUT_LOGO_DATA_URI__', '.curtis-about-logo');
if (!howDark || !howLight || !howAvatarDark || !howAvatarLight || !howBadge || !howAbout) {
  console.error(`could not inline dark=${howDark} light=${howLight} avatarDark=${howAvatarDark} avatarLight=${howAvatarLight} badge=${howBadge} about=${howAbout} — check src/styles.css`);
  process.exit(1);
}

// Inline the bundled IBM Plex woff2 files as @font-face data URIs between
// the __CURTIS_FONTS__ markers. Obsidian only ships main.js/manifest.json/
// styles.css from releases, so a fonts/ folder would 404 in production —
// data URIs are the only install-proof delivery. Idempotent: the block
// between the markers is regenerated from assets/fonts on every run.
const START = '/* __CURTIS_FONTS_START__ */';
const END = '/* __CURTIS_FONTS_END__ */';
const startIdx = css.indexOf(START);
const endIdx = css.indexOf(END);
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  console.error(`could not inline fonts — ${START}/${END} markers missing from src/styles.css`);
  process.exit(1);
}
const fontFaces = [
  ['IBM Plex Sans', 400, 'plex-sans-latin.woff2'],
  ['IBM Plex Sans', 600, 'plex-sans-latin.woff2'],
  ['IBM Plex Mono', 500, 'plex-mono-500-latin.woff2'],
]
  .map(([family, weight, file]) => `@font-face {\n\tfont-family: '${family}';\n\tfont-style: normal;\n\tfont-weight: ${weight};\n\tfont-display: swap;\n\tsrc: url(data:font/woff2;base64,${readFileSync(`assets/fonts/${file}`).toString('base64')}) format('woff2');\n\tunicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;\n}`)
  .join('\n');
css = css.slice(0, startIdx) + START + '\n' + fontFaces + '\n' + END + css.slice(endIdx + END.length);

writeFileSync('src/styles.css', css);
console.log(`inlined dark (${howDark}) + light (${howLight}) + avatar dark (${howAvatarDark}) + avatar light (${howAvatarLight}) + badge (${howBadge}) + about (${howAbout}) + fonts; styles.css now ${css.length} bytes`);
