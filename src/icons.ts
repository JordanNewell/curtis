// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Curtis — Custom icon registry.
//
// The Curtis.ai mark (2026-10 rebrand): the ringed C with four stripe
// cutouts, canonical source assets/brand/mark.svg (ink = mood-board
// --live green #1E7A46). This 24px adaptation thickens the ring and
// stripes so they survive ribbon/tab sizes and carries currentColor so
// the mark follows the theme like every built-in Lucide icon; the
// stripes are CUTOUTS (mask), not fills, so they read on both themes.
// The identity-green lockup treatment (.curtis-mark-title in styles.css)
// repaints it #1E7A46. scripts/render-mark.mjs regenerates the transparent
// PNG variants from the canonical SVG — keep the two in sync.

export const CURTIS_ICON_ID = 'curtis-mark';

export const CURTIS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><defs><mask id="curtis-stripes"><rect width="24" height="24" fill="#ffffff"/><rect x="0" y="6.23" width="24" height="0.8" fill="#000000"/><rect x="0" y="8.36" width="24" height="0.8" fill="#000000"/><rect x="0" y="14.94" width="24" height="0.8" fill="#000000"/><rect x="0" y="17.07" width="24" height="0.8" fill="#000000"/></mask></defs><circle cx="12" cy="12" r="11.2" stroke="currentColor" stroke-width="1.1"/><path d="M17.81 6.19 A8.22 8.22 0 1 0 17.81 17.81 L15.3 15.3 A4.67 4.67 0 1 1 15.3 8.7 Z" fill="currentColor" mask="url(#curtis-stripes)"/></svg>`;
