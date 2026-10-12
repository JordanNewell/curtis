// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
import { describe, expect, it } from 'vitest';
import { RAG_INDEX_FILENAME, RAG_VAULT_DIR, ragIndexPaths } from './index-paths';

// Any vault-relative plugin dir works — the helpers never hardcode the
// config folder name themselves.
const PLUGIN_DIR = 'plugin-dir/curtis';

describe('ragIndexPaths', () => {
	it('keeps the index beside data.json in the default plugin location', () => {
		const { active, other } = ragIndexPaths('plugin', PLUGIN_DIR);
		expect(active).toBe(`${PLUGIN_DIR}/${RAG_INDEX_FILENAME}`);
		expect(other).toBe(`${RAG_VAULT_DIR}/${RAG_INDEX_FILENAME}`);
	});

	it('targets the synced vault folder in vault location', () => {
		const { active, other } = ragIndexPaths('vault', PLUGIN_DIR);
		expect(active).toBe(`${RAG_VAULT_DIR}/${RAG_INDEX_FILENAME}`);
		expect(other).toBe(`${PLUGIN_DIR}/${RAG_INDEX_FILENAME}`);
	});

	it('is symmetric — each location sees the other as inactive', () => {
		const plugin = ragIndexPaths('plugin', PLUGIN_DIR);
		const vault = ragIndexPaths('vault', PLUGIN_DIR);
		expect(plugin.active).toBe(vault.other);
		expect(plugin.other).toBe(vault.active);
	});
});
