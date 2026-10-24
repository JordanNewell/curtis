// Curtis.ai — Copyright (c) 2026 Jordan Newell. Source-available under BUSL-1.1 (see LICENSE); production use free under the Additional Use Grant.
// Claude-setup import — Obsidian host glue. Two jobs:
//
// 1. The desktop fs port: lazy `window.require('fs')` so the node builtins
//    never enter the mobile bundle path (esbuild keeps them external; a
//    static import would top-level-require them on mobile and crash).
// 2. Applying a scanned + user-selected import through Curtis's own
//    managers. Everything lands DISABLED (MCP enabled:false, agents
//    remote:false) — the user reviews, then turns things on. Collisions
//    skip and report; nothing is ever overwritten.

import { FileSystemAdapter, Notice, parseYaml, Platform, TFile } from 'obsidian';
import type CurtisPlugin from '../main';
import type { AgentManager } from '../agents';
import type { McpServerConfig } from '../types';
import {
	mapAgentToCurtis,
	markMcpDuplicates,
	scanClaudeSetup,
	type ClaudeFsPort,
	type ClaudeSetupScan,
	type MappedMcpEntry,
} from './claude-setup';

export function getDesktopFsPort(): ClaudeFsPort | null {
	if (!Platform.isDesktopApp) return null;
	const req = (window as unknown as { require?: (m: string) => unknown }).require;
	if (typeof req !== 'function') return null;
	try {
		// Lazy requires — see header. Path is only used to join with '/'.
		const nodeFs = req('fs') as {
			existsSync(p: string): boolean;
			readFileSync(p: string, enc: string): string;
			readdirSync(p: string): string[];
			statSync(p: string): { isDirectory(): boolean };
		};
		const nodeOs = req('os') as { homedir(): string };
		return {
			exists: async (p) => nodeFs.existsSync(p),
			readFile: async (p) => nodeFs.readFileSync(p, 'utf8'),
			readdir: async (p) => {
				try {
					return nodeFs.readdirSync(p);
				} catch {
					return [];
				}
			},
			isDirectory: async (p) => {
				try {
					return nodeFs.statSync(p).isDirectory();
				} catch {
					return false;
				}
			},
			homedir: () => nodeOs.homedir(),
		};
	} catch {
		return null;
	}
}

/** Desktop disk path of the vault root (same idiom as the terminal runner). */
export function getVaultDiskRoot(plugin: CurtisPlugin): string {
	const adapter = plugin.app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : '';
}

