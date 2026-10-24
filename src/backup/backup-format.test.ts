// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Backup format tests — pure data transforms, node-safe (no Obsidian imports).

import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import type { Conversation, CurtisSettings, HarnessProfile, PromptLibraryEntry } from '../types';
import {
	serializeBackup,
	parseBackupEntries,
	stripCredentialFields,
	mergeByIdKeepExisting,
	mergeImportedSettings,
} from './backup-format';

const conv = (id: string, title: string): Conversation => ({
	id,
	title,
	createdAt: 1760000000000,
	updatedAt: 1760000001000,
	messages: [
		{ id: 'm1', role: 'user', content: 'hello', timestamp: 1760000000000 },
		{ id: 'm2', role: 'assistant', content: 'hi', timestamp: 1760000001000 },
	],
	provider: '',
	model: '',
});

const prompt = (id: string): PromptLibraryEntry => ({ id, name: id, content: `body ${id}`, createdAt: 1 });

const harness = (id: string, builtin = false): HarnessProfile => ({ id, name: id, description: '', prompt: 'p', ...(builtin ? { builtin: true } : {}) });

const settings = (overrides: Partial<CurtisSettings> = {}): CurtisSettings =>
	({
		activeProvider: 'openai',
		activeModel: 'gpt-test',
		activeHarnessId: 'curtis',
		harnessProfiles: [],
		promptLibrary: [],
		providerConfigs: {
			openai: { enabled: true, apiKey: 'sk-secret', apiKeyRef: 'ref-openai' },
			anthropic: { enabled: false, oauthRef: 'oauth-ref', oauthJson: '{"access_token":"x"}' },
		},
		customProviders: [],
		temperature: 0.7,
		maxTokens: 4096,
		systemPrompt: '',
		streamResponse: true,
		showTokenUsage: false,
		chatViewPosition: 'right',
		notifyOnCompletion: false,
		notifyOnError: false,
		noteSaveFolder: '',
		autoSaveAssistantResponses: false,
		autoSaveFolder: '',
		enterKeyBehavior: 'send',
		chatBackground: 'theme',
		chatWallpaperPath: '',
		ttsVoiceUri: '',
		ttsRate: 1,
		ttsPitch: 1,
		ttsAutoSpeak: false,
		ttsHighlight: false,
		enableMemory: false,
		memoryCaptureMode: 'confirm',
		memoryFilePath: 'memory.md',
		pcpFilePath: '',
		conversationsFolder: 'chats',
		enableJournal: false,
		journalFilePath: 'journal.md',
		enableRag: false,
		enableRelevancePulse: false,
		ragChunkSize: 512,
		ragChunkOverlap: 64,
		ragTopK: 8,
		ragEmbeddingProvider: '',
		ragEmbeddingModel: '',
		ragLocalEmbeddingDtype: 'q8',
		ragIndexLocation: 'plugin',
		enableAgent: false,
		agentMaxTurns: 10,
		agentProviderId: '',
		agentModelId: '',
		swarmMaxFollowers: 3,
		enableWebSearch: false,
		enableMcp: false,
		mcpServers: [{ id: 'srv1', name: 'demo', url: 'http://localhost:9', enabled: true, headers: [{ name: 'Authorization', value: 'Bearer tok' }] }],
		enableGcp: false,
		gcpProjectId: '',
		gcpServiceAccountRef: 'gcp-ref',
		gcpServiceAccountJson: '{"client_email":"x"}',
		enableMcpServer: false,
		mcpServerPort: 7777,
		mcpServerToken: 'local-bearer',
		mcpServerAllowWrites: false,
		agents: [],
		scheduledJobs: [],
		scheduledOutputFolder: '',
		...overrides,
	}) as CurtisSettings;

describe('serializeBackup / parseBackupEntries round-trip', () => {
	it('round-trips conversations, prompts, harnesses, and settings', () => {
		const bytes = serializeBackup({
			conversations: [conv('c1_abc123', 'My Chat')],
			promptLibrary: [prompt('p1')],
			harnessProfiles: [harness('h1')],
			settings: settings(),
			pluginVersion: '2.0.0',
		});
		const bundle = parseBackupEntries(unzipSync(bytes));
		expect(bundle).not.toBeNull();
		expect(bundle!.conversations).toHaveLength(1);
		expect(bundle!.conversations[0].id).toBe('c1_abc123');
		expect(bundle!.promptLibrary.map((p) => p.id)).toEqual(['p1']);
		expect(bundle!.harnessProfiles.map((h) => h.id)).toEqual(['h1']);
		expect(bundle!.settings?.activeProvider).toBe('openai');
		expect(bundle!.manifest.generator).toBe('curtis-ai-chat@2.0.0');
	});

	it('drops empty conversations from the zip', () => {
		const empty = { ...conv('c2_x', 'empty'), messages: [] } as Conversation;
		const bytes = serializeBackup({ conversations: [empty], promptLibrary: [], harnessProfiles: [], settings: settings() });
		expect(parseBackupEntries(unzipSync(bytes))!.conversations).toHaveLength(0);
	});

	it('names conversations under the conversations/ dir with .curt entries', () => {
		const bytes = serializeBackup({ conversations: [conv('c1_abc123', 'My Chat')], promptLibrary: [], harnessProfiles: [], settings: settings() });
		const names = Object.keys(unzipSync(bytes));
		expect(names).toContain('manifest.json');
		expect(names.some((n) => n.startsWith('conversations/') && n.endsWith('.curt'))).toBe(true);
	});
});

