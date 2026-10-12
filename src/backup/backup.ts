// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Backup export/apply — the Obsidian-facing half of the backup format
// (src/backup/backup-format.ts owns the pure serialization and merge rules).

import { Notice } from 'obsidian';
import type CurtisPlugin from '../main';
import { downloadBlob } from '../utils/download';
import { serializeBackup, stripCredentialFields, mergeByIdKeepExisting, mergeImportedSettings, type BackupBundle } from './backup-format';

/** Build and download a full backup zip: every conversation plus prompt
 *  library, harness profiles, and settings (credentials stripped). */
export function downloadBackupZip(plugin: CurtisPlugin): void {
	const s = plugin.settings;
	const bytes = serializeBackup({
		conversations: plugin.conversationStore.getAllConversations(),
		promptLibrary: s.promptLibrary,
		// Built-in harnesses live in code; only the user's own profiles ride.
		harnessProfiles: s.harnessProfiles.filter((p) => !p.builtin),
		settings: stripCredentialFields(s),
		pluginVersion: plugin.manifest.version,
	});
	const now = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	const name = `curtis-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
	downloadBlob(bytes, name, 'application/zip');
	new Notice(`Backup exported (${plugin.conversationStore.getAllConversations().length} conversations). API keys are not included — re-enter them after restoring elsewhere.`, 8000);
}

/** Which backup sections to apply on import. Conversations always import
 *  through the normal chat pipeline; these are the opt-in extras. */
export interface BackupApplyOptions {
	promptLibrary: boolean;
	harnessProfiles: boolean;
	settings: boolean;
}

export interface BackupApplyResult {
	promptsAdded: number;
	promptsSkipped: number;
	harnessesAdded: number;
	harnessesSkipped: number;
	settingsApplied: boolean;
}

/** Apply the selected sections of an imported backup. Prompts and harnesses
 *  merge by id (existing entries win); settings apply wholesale but with
 *  local credentials preserved (see mergeImportedSettings). */
export async function applyBackupBundle(plugin: CurtisPlugin, bundle: BackupBundle, opts: BackupApplyOptions): Promise<BackupApplyResult> {
	const s = plugin.settings;
	const result: BackupApplyResult = {
		promptsAdded: 0,
		promptsSkipped: 0,
		harnessesAdded: 0,
		harnessesSkipped: 0,
		settingsApplied: false,
	};

	if (opts.promptLibrary && bundle.promptLibrary.length > 0) {
		const { merged, added, skipped } = mergeByIdKeepExisting(s.promptLibrary, bundle.promptLibrary);
		s.promptLibrary = merged;
		result.promptsAdded = added;
		result.promptsSkipped = skipped;
	}
	if (opts.harnessProfiles && bundle.harnessProfiles.length > 0) {
		const { merged, added, skipped } = mergeByIdKeepExisting(s.harnessProfiles, bundle.harnessProfiles);
		s.harnessProfiles = merged;
		result.harnessesAdded = added;
		result.harnessesSkipped = skipped;
	}
	if (opts.settings && bundle.settings) {
		// The settings section carries agents, scheduled jobs, and provider
		// setup; prompts/harnesses are owned by their own toggles above, so
		// the merged local lists win over the imported copies here.
		const applied = mergeImportedSettings(s, bundle.settings);
		applied.promptLibrary = s.promptLibrary;
		applied.harnessProfiles = s.harnessProfiles;
		Object.assign(s, applied);
		result.settingsApplied = true;
	}

	await plugin.saveSettings();
	plugin.refreshChatViews();
	return result;
}
