// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Curtis — RAG index storage paths. Pure (no Obsidian imports) so the
// location-flip rules stay unit-testable under node.

export type RagIndexLocation = 'plugin' | 'vault';

/** Synced index folder inside the vault. Dot folders are invisible to
 *  Obsidian search and the quick switcher. */
export const RAG_VAULT_DIR = '.curtis';
export const RAG_INDEX_FILENAME = 'rag-index.json';

/** Active and inactive index paths for the configured location. `pluginDir`
 *  is vault-relative (e.g. `.obsidian/plugins/curtis`). */
export function ragIndexPaths(
	location: RagIndexLocation,
	pluginDir: string
): { active: string; other: string } {
	const pluginPath = `${pluginDir}/${RAG_INDEX_FILENAME}`;
	const vaultPath = `${RAG_VAULT_DIR}/${RAG_INDEX_FILENAME}`;
	return location === 'vault'
		? { active: vaultPath, other: pluginPath }
		: { active: pluginPath, other: vaultPath };
}
