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
writeFileSync('src/styles.css', css);
console.log(`inlined dark (${howDark}) + light (${howLight}) + avatar dark (${howAvatarDark}) + avatar light (${howAvatarLight}) + badge (${howBadge}) + about (${howAbout}); styles.css now ${css.length} bytes`);
