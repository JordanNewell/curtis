// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Note-link convention tests — duck-typed reader + pure guidance builder,
// node-safe (no Obsidian imports).

import { describe, expect, it } from 'vitest';
import { noteLinkGuidance, noteLinkGuidanceForVault, readNoteLinkConventions } from './links';

type FakeVault = { configDir: string; adapter: { read(path: string): Promise<string> } };

const vaultWith = (content: string): FakeVault => ({
	configDir: 'config-dir',
	adapter: { read: async () => content },
});
const missingVault = (): FakeVault => ({
	configDir: 'config-dir',
	adapter: { read: async () => {
		throw new Error('file not found');
	} },
});

describe('readNoteLinkConventions', () => {
	it('reads the config from the vault\'s configured config dir', async () => {
		let requested: string | undefined;
		const vault: FakeVault = {
			configDir: '.customConfig',
			adapter: { read: async (path) => {
				requested = path;
				return '{"useMarkdownLinks":true}';
			} },
		};
		const c = await readNoteLinkConventions(vault);
		expect(requested).toBe('.customConfig/app.json');
		expect(c.useWikilinks).toBe(false);
	});
	it('defaults to wikilinks when the config omits the key', async () => {
		const c = await readNoteLinkConventions(vaultWith('{}'));
		expect(c.useWikilinks).toBe(true);
	});

	it('respects useMarkdownLinks: true', async () => {
		const c = await readNoteLinkConventions(vaultWith('{"useMarkdownLinks":true}'));
		expect(c.useWikilinks).toBe(false);
	});

	it('falls back to wikilinks for a missing config file', async () => {
		const c = await readNoteLinkConventions(missingVault());
		expect(c.useWikilinks).toBe(true);
	});

	it('falls back to wikilinks for a malformed config file', async () => {
		const c = await readNoteLinkConventions(vaultWith('{not json'));
		expect(c.useWikilinks).toBe(true);
	});
});

describe('noteLinkGuidance', () => {
	it('prescribes wikilinks in wikilink mode', () => {
		const g = noteLinkGuidance({ useWikilinks: true });
		expect(g).toContain('[[wikilinks]]');
		expect(g).not.toContain('never [[wikilinks]]');
	});

	it('prescribes markdown links and forbids wikilinks in markdown mode', () => {
		const g = noteLinkGuidance({ useWikilinks: false });
		expect(g).toContain('markdown links');
		expect(g).toContain('never [[wikilinks]]');
	});

	it('carries the existence rule in both modes', () => {
		for (const useWikilinks of [true, false]) {
			expect(noteLinkGuidance({ useWikilinks })).toContain('Never invent a link target');
		}
	});
});

describe('noteLinkGuidanceForVault', () => {
	it('composes read + render in one shot', async () => {
		const g = await noteLinkGuidanceForVault(vaultWith('{"useMarkdownLinks":true}'));
		expect(g).toContain('markdown links');
	});
});