describe('parseBackupEntries rejection', () => {
	it('returns null for a zip without a manifest', () => {
		expect(parseBackupEntries({ 'conversations/a.curt': new Uint8Array([1]) })).toBeNull();
	});
	it('returns null for a manifest with the wrong magic', () => {
		const manifest = JSON.stringify({ curtis: 'something-else', version: 1, exportedAt: 1 });
		expect(parseBackupEntries({ 'manifest.json': new TextEncoder().encode(manifest) })).toBeNull();
	});
	it('returns null for a corrupted manifest', () => {
		expect(parseBackupEntries({ 'manifest.json': new TextEncoder().encode('not json') })).toBeNull();
	});
	it('keeps chats and prompts when the settings section is corrupted', () => {
		const bytes = serializeBackup({ conversations: [conv('c1_a', 'x')], promptLibrary: [prompt('p1')], harnessProfiles: [], settings: settings() });
		const entries = unzipSync(bytes);
		entries['settings.json'] = new TextEncoder().encode('{broken');
		const bundle = parseBackupEntries(entries);
		expect(bundle).not.toBeNull();
		expect(bundle!.conversations).toHaveLength(1);
		expect(bundle!.settings).toBeUndefined();
	});
});

describe('stripCredentialFields', () => {
	it('removes every credential-bearing field', () => {
		const stripped = stripCredentialFields(settings());
		expect(stripped.providerConfigs.openai.apiKey).toBeUndefined();
		expect(stripped.providerConfigs.openai.apiKeyRef).toBeUndefined();
		expect(stripped.providerConfigs.anthropic.oauthRef).toBeUndefined();
		expect(stripped.providerConfigs.anthropic.oauthJson).toBeUndefined();
		expect(stripped.chatgptHostId).toBeUndefined();
		expect(stripped.discoveredModels).toBeUndefined();
		expect(stripped.gcpServiceAccountRef).toBeUndefined();
		expect(stripped.gcpServiceAccountJson).toBeUndefined();
		expect(stripped.mcpServerToken).toBe('');
		expect(stripped.mcpServers[0].headers[0].name).toBe('Authorization');
		expect(stripped.mcpServers[0].headers[0].value).toBe('');
	});

	it('does not mutate the source settings', () => {
		const s = settings();
		stripCredentialFields(s);
		expect(s.providerConfigs.openai.apiKey).toBe('sk-secret');
		expect(s.mcpServers[0].headers[0].value).toBe('Bearer tok');
	});

	it('strips keys that ride an exported zip', () => {
		const bytes = serializeBackup({ conversations: [], promptLibrary: [], harnessProfiles: [], settings: settings() });
		const rawSettings: unknown = JSON.parse(strFromU8(unzipSync(bytes)['settings.json']));
		expect(JSON.stringify(rawSettings)).not.toContain('sk-secret');
		expect(JSON.stringify(rawSettings)).not.toContain('gcp-ref');
		expect(JSON.stringify(rawSettings)).not.toContain('local-bearer');
		expect(JSON.stringify(rawSettings)).not.toContain('Bearer tok');
	});
});

describe('mergeByIdKeepExisting', () => {
	it('adds new ids and keeps existing entries on conflicts', () => {
		const editedB = { ...prompt('b'), content: 'imported newer body' };
		const { merged, added, skipped } = mergeByIdKeepExisting([prompt('a'), prompt('b')], [editedB, prompt('c')]);
		expect(added).toBe(1);
		expect(skipped).toBe(1);
		expect(merged.map((p) => p.id)).toEqual(['a', 'b', 'c']);
		expect(merged[1].content).toBe('body b'); // local winner, not the imported copy
	});
});

describe('mergeImportedSettings', () => {
	it('applies imported settings but restores local credentials', () => {
		const local = settings({ temperature: 0.2 });
		local.chatgptHostId = 'host-uuid';
		local.discoveredModels = { openai: [] as never };
		const imported = stripCredentialFields(settings({ temperature: 0.9 }));

		const merged = mergeImportedSettings(local, imported);
		expect(merged.temperature).toBe(0.9); // imported preference wins
		expect(merged.providerConfigs.openai.apiKey).toBe('sk-secret'); // local secret kept
		expect(merged.providerConfigs.openai.apiKeyRef).toBe('ref-openai');
		expect(merged.providerConfigs.anthropic.oauthRef).toBe('oauth-ref');
		expect(merged.chatgptHostId).toBe('host-uuid');
		expect(merged.discoveredModels).toBe(local.discoveredModels);
		expect(merged.gcpServiceAccountRef).toBe('gcp-ref');
		expect(merged.gcpServiceAccountJson).toBe('{"client_email":"x"}');
		expect(merged.mcpServerToken).toBe('local-bearer');
		expect(merged.mcpServers[0].headers[0].value).toBe('Bearer tok'); // local MCP auth kept
	});

	it('keeps imported MCP servers that have no local counterpart', () => {
		const local = settings();
		const imported = stripCredentialFields(
			settings({ mcpServers: [{ id: 'srv2', name: 'new', url: 'http://x', enabled: true, headers: [] }] })
		);
		const merged = mergeImportedSettings(local, imported);
		expect(merged.mcpServers).toHaveLength(1);
		expect(merged.mcpServers[0].id).toBe('srv2');
	});
});
