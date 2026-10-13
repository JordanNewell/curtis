// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// .curt — Curtis's branded single-file conversation format.
//
// One .curt file = one conversation, serialized as JSON with a magic field.
// JSON (rather than the markdown+marker layout) because a portable file must
// be byte-robust: no marker-escaping edge cases, and base64 images / tool
// calls survive verbatim. The export path uses a browser download; the import
// path validates strictly — a hand-corrupted file is reported, not guessed.
//
// The format contract itself (serialize/parse, node-safe) lives in
// curt-format.ts; this file is the Obsidian I/O layer.
//
// Exports also stamp a `generator` field ("curtis@<version>") naming
// the app and version that wrote the file — provenance only. Readers ignore
// it entirely: first-party files written before the field existed and
// third-party writers without it import identically.

import { Notice, TFile, type App } from 'obsidian';
import { zipSync, strToU8 } from 'fflate';
import type { Conversation } from '@curtis/shared';
import { downloadBlob, sanitizeFilename } from '../utils/download';
import { serializeCurt, parseCurt, curtZipEntryName } from './curt-format';

export { serializeCurt, parseCurt } from './curt-format';

/** Trigger a browser download of the conversation as a .curt file. */
export function downloadConversationCurt(conv: Conversation, pluginVersion?: string): void {
	const body = serializeCurt(conv, pluginVersion);
	downloadBlob(body, `${sanitizeFilename(conv.title || 'conversation')}.curt`, 'application/json;charset=utf-8');
}

/**
 * Export every conversation as a single zip of .curt files — whole-history
 * backup, vault-to-vault move, or machine-to-machine transfer. The zip is
 * re-importable: drop it into another vault and import it (auto-detected).
 * Empty conversations are skipped; the rest land byte-identical to their
 * single-file exports.
 */
export function downloadConversationsCurtZip(conversations: Conversation[], pluginVersion?: string): void {
	const entries: Record<string, Uint8Array> = {};
	let count = 0;
	for (const conv of conversations) {
		if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
		entries[curtZipEntryName(conv)] = strToU8(serializeCurt(conv, pluginVersion));
		count++;
	}
	if (count === 0) {
		new Notice('No conversations to export');
		return;
	}
	const now = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	const zipName = `curtis-chats-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
	downloadBlob(zipSync(entries), zipName, 'application/zip');
	new Notice(`Exported ${count} conversation${count === 1 ? '' : 's'} to ${zipName}`, 8000);
}

/**
 * Parse a vault .curt file (click-to-import path). Returns null when the
 * file isn't a valid .curt conversation — .curt round-trips full fidelity,
 * so on success the importer writes it as-is.
 */
export async function readCurtFile(app: App, file: TFile): Promise<Conversation | null> {
	try {
		return parseCurt(await app.vault.read(file));
	} catch {
		return null;
	}
}
