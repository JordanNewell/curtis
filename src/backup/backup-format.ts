// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Full-backup bundle — the portable "vault state snapshot" format.
//
// One zip = conversations (.curt, identical to the bulk export) plus the
// settings-backed sections users own: prompt library, harness profiles, and
// plugin settings. Credentials never enter the file (see stripCredentialFields);
// on import, settings application is opt-in and local credentials survive the
// merge (see mergeImportedSettings). The manifest gates the reader exactly the
// way the .curt magic field does: a corrupted or foreign zip reports as
// unknown, never half-imports.
//
// Obsidian-free on purpose — serialization and merge rules are pure data
// transforms and unit-testable under node (see backup-format.test.ts).

import { zipSync, strToU8, strFromU8 } from 'fflate';
import type { Conversation, CurtisSettings, HarnessProfile, PromptLibraryEntry } from '../types';
import { serializeCurt, parseCurt, curtZipEntryName } from '../import/curt-format';

const BACKUP_MAGIC = 'curtis-backup';
const BACKUP_VERSION = 1;
const MANIFEST_PATH = 'manifest.json';
const CONVERSATIONS_DIR = 'conversations';
const SETTINGS_PATH = 'settings.json';
const PROMPTS_PATH = 'prompts.json';
const HARNESSES_PATH = 'harnesses.json';

export interface BackupManifest {
	curtis: typeof BACKUP_MAGIC;
	version: number;
	/** Provenance only: "curtis-ai-chat@<version>". Readers ignore it. */
	generator?: string;
	exportedAt: number;
}

/** Credential fields stripped at export and restored from the local copy at
 *  import — the bundle is shareable-by-default, keys never ride it. */
const PROVIDER_SECRET_FIELDS = ['apiKey', 'apiKeyRef', 'oauthRef', 'oauthJson'] as const;

/** Sections carried inside the zip, parsed out for the import UI. */
export interface BackupBundle {
	manifest: BackupManifest;
	conversations: Conversation[];
	promptLibrary: PromptLibraryEntry[];
	harnessProfiles: HarnessProfile[];
	/** Present only when the zip carried a settings section. */
	settings?: CurtisSettings;
}

/** Deep-copy `settings` minus every credential-bearing field. The result is
 *  what gets serialized; the source object is never mutated. */
export function stripCredentialFields(settings: CurtisSettings): CurtisSettings {
	const out = JSON.parse(JSON.stringify(settings)) as CurtisSettings;

	for (const config of Object.values(out.providerConfigs ?? {})) {
		for (const field of PROVIDER_SECRET_FIELDS) delete config[field];
	}
	// Sign-in with ChatGPT host id identifies the installation to OpenAI's
	// client registration — credential-adjacent, machine-specific.
	delete out.chatgptHostId;
	// Discovery cache: rebuilt on the new machine, pure weight in a backup.
	delete out.discoveredModels;
	// GCP service-account key: plaintext blob or its keychain ref.
	delete out.gcpServiceAccountRef;
	delete out.gcpServiceAccountJson;
	// Dedicated dictation key (Groq/custom STT endpoints): same treatment.
	delete out.sttApiKeyRef;
	delete out.sttApiKeyPlain;
	// MCP server bearer token is machine-local (bound to 127.0.0.1).
	out.mcpServerToken = '';
	// MCP server headers can carry auth values. Keep the header names so the
	// user sees what to refill; drop the secrets.
	out.mcpServers = (out.mcpServers ?? []).map((server) => ({
		...server,
		headers: (server.headers ?? []).map((h) => ({ name: h.name, value: '' })),
	}));
	return out;
}

/** Build the backup zip bytes: manifest + conversations + prompts +
 *  harnesses + settings. Credentials are stripped here, defensively — a
 *  caller passing an unsanitized settings object still gets a key-free zip. */
export function serializeBackup(input: {
	conversations: Conversation[];
	promptLibrary: PromptLibraryEntry[];
	harnessProfiles: HarnessProfile[];
	settings: CurtisSettings;
	pluginVersion?: string;
}): Uint8Array {
	const manifest: BackupManifest = {
		curtis: BACKUP_MAGIC,
		version: BACKUP_VERSION,
		exportedAt: Date.now(),
	};
	if (input.pluginVersion) manifest.generator = `curtis-ai-chat@${input.pluginVersion}`;

	const entries: Record<string, Uint8Array> = {
		[MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, '\t')),
		[PROMPTS_PATH]: strToU8(JSON.stringify({ curtis: 'prompt-library', version: 1, entries: input.promptLibrary }, null, '\t')),
		[HARNESSES_PATH]: strToU8(JSON.stringify({ curtis: 'harness-profiles', version: 1, entries: input.harnessProfiles }, null, '\t')),
		[SETTINGS_PATH]: strToU8(JSON.stringify(stripCredentialFields(input.settings), null, '\t')),
	};
	for (const conv of input.conversations) {
		if (!conv || !Array.isArray(conv.messages) || conv.messages.length === 0) continue;
		entries[`${CONVERSATIONS_DIR}/${curtZipEntryName(conv)}`] = strToU8(serializeCurt(conv, input.pluginVersion));
	}
	return zipSync(entries);
}