export async function scanClaudeSetupForPlugin(plugin: CurtisPlugin): Promise<ClaudeSetupScan | null> {
	const port = getDesktopFsPort();
	if (!port) return null;
	const existingNames = plugin.agents.getAgents().map((a) => a.name);
	const scan = await scanClaudeSetup(port, getVaultDiskRoot(plugin), existingNames, (t) => parseYaml(t));
	if (scan) {
		// Flag MCP entries whose URL is already configured — the modal badges
		// them and defaults their checkbox off. Apply re-checks independently,
		// so this only shapes what the user sees.
		const existingUrls = plugin.settings.mcpServers.map((s) => s.url);
		scan.mcp = markMcpDuplicates(scan.mcp, existingUrls);
	}
	return scan;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

export interface ClaudeSetupSelection {
	/** Indices into scan.mcp the user checked. */
	mcp: number[];
	skills: number[];
	agents: number[];
	/** Which CLAUDE.md seeds to import as harness profiles. */
	claudeMd: Array<'global' | 'project'>;
}

export interface ClaudeSetupApplyResult {
	importedMcp: number;
	importedSkills: number;
	importedAgents: number;
	importedProfiles: number;
	skippedMcp: number;
	skippedSkills: number;
	skippedAgents: number;
	notes: string[];
}

/** Apply the user's selection. One saveSettings for the whole batch; MCP
 *  servers are NOT connected here (they import disabled — the user flips
 *  them on in Settings, which connects via the existing toggle path). */
export async function applyClaudeSetupImport(
	plugin: ClaudeApplyPlugin,
	scan: ClaudeSetupScan,
	selection: ClaudeSetupSelection
): Promise<ClaudeSetupApplyResult> {
	const result: ClaudeSetupApplyResult = {
		importedMcp: 0, importedSkills: 0, importedAgents: 0, importedProfiles: 0,
		skippedMcp: 0, skippedSkills: 0, skippedAgents: 0, notes: [],
	};

	// --- MCP servers (disabled) ---
	const existingUrls = new Set(plugin.settings.mcpServers.map((s) => s.url.replace(/\/+$/, '')));
	for (const i of selection.mcp) {
		const entry: MappedMcpEntry = scan.mcp[i];
		if (!entry?.config || entry.duplicate) {
			result.skippedMcp++;
			continue;
		}
		if (existingUrls.has(entry.config.url.replace(/\/+$/, ''))) {
			result.skippedMcp++;
			continue;
		}
		plugin.settings.mcpServers.push(entry.config);
		existingUrls.add(entry.config.url.replace(/\/+$/, ''));
		result.importedMcp++;
		if (entry.note) result.notes.push(`${entry.config.name}: ${entry.note}`);
	}

	// --- Skills (verbatim SKILL.md folders under AI/Skills/) ---
	const skillsFolder = plugin.skills.folder();
	if (selection.skills.length > 0 && !plugin.app.vault.getAbstractFileByPath(skillsFolder)) {
		try {
			await plugin.app.vault.createFolder(skillsFolder);
		} catch { /* may exist concurrently */ }
	}
	for (const i of selection.skills) {
		const candidate = scan.skills[i];
		if (!candidate) continue;
		const skillPath = `${skillsFolder}/${candidate.folderName}/SKILL.md`;
		if (plugin.app.vault.getAbstractFileByPath(skillPath)) {
			result.skippedSkills++;
			result.notes.push(`skill "${candidate.folderName}": already exists in the vault — skipped`);
			continue;
		}
		try {
			const dir = `${skillsFolder}/${candidate.folderName}`;
			if (!plugin.app.vault.getAbstractFileByPath(dir)) {
				await plugin.app.vault.createFolder(dir);
			}
			await plugin.app.vault.create(skillPath, candidate.raw);
			result.importedSkills++;
		} catch (e) {
			result.skippedSkills++;
			result.notes.push(`skill "${candidate.folderName}" failed to write: ${(e as Error).message}`);
		}
	}

	// --- Agents ---
	for (const i of selection.agents) {
		const candidate = scan.agents[i];
		if (!candidate || !candidate.parse.ok) continue;
		if (candidate.duplicate || plugin.agents.findByRef(candidate.parse.name)) {
			result.skippedAgents++;
			result.notes.push(`agent "${candidate.parse.name}": one with this name already exists — skipped`);
			continue;
		}
		const { agent, notes, keepRouting } = mapAgentToCurtis(candidate.parse);
		const created = plugin.agents.createAgent({ ...agent, name: agent.name });
		// createAgent snapshots the active lane for empty routing — imported
		// agents must FOLLOW the lane instead, so reset to truly empty. An
		// agent that carried a full curtis routing block keeps its own.
		if (!keepRouting) {
			plugin.agents.updateAgent(created.id, { providerId: '', modelId: '' });
		}
		result.importedAgents++;
		for (const n of notes) result.notes.push(`agent "${agent.name}": ${n}`);
	}

	// --- CLAUDE.md → harness profiles ---
	for (const scope of selection.claudeMd) {
		const seed = scan.claudeMd.find((c) => c.scope === scope);
		if (!seed) continue;
		plugin.settings.harnessProfiles.push({
			id: `harness_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
			name: scope === 'global' ? 'Claude Code (global)' : 'Claude Code (project)',
			description: `Imported from ${scope === 'global' ? '~/.claude/CLAUDE.md' : 'vault-root CLAUDE.md'}`,
			prompt: seed.raw.trim(),
		});
		result.importedProfiles++;
	}

	await plugin.saveSettings();
	new Notice(
		`Claude Code import: ${result.importedMcp} MCP server(s) (disabled), ` +
		`${result.importedSkills} skill(s), ${result.importedAgents} agent(s), ` +
		`${result.importedProfiles} harness profile(s)`,
		8000
	);
	return result;
}

/** Structural plugin surface apply needs — keeps the function testable. */
export interface ClaudeApplyPlugin {
	settings: {
		mcpServers: McpServerConfig[];
		harnessProfiles: { id: string; name: string; description: string; prompt: string }[];
	};
	agents: Pick<AgentManager, 'createAgent' | 'updateAgent' | 'findByRef'>;
	skills: { folder(): string };
	app: {
		vault: {
			getAbstractFileByPath(path: string): unknown;
			createFolder(path: string): Promise<unknown>;
			create(path: string, data: string): Promise<TFile>;
		};
	};
	saveSettings(): Promise<void>;
}
