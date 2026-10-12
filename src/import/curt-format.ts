// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// .curt pure serialization — the format contract, split from the Obsidian
// I/O in curt.ts so node-side modules (backup-format, detect) can import it
// without pulling in Obsidian.

import type { Conversation, ConversationMessage } from '../types';

const CURT_MAGIC = 'curtis-conversation';
const CURT_VERSION = 1;

function isMessage(v: unknown): v is ConversationMessage {
	if (!v || typeof v !== 'object') return false;
	const m = v as Record<string, unknown>;
	return (
		typeof m.id === 'string' &&
		(m.role === 'user' || m.role === 'assistant' || m.role === 'system' || m.role === 'tool') &&
		typeof m.content === 'string' &&
		typeof m.timestamp === 'number'
	);
}

/**
 * Serialize a conversation as a .curt file body. When `pluginVersion` is
 * given (callers pass `plugin.manifest.version`), the file is stamped with a
 * `generator` provenance field; without it the field is omitted entirely —
 * the version is never hardcoded.
 */
export function serializeCurt(conv: Conversation, pluginVersion?: string): string {
	const file = {
		curt: CURT_MAGIC,
		version: CURT_VERSION,
		conversation: conv,
		...(pluginVersion ? { generator: `curtis@${pluginVersion}` } : {}),
	};
	return JSON.stringify(file, null, '\t');
}

/**
 * Parse a .curt body. Returns null when the magic/version/shape doesn't
 * validate — callers report the file as failed rather than importing a
 * half-parsed conversation.
 */
export function parseCurt(raw: string): Conversation | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	const f = data as { curt?: string; version?: number; conversation?: Partial<Conversation> };
	if (f?.curt !== CURT_MAGIC || f?.version !== CURT_VERSION) return null;
	const conv = f.conversation;
	if (
		!conv ||
		typeof conv.id !== 'string' ||
		typeof conv.title !== 'string' ||
		typeof conv.createdAt !== 'number' ||
		typeof conv.updatedAt !== 'number' ||
		!Array.isArray(conv.messages) ||
		!conv.messages.every(isMessage)
	) {
		return null;
	}
	return conv as Conversation;
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