function parseEnvelope<T>(raw: string, kind: string): T[] {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return [];
	}
	const f = data as { curtis?: string; entries?: unknown };
	if (f?.curtis !== kind || !Array.isArray(f.entries)) return [];
	return f.entries.filter((e): e is T => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string');
}

/** Parse a zip's entries into a BackupBundle. Returns null when the manifest
 *  is missing or doesn't validate — callers treat the zip as a non-backup
 *  (it may still be a plain .curt bulk export, whose detection runs after). */
export function parseBackupEntries(entries: Record<string, Uint8Array>): BackupBundle | null {
	const manifestRaw = entries[MANIFEST_PATH];
	if (!manifestRaw) return null;
	let manifest: unknown;
	try {
		manifest = JSON.parse(strFromU8(manifestRaw));
	} catch {
		return null;
	}
	const m = manifest as Partial<BackupManifest>;
	if (m?.curtis !== BACKUP_MAGIC || m?.version !== BACKUP_VERSION || typeof m?.exportedAt !== 'number') return null;

	const conversations: Conversation[] = [];
	for (const [path, bytes] of Object.entries(entries)) {
		if (!path.toLowerCase().endsWith('.curt')) continue;
		const conv = parseCurt(strFromU8(bytes));
		if (conv) conversations.push(conv);
	}

	let settings: CurtisSettings | undefined;
	if (entries[SETTINGS_PATH]) {
		try {
			const parsed: unknown = JSON.parse(strFromU8(entries[SETTINGS_PATH]));
			if (parsed && typeof parsed === 'object' && 'providerConfigs' in parsed) settings = parsed as CurtisSettings;
		} catch {
			// Settings section corrupted — bundle still imports chats/prompts.
		}
	}

	return {
		manifest: m as BackupManifest,
		conversations,
		promptLibrary: entries[PROMPTS_PATH] ? parseEnvelope<PromptLibraryEntry>(strFromU8(entries[PROMPTS_PATH]), 'prompt-library') : [],
		harnessProfiles: entries[HARNESSES_PATH] ? parseEnvelope<HarnessProfile>(strFromU8(entries[HARNESSES_PATH]), 'harness-profiles') : [],
		settings,
	};
}

/** Merge-by-id that keeps the existing entry on conflict — a prompt the user
 *  edited since the export is never clobbered by its older exported self. */
export function mergeByIdKeepExisting<T extends { id: string }>(existing: T[], incoming: T[]): { merged: T[]; added: number; skipped: number } {
	const ids = new Set(existing.map((e) => e.id));
	let added = 0;
	let skipped = 0;
	const merged = [...existing];
	for (const entry of incoming) {
		if (ids.has(entry.id)) {
			skipped++;
			continue;
		}
		ids.add(entry.id);
		merged.push(entry);
		added++;
	}
	return { merged, added, skipped };
}

/** Apply imported settings over local ones, preserving everything the export
 *  stripped plus the user's local credentials: per-provider secret fields,
 *  ChatGPT host id, GCP service-account material, the dictation key, the MCP
 *  server token, and MCP header values (the export blanks them; the local
 *  values win whenever the same server id/name exists locally). */
export function mergeImportedSettings(local: CurtisSettings, imported: CurtisSettings): CurtisSettings {
	const out: CurtisSettings = { ...imported };

	out.providerConfigs = { ...imported.providerConfigs };
	for (const [id, localConfig] of Object.entries(local.providerConfigs ?? {})) {
		const target = out.providerConfigs[id];
		if (!target) continue;
		for (const field of PROVIDER_SECRET_FIELDS) {
			if (localConfig[field]) (target as unknown as Record<string, unknown>)[field] = localConfig[field];
		}
	}

	out.chatgptHostId = local.chatgptHostId;
	out.discoveredModels = local.discoveredModels;
	out.gcpServiceAccountRef = local.gcpServiceAccountRef;
	out.gcpServiceAccountJson = local.gcpServiceAccountJson;
	out.sttApiKeyRef = local.sttApiKeyRef;
	out.sttApiKeyPlain = local.sttApiKeyPlain;
	out.mcpServerToken = local.mcpServerToken;

	if (imported.mcpServers) {
		out.mcpServers = imported.mcpServers.map((server) => {
			const localServer = (local.mcpServers ?? []).find((s) => s.id === server.id || s.name === server.name);
			if (!localServer) return server;
			return {
				...server,
				headers: server.headers.map((h) => ({
					name: h.name,
					value: localServer.headers.find((lh) => lh.name === h.name)?.value ?? h.value,
				})),
			};
		});
	}
	return out;
}
