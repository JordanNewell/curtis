// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// .curt pure serialization — the format contract, split from the Obsidian
// I/O in curt.ts so node-side modules (backup-format, detect) can import it
// without pulling in Obsidian.
//
// The format rules (envelope, magic/version check, per-message guard,
// round-trip preservation, BOM tolerance) live in the canonical `curt-format`
// npm package (dot_curt); this module is a thin adapter that keeps the
// plugin's public surface: serializeCurt's optional "curtis@<version>"
// generator stamp and curtZipEntryName, which are app-level conveniences,
// not format rules.

import {
	parseCurt as parseCurtFile,
	serializeCurt as serializeCurtFile,
} from 'curt-format';
import type { CurtConversation } from 'curt-format';
import type { Conversation } from '@curtisai/shared';

/**
 * Serialize a conversation as a .curt file body. When `pluginVersion` is
 * given (callers pass `plugin.manifest.version`), the file is stamped with a
 * `generator` provenance field; without it the field is omitted entirely —
 * the version is never hardcoded.
 */
export function serializeCurt(conv: Conversation, pluginVersion?: string): string {
	return serializeCurtFile(conv as unknown as CurtConversation, pluginVersion ? `curtis@${pluginVersion}` : undefined);
}

/**
 * Parse a .curt body. Returns null when the magic/version/shape doesn't
 * validate — callers report the file as failed rather than importing a
 * half-parsed conversation. Delegates to curt-format, which also strips a
 * leading UTF-8 BOM per spec 1.1.0.
 */
export function parseCurt(raw: string): Conversation | null {
	return parseCurtFile(raw) as Conversation | null;
}

/** Bulk-export filename: "<created-date> <slug> <id6>.curt" — collision-safe
 *  and chronologically sorted, unlike bare titles. */
export function curtZipEntryName(conv: Conversation): string {
	const d = new Date(conv.createdAt);
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const short = conv.id.split('_').pop()?.slice(-6) || conv.id.slice(-6);
	const slug = conv.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'conversation';
	return `${date} ${slug} ${short}.curt`;
}
