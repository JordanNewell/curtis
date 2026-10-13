// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// SettingsAgentStore tests — pins the CRITICAL contract: getAgents() returns
// the LIVE settings.agents array BY REFERENCE, so manager-side creates and
// updates land in settings (and survive saveSettings). VaultClaimsFilePort
// gets basic TFile/folder semantics coverage over the shared obsidian stub.

import { describe, expect, it } from 'vitest';
import { TFile } from '../test/obsidian-stub';
import type { Agent } from '@curtis/shared';
import { SettingsAgentStore, VaultClaimsFilePort } from './agent-store';

const makeAgent = (name: string): Agent => ({
	id: `agent-${name}`,
	name,
	emoji: '🤖',
	systemPrompt: 'you are a test',
	providerId: 'openai',
	modelId: 'gpt-test',
	tools: { vault: true, web: false, mcp: false, gcp: false },
	memory: 'inherit',
	createdAt: 0,
});

type FakePlugin = {
	settings: {
		agents: Agent[];
		activeProvider: string;
		activeModel: string;
		enableMemory: boolean;
		pcpFilePath: string;
	};
	saves: number;
	saveSettings: () => Promise<void>;
};

const makePlugin = (): FakePlugin => {
	const fake: FakePlugin = {
		settings: {
			agents: [],
			activeProvider: 'openai',
			activeModel: 'gpt-test',
			enableMemory: true,
			pcpFilePath: 'AI/claims.json',
		},
		saves: 0,
		saveSettings: async () => {
			fake.saves++;
		},
	};
	return fake;
};

const storeOf = (fake: FakePlugin): SettingsAgentStore =>
	// The real plugin type is structural overkill here — the store only
	// touches settings + saveSettings, both of which the fake provides.
	new SettingsAgentStore(fake as unknown as ConstructorParameters<typeof SettingsAgentStore>[0]);

describe('SettingsAgentStore.getAgents', () => {
	it('returns the LIVE settings.agents array by reference', () => {
		const fake = makePlugin();
		fake.settings.agents = [makeAgent('a')];
		expect(storeOf(fake).getAgents()).toBe(fake.settings.agents);
	});

	it('surfaces pushes from the manager into settings', () => {
		const fake = makePlugin();
		storeOf(fake).getAgents().push(makeAgent('created'));
		expect(fake.settings.agents).toHaveLength(1);
		expect(fake.settings.agents[0].name).toBe('created');
	});

	it('surfaces in-place mutations of elements into settings', () => {
		const fake = makePlugin();
		fake.settings.agents = [makeAgent('a')];
		const live = storeOf(fake).getAgents();
		live[0].name = 'renamed';
		live[0].modelId = 'other-model';
		expect(fake.settings.agents[0].name).toBe('renamed');
		expect(fake.settings.agents[0].modelId).toBe('other-model');
	});
});

describe('SettingsAgentStore mutations + persistence', () => {
	it('replaceAgents swaps the roster in settings', () => {
		const fake = makePlugin();
		const next = [makeAgent('b')];
		storeOf(fake).replaceAgents(next);
		expect(fake.settings.agents).toBe(next);
		expect(storeOf(fake).getAgents()).toBe(next);
	});

	it('exposes settings fields through the getters', () => {
		const fake = makePlugin();
		const store = storeOf(fake);
		expect(store.activeProvider).toBe('openai');
		expect(store.activeModel).toBe('gpt-test');
		expect(store.enableMemory).toBe(true);
		expect(store.pcpFilePath).toBe('AI/claims.json');
	});

	it('save() routes through saveSettings()', async () => {
		const fake = makePlugin();
		void storeOf(fake).save();
		await Promise.resolve(); // save is fire-and-forget — let the promise run
		expect(fake.saves).toBe(1);
	});
});

describe('VaultClaimsFilePort', () => {
	const files = new Map<string, TFile | { path: string }>();
	const contents = new Map<string, string>();
	const createdFolders: string[] = [];
	const opened: string[] = [];

	const app = {
		vault: {
			getAbstractFileByPath: (p: string) => files.get(p) ?? null,
			read: async (f: TFile) => contents.get(f.path) ?? '',
			create: async (path: string, data: string) => {
				files.set(path, new TFile(path));
				contents.set(path, data);
			},
			createFolder: async (path: string) => {
				createdFolders.push(path);
				files.set(path, { path });
			},
		},
		workspace: {
			openLinkText: async (path: string) => {
				opened.push(path);
			},
		},
	} as unknown as ConstructorParameters<typeof VaultClaimsFilePort>[0];

	const port = new VaultClaimsFilePort(app);

	it('readFile returns content for files, null for folders and missing paths', async () => {
		files.clear();
		contents.clear();
		files.set('claims.json', new TFile('claims.json'));
		contents.set('claims.json', '{"claims":[]}');
		files.set('dir', { path: 'dir' });
		await expect(port.readFile('claims.json')).resolves.toBe('{"claims":[]}');
		await expect(port.readFile('dir')).resolves.toBeNull();
		await expect(port.readFile('missing.json')).resolves.toBeNull();
	});

	it('fileExists is true only for files (false for folders)', () => {
		files.clear();
		files.set('f.json', new TFile('f.json'));
		files.set('d', { path: 'd' });
		expect(port.fileExists('f.json')).toBe(true);
		expect(port.fileExists('d')).toBe(false);
		expect(port.fileExists('nope')).toBe(false);
	});

	it('createFolder delegates (and may throw on duplicates)', async () => {
		createdFolders.length = 0;
		await port.createFolder('AI/fresh');
		expect(createdFolders).toEqual(['AI/fresh']);
	});

	it('createFile creates the parent folder then the file', async () => {
		files.clear();
		contents.clear();
		createdFolders.length = 0;
		await port.createFile('AI/new/claims.json', '{}');
		expect(createdFolders).toContain('AI/new');
		expect(files.get('AI/new/claims.json')).toBeInstanceOf(TFile);
		expect(contents.get('AI/new/claims.json')).toBe('{}');
	});

	it('openInWorkspace opens the path', async () => {
		opened.length = 0;
		await port.openInWorkspace('AI/claims.json');
		expect(opened).toEqual(['AI/claims.json']);
	});
});
